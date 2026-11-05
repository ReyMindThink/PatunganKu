import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatPembatasStruk, buatRouterStruk } from "../../src/routes/struk.router.js";
import { sha256Hex } from "../../src/utils/sidikStruk.js";

const SECRET = "rahasia-uji-router-struk-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const MENIT = 60 * 1000;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("gambar-uji")]);

const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:5": { role: "MEMBER", status: "ACTIVE" },
  "7:2": { role: "MEMBER", status: "LEFT" },
  "7:3": { role: "MEMBER", status: "REMOVED" },
};
const dbPalsu = { groupMember: { findUnique: async ({ where }) => tabel[where.groupId_userId.groupId + ":" + where.groupId_userId.userId] ?? null } };

async function siapkan({ jam } = {}) {
  const panggilan = [];
  const layanan = new Proxy({}, { get: (_, nama) => async (...args) => { panggilan.push({ nama, args }); return { nama }; } });
  const catatan = [];
  const idempotenPalsu = (label) => (fn) => async (req, res) => {
    catatan.push({ label, body: req.body });
    const hasil = await fn(req, { tx: true });
    res.status(hasil.status).json(hasil.body);
  };
  const router = buatRouterStruk({
    layanan,
    requireAuth: buatRequireAuth({ secret: SECRET }),
    requireActiveMember: buatAkses({ db: dbPalsu }).requireActiveMember,
    idempoten: idempotenPalsu("biasa"),
    idempotenVerifikasi: idempotenPalsu("verifikasi"),
    pembatas: jam ? buatPembatasStruk({ sekarang: () => jam.t }) : buatPembatasStruk(),
  });
  const server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  const minta = async (path, { userId, berkas, field = "receipt", json } = {}) => {
    const headers = {};
    if (Number.isInteger(userId)) headers.authorization = "Bearer " + token(userId);
    let body;
    if (berkas) {
      body = new FormData();
      body.append(field, new Blob([berkas], { type: "image/jpeg" }), "struk.jpg");
    } else if (typeof json === "object") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    const res = await fetch(server.url + "/api/groups" + path, { method: "POST", headers, body });
    const teks = await res.text();
    return { res, status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  };
  return { router, server, minta, panggilan, catatan };
}

const rute = (router) => router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => ({ path: l.route.path, metode: m.toUpperCase() })));
const CTX = { userId: 1, groupId: 7, role: "OWNER" };

