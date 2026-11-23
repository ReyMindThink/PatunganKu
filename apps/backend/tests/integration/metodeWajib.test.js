// K26 di SQL Server nyata: penalang wajib punya minimal satu metode pembayaran aktif saat submit.
// Router transaksi, layanan, ledger, idempotensi, dan CHECK database yang asli. Struk diset lewat
// prisma (unggah dan verifikasi dibuktikan di tes struk). Tabel tambah-saja tidak di-UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatMetode } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananTransaksi } from "../../src/services/transaksi.js";
import { buatRouterTransaksi } from "../../src/routes/transaksi.router.js";

const SECRET = "rahasia-integrasi-metode-wajib-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

describe("K26: metode pembayaran wajib saat submit, di SQL Server", () => {
  let server;
  before(async () => {
    const router = buatRouterTransaksi({
      layanan: buatLayananTransaksi({ db: prisma, ledger: buatLayananLedger({ db: prisma }) }),
      requireAuth: buatRequireAuth({ secret: SECRET }),
      requireActiveMember: buatAkses({ db: prisma }).requireActiveMember,
      idempoten: buatIdempotensi({ db: prisma }).idempoten,
    });
    server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function kirim(path, { metode = "GET", body, user, kunci } = {}) {
    const headers = { "content-type": "application/json" };
    if (user) headers.authorization = "Bearer " + token(user.id);
    if (kunci) headers["idempotency-key"] = kunci;
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  }
  const tulis = (path, metode, user, body, kunci = randomUUID()) => kirim(path, { metode, user, body, kunci });

  // Grup dengan n anggota ACTIVE TANPA metode pembayaran (anggota pertama OWNER dan penalang).
  async function ruang(n = 3) {
    const user = [];
    for (let i = 0; i < n; i++) user.push(await buatUser());
    const grup = await buatGrup(user[0].id);
    for (let i = 0; i < n; i++) await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: "ACTIVE" });
    return { user, grup, base: "/" + grup.id + "/transactions" };
  }
  async function draftSiap(r, penalang = r.user[0], statusStruk = "VERIFIED") {
    const t = (await tulis(r.base, "POST", penalang, { description: "Makan bersama", amount: 70000 })).body.data;
    await prisma.transaction.update({ where: { id: t.id }, data: { receiptUrl: "https://blob.example/struk-uji.jpg", receiptStatus: statusStruk } });
    return t;
  }
  const tidakAdaTulisan = async (id) => {
    assert.equal((await prisma.transaction.findUnique({ where: { id } })).status, "DRAFT");
    assert.equal(await prisma.transactionShare.count({ where: { transactionId: id } }), 0);
    assert.equal(await prisma.ledgerEntry.count({ where: { transactionId: id } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { transactionId: id } }), 0);
    assert.equal(await prisma.approval.count({ where: { subjectId: id } }), 0);
  };

  it("penalang tanpa metode: 409 payment-method-required dan tidak ada tulisan sama sekali; sesudah menambah metode tunai submit berhasil", async () => {
    const r = await ruang(3);
    const t = await draftSiap(r);
    const gagal = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0]);
    assert.equal(gagal.status, 409);
    assert.equal(gagal.body.code, "payment-method-required");
    await tidakAdaTulisan(t.id);
    await buatMetode(r.user[0].id);
    const ok = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0]);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.transaction.status, "ACTIVE");
    assert.equal(await prisma.ledgerEntry.count({ where: { transactionId: t.id } }) > 0, true);
  });

  it("metode nonaktif tidak dihitung; mengaktifkannya membuka submit", async () => {
    const r = await ruang(2);
    const t = await draftSiap(r);
    const m = await buatMetode(r.user[0].id, { kind: "BANK", provider: "BCA", accountNo: "v1.contoh.tag.isi", accountName: "Nama", isActive: false });
    const gagal = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0]);
    assert.equal(gagal.status, 409);
    assert.equal(gagal.body.code, "payment-method-required");
    await tidakAdaTulisan(t.id);
    await prisma.paymentMethod.update({ where: { id: m.id }, data: { isActive: true } });
    assert.equal((await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0])).status, 200);
  });

  it("metode anggota lain tidak membantu penalang; jenis BANK aktif cukup", async () => {
    const r = await ruang(3);
    await buatMetode(r.user[1].id);
    await buatMetode(r.user[2].id);
    const t = await draftSiap(r);
    assert.equal((await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0])).body.code, "payment-method-required");
    await buatMetode(r.user[0].id, { kind: "BANK", provider: "BCA", accountNo: "v1.contoh.tag.isi", accountName: "Nama" });
    assert.equal((await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0])).status, 200);
  });

  it("jalur persetujuan (struk FAILED) juga wajib metode: tanpa metode tidak ada Approval maupun share", async () => {
    const r = await ruang(3);
    const t = await draftSiap(r, r.user[1], "FAILED");
    const gagal = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[1]);
    assert.equal(gagal.status, 409);
    assert.equal(gagal.body.code, "payment-method-required");
    await tidakAdaTulisan(t.id);
    await buatMetode(r.user[1].id);
    const ok = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[1]);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.transaction.status, "PENDING_APPROVAL");
    assert.equal(await prisma.approval.count({ where: { subjectId: t.id } }), 1);
  });

  it("[D] kunci Idempotency-Key yang gagal karena K26 tidak terpakai: ulangi dengan kunci sama setelah menambah metode berhasil", async () => {
    const r = await ruang(2);
    const t = await draftSiap(r);
    const kunci = randomUUID();
    const gagal = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0], undefined, kunci);
    assert.equal(gagal.status, 409);
    await buatMetode(r.user[0].id);
    const ulang = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0], undefined, kunci);
    assert.equal(ulang.status, 200);
    assert.equal(ulang.body.data.transaction.status, "ACTIVE");
  });
});
