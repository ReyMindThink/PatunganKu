// Idempotency-Key pada SQL Server nyata: aksi bisnis dan penandaan COMPLETED dalam satu
// transaksi, replay, galat melepas kunci, permintaan paralel, kedaluwarsa, IN_PROGRESS basi.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../helpers/db.js";
import { buatAnggota, buatGrup, buatUser } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { HttpError } from "../../src/utils/httpError.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";

const { idempoten } = buatIdempotensi({ db: prisma });
const MENIT = 60 * 1000;
const sebagai = (req, res, next) => {
  req.user = { id: Number(req.headers["x-user"]) };
  next();
};
const aksi = idempoten(async (req, tx) => {
  const t = await tx.transaction.create({
    data: { groupId: Number(req.params.groupId), payerId: req.user.id, description: req.body.deskripsi, amount: 70000, status: "ACTIVE" },
  });
  if (req.body.gagal === true) throw new HttpError(409, "invalid-state", "Aksi gagal sesudah menulis.");
  return { status: 201, body: { data: { id: t.id } } };
});

describe("Idempotency-Key di SQL Server", () => {
  let server;
  before(async () => {
    server = await mulaiAplikasi((app) => app.post("/g/:groupId/aksi", sebagai, aksi));
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function siapkan() {
    const pemilik = await buatUser();
    const grup = await buatGrup(pemilik.id);
    await buatAnggota(grup.id, pemilik.id, { role: "OWNER" });
    return { pemilik, grup, deskripsi: "idem-" + randomUUID(), key: randomUUID() };
  }
  async function kirim(s, { key = s.key, body = { deskripsi: s.deskripsi } } = {}) {
    const res = await fetch(server.url + "/g/" + s.grup.id + "/aksi", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, "x-user": String(s.pemilik.id) },
      body: JSON.stringify(body),
    });
    return { res, status: res.status, body: JSON.parse(await res.text()) };
  }
  const hitung = (s) => prisma.transaction.count({ where: { groupId: s.grup.id, description: s.deskripsi } });
  const barisKunci = (s) => prisma.idempotencyKey.findMany({ where: { userId: s.pemilik.id, key: s.key } });
  const replay = (r) => r.res.headers.get("idempotent-replay");
  const ubahKunci = (s, data) => prisma.idempotencyKey.updateMany({ where: { userId: s.pemilik.id, key: s.key }, data });

  it("ulang identik: satu Transaction, respons sama, replay; baris COMPLETED menyimpan respons", async () => {
    const s = await siapkan();
    const a = await kirim(s);
    const b = await kirim(s);
    assert.equal(a.status, 201);
    assert.equal(replay(a), null);
    assert.equal(b.status, 201);
    assert.equal(replay(b), "true");
    assert.deepEqual(b.body, a.body);
    assert.equal(await hitung(s), 1);
    const baris = await barisKunci(s);
    assert.equal(baris.length, 1);
    assert.equal(baris[0].state, "COMPLETED");
    assert.equal(baris[0].statusCode, 201);
    assert.deepEqual(JSON.parse(baris[0].responseBody), a.body);
  });

  it("aksi menulis lalu gagal: penulisan batal, kunci dilepas, kunci sama dengan isi benar berhasil", async () => {
    const s = await siapkan();
    const gagal = await kirim(s, { body: { deskripsi: s.deskripsi, gagal: true } });
    assert.equal(gagal.status, 409);
    assert.equal(gagal.body.code, "invalid-state");
    assert.equal(await hitung(s), 0);
    assert.equal((await barisKunci(s)).length, 0);
    const baik = await kirim(s);
    assert.equal(baik.status, 201);
    assert.equal(await hitung(s), 1);
  });

  it("lima permintaan paralel: aksi sekali, satu 201 asli, sisanya 409 request-in-progress atau replay", async () => {
    const s = await siapkan();
    const semua = await Promise.all([1, 2, 3, 4, 5].map(() => kirim(s)));
    for (const r of semua) assert.ok(r.status === 201 || r.status === 409, "status " + r.status);
    assert.equal(semua.filter((r) => r.status === 201 && replay(r) === null).length, 1);
    for (const r of semua.filter((x) => x.status === 409)) assert.equal(r.body.code, "request-in-progress");
    const ids = new Set(semua.filter((r) => r.status === 201).map((r) => r.body.data.id));
    assert.equal(ids.size, 1);
    assert.equal(await hitung(s), 1);
    const lagi = await kirim(s);
    assert.equal(replay(lagi), "true");
    assert.equal(lagi.body.data.id, [...ids][0]);
  });

  it("kunci sama dengan isi berbeda: 409 idempotency-key-reuse, tidak ada penulisan baru", async () => {
    const s = await siapkan();
    await kirim(s);
    const r = await kirim(s, { body: { deskripsi: s.deskripsi, tambahan: 1 } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "idempotency-key-reuse");
    assert.equal(await hitung(s), 1);
  });

  it("kedaluwarsa: baris berumur 25 jam dianggap tidak ada, aksi dijalankan lagi dengan baris baru", async () => {
    const s = await siapkan();
    await kirim(s);
    await ubahKunci(s, { createdAt: new Date(Date.now() - 25 * 60 * MENIT) });
    const r = await kirim(s);
    assert.equal(r.status, 201);
    assert.equal(replay(r), null);
    assert.equal(await hitung(s), 2);
    const baris = await barisKunci(s);
    assert.equal(baris.length, 1);
    assert.ok(Date.now() - baris[0].createdAt.getTime() < 5 * MENIT, "createdAt baru");
  });

  it("IN_PROGRESS: umur 1 detik 409 request-in-progress; umur 10 menit diambil alih", async () => {
    const s = await siapkan();
    await kirim(s);
    const dasar = { state: "IN_PROGRESS", statusCode: null, responseBody: null, completedAt: null };
    await ubahKunci(s, { ...dasar, createdAt: new Date(Date.now() - 1000) });
    const tahan = await kirim(s);
    assert.equal(tahan.status, 409);
    assert.equal(tahan.body.code, "request-in-progress");
    assert.equal(await hitung(s), 1);
    await ubahKunci(s, { createdAt: new Date(Date.now() - 10 * MENIT) });
    const ambil = await kirim(s);
    assert.equal(ambil.status, 201);
    assert.equal(replay(ambil), null);
    assert.equal(await hitung(s), 2);
    assert.equal((await barisKunci(s))[0].state, "COMPLETED");
  });
});