describe("router struk", async () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));
  const mulai = async (opsi) => {
    const x = await siapkan(opsi);
    buka.push(x.server);
    return x;
  };

  it("setiap rute: tanpa token 401; non-anggota, LEFT, REMOVED, grup tak ada 403; id tak sah 400; ACTIVE sukses", async () => {
    const { router, minta } = await mulai();
    const semua = rute(router);
    assert.equal(semua.length, 2);
    for (const r of semua) {
      assert.ok(r.path.includes(":groupId") && r.path.includes(":transactionId"), r.path);
      const nama = r.metode + " " + r.path;
      const unggah = r.path.endsWith("/receipt");
      const di = (grup, trx = "5") => r.path.replace(":groupId", grup).replace(":transactionId", trx);
      const opsi = (userId) => ({ userId, berkas: unggah ? JPEG : undefined });
      assert.equal((await minta(di("7"), opsi(undefined))).status, 401, nama + " tanpa token");
      for (const [userId, grup, alasan] of [[4, "7", "bukan anggota"], [2, "7", "LEFT"], [3, "7", "REMOVED"], [1, "99", "grup tak ada"]]) {
        const h = await minta(di(grup), opsi(userId));
        assert.equal(h.status, 403, nama + " " + alasan);
        assert.equal(h.body.code, "forbidden", nama + " " + alasan);
      }
      for (const grup of ["abc", "0", "1.5"]) assert.equal((await minta(di(grup), opsi(1))).status, 400, nama + " groupId " + grup);
      for (const trx of ["abc", "0", "1.5"]) assert.equal((await minta(di("7", trx), opsi(1))).status, 400, nama + " transactionId " + trx);
      assert.equal((await minta(di("7"), opsi(1))).status, 200, nama + " anggota ACTIVE");
    }
  });

  it("unggah: berkas wajib di field receipt (tanpa berkas, field lain, atau JSON: 400); berkas di atas 5 MB 413", async () => {
    const { minta, panggilan } = await mulai();
    const url = "/7/transactions/5/receipt";
    const tanpa = await minta(url, { userId: 1, json: { x: 1 } });
    assert.equal(tanpa.status, 400);
    assert.ok(tanpa.body.errors.some((e) => e.field === "receipt"));
    assert.equal((await minta(url, { userId: 1 })).status, 400);
    const salah = await minta(url, { userId: 1, berkas: JPEG, field: "foto" });
    assert.equal(salah.status, 400);
    assert.equal(salah.body.code, "validation-failed");
    const besar = await minta(url, { userId: 1, berkas: Buffer.alloc(5 * 1024 * 1024 + 1, 1) });
    assert.equal(besar.status, 413);
    assert.equal(besar.body.code, "payload-too-large");
    assert.equal(panggilan.length, 0);
  });

  it("unggah: layanan menerima isi berkas dan konteks; sidik berkas masuk req.body sehingga berkas lain dengan kunci sama berbeda sidik", async () => {
    const { minta, panggilan, catatan } = await mulai();
    const lain = Buffer.concat([JPEG, Buffer.from("beda")]);
    const h = await minta("/7/transactions/5/receipt", { userId: 1, berkas: JPEG });
    assert.deepEqual(h.body, { data: { nama: "unggah" } });
    await minta("/7/transactions/5/receipt", { userId: 1, berkas: lain });
    assert.deepEqual(panggilan[0], { nama: "unggah", args: [{ tx: true }, CTX, 5, { buffer: JPEG }] });
    assert.deepEqual(catatan.map((c) => c.label), ["biasa", "biasa"]);
    assert.deepEqual(catatan[0].body, { receiptSha256: sha256Hex(JPEG) });
    assert.deepEqual(catatan[1].body, { receiptSha256: sha256Hex(lain) });
    assert.notEqual(catatan[0].body.receiptSha256, catatan[1].body.receiptSha256);
  });

  it("verifikasi memakai instance idempotensi khusus dan memanggil layanan dengan konteks", async () => {
    const { minta, panggilan, catatan } = await mulai();
    const h = await minta("/7/transactions/5/receipt/verify", { userId: 5 });
    assert.deepEqual(h.body, { data: { nama: "verifikasi" } });
    assert.deepEqual(catatan.map((c) => c.label), ["verifikasi"]);
    assert.deepEqual(panggilan, [{ nama: "verifikasi", args: [{ tx: true }, { userId: 5, groupId: 7, role: "MEMBER" }, 5] }]);
  });

  it("batas laju verifikasi: 10 per pengguna per 15 menit, ke-11 429 Retry-After 900; id tak sah tidak dihitung; unggah tidak dibatasi; pulih setelah jendela", async () => {
    const jam = { t: 5_000_000 };
    const { minta } = await mulai({ jam });
    const verif = (userId, trx = "5") => minta("/7/transactions/" + trx + "/receipt/verify", { userId });
    for (let i = 0; i < 10; i++) assert.equal((await verif(1)).status, 200, "verifikasi ke-" + (i + 1));
    const tolak = await verif(1);
    assert.equal(tolak.status, 429);
    assert.equal(tolak.body.code, "rate-limited");
    assert.equal(tolak.res.headers.get("retry-after"), "900");

    for (let i = 0; i < 12; i++) assert.equal((await verif(5, "abc")).status, 400);
    for (let i = 0; i < 10; i++) assert.equal((await verif(5)).status, 200, "pengguna lain ke-" + (i + 1));
    assert.equal((await verif(5)).status, 429);

    for (let i = 0; i < 11; i++) assert.equal((await minta("/7/transactions/5/receipt", { userId: 1, berkas: JPEG })).status, 200);
    jam.t += 15 * MENIT + 1;
    assert.equal((await verif(1)).status, 200);
  });
});
