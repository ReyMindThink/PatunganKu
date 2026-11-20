import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterTransaksi } from "../../src/routes/transaksi.router.js";

const SECRET = "rahasia-uji-router-transaksi-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

// Grup 7: pengguna 1 OWNER ACTIVE, 5 MEMBER ACTIVE, 2 LEFT, 3 REMOVED; 4 bukan anggota.
const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:5": { role: "MEMBER", status: "ACTIVE" },
  "7:2": { role: "MEMBER", status: "LEFT" },
  "7:3": { role: "MEMBER", status: "REMOVED" },
};
const dbPalsu = { groupMember: { findUnique: async ({ where }) => tabel[where.groupId_userId.groupId + ":" + where.groupId_userId.userId] ?? null } };

function buatLayananPalsu() {
  const panggilan = [];
  const layanan = new Proxy({}, {
    get: (_, nama) => async (...args) => {
      panggilan.push({ nama, args });
      return nama === "daftar" ? { data: [], nextCursor: null, hasMore: false } : { nama };
    },
  });
  return { layanan, panggilan };
}
const idempotenPalsu = (fn) => async (req, res) => {
  const hasil = await fn(req, { tx: true });
  if (hasil.body === undefined) return res.status(hasil.status).end();
  return res.status(hasil.status).json(hasil.body);
};

async function siapkan() {
  const { layanan, panggilan } = buatLayananPalsu();
  const router = buatRouterTransaksi({
    layanan,
    requireAuth: buatRequireAuth({ secret: SECRET }),
    requireActiveMember: buatAkses({ db: dbPalsu }).requireActiveMember,
    idempoten: idempotenPalsu,
  });
  const server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  const minta = async (metode, path, { userId, body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (Number.isInteger(userId)) headers.authorization = "Bearer " + token(userId);
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
  };
  return { router, server, minta, panggilan };
}

const rute = (router) =>
  router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => ({ path: l.route.path, metode: m.toUpperCase() })));
const BODY_SAH = { description: "Makan", amount: 5000 };
// Status sukses tiap rute untuk anggota ACTIVE.
const SUKSES = { "POST /:groupId/transactions": 201, "GET /:groupId/transactions": 200, "GET /:groupId/transactions/:transactionId": 200, "PATCH /:groupId/transactions/:transactionId": 200, "DELETE /:groupId/transactions/:transactionId": 204, "POST /:groupId/transactions/:transactionId/submit": 200 };
const bodyUntuk = (r) => (r.metode === "POST" && r.path.endsWith("/transactions") ? BODY_SAH : r.metode === "PATCH" ? { amount: 5 } : undefined);

describe("router transaksi", async () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));
  const mulai = async () => {
    const x = await siapkan();
    buka.push(x.server);
    return x;
  };
  const CTX = { userId: 1, groupId: 7, role: "OWNER" };

  it("setiap rute berparameter groupId: tanpa token 401; non-anggota, LEFT, REMOVED, grup tak ada 403; id tak sah 400; ACTIVE sukses", async () => {
    const { router, minta } = await mulai();
    const semua = rute(router);
    assert.equal(semua.length, 6);
    for (const r of semua) {
      assert.ok(r.path.includes(":groupId"), r.path);
      const nama = r.metode + " " + r.path;
      assert.ok(typeof SUKSES[nama] === "number", "rute baru tanpa nilai harapan: " + nama);
      const di = (grup, trx = "5") => r.path.replace(":groupId", grup).replace(":transactionId", trx);
      const body = bodyUntuk(r);
      assert.equal((await minta(r.metode, di("7"), { body })).status, 401, nama + " tanpa token");
      for (const [userId, grup, alasan] of [[4, "7", "bukan anggota"], [2, "7", "LEFT"], [3, "7", "REMOVED"], [1, "99", "grup tak ada"]]) {
        const h = await minta(r.metode, di(grup), { userId, body });
        assert.equal(h.status, 403, nama + " " + alasan);
        assert.equal(h.body.code, "forbidden", nama + " " + alasan);
      }
      for (const grup of ["abc", "0", "1.5"]) {
        assert.equal((await minta(r.metode, di(grup), { userId: 1, body })).status, 400, nama + " groupId " + grup);
      }
      if (r.path.includes(":transactionId")) {
        for (const trx of ["abc", "0", "1.5"]) {
          const h = await minta(r.metode, di("7", trx), { userId: 1, body });
          assert.equal(h.status, 400, nama + " transactionId " + trx);
          assert.equal(h.body.code, "validation-failed");
        }
      }
      assert.equal((await minta(r.metode, di("7"), { userId: 1, body })).status, SUKSES[nama], nama + " anggota ACTIVE");
    }
  });

  it("POST /transactions: nominal, deskripsi, mode, dan participants divalidasi sebelum layanan; konteks dari token dan keanggotaan", async () => {
    const { minta, panggilan } = await mulai();
    for (const [body, field] of [
      [{ description: "x", amount: 0 }, "amount"],
      [{ description: "x", amount: 100000001 }, "amount"],
      [{ description: "  ", amount: 5 }, "description"],
      [{ description: "x", amount: 5, mode: "ITEMIZED" }, "mode"],
      [{ description: "x", amount: 5, participants: [1, 2] }, "participants"],
    ]) {
      const h = await minta("POST", "/7/transactions", { userId: 1, body });
      assert.equal(h.status, 400, JSON.stringify(body));
      assert.ok(h.body.errors.some((e) => e.field === field), "field " + field);
    }
    assert.equal(panggilan.length, 0);
    const baik = await minta("POST", "/7/transactions", { userId: 5, body: { description: "  Makan  ", amount: 5000, payerId: 1 } });
    assert.equal(baik.status, 201);
    assert.deepEqual(baik.body, { data: { nama: "buat" } });
    assert.deepEqual(panggilan, [{ nama: "buat", args: [{ tx: true }, { userId: 5, groupId: 7, role: "MEMBER" }, { description: "Makan", amount: 5000, mode: "EQUAL_ALL" }] }]);
  });

  it("GET /transactions: query divalidasi dan diteruskan; respons memuat page", async () => {
    const { minta, panggilan } = await mulai();
    for (const q of ["month=2026-13", "limit=101", "limit=0", "status=ACTIV", "payerId=abc"]) {
      assert.equal((await minta("GET", "/7/transactions?" + q, { userId: 1 })).status, 400, q);
    }
    assert.equal(panggilan.length, 0);
    const h = await minta("GET", "/7/transactions?month=2026-10&limit=5&status=ACTIVE&payerId=3", { userId: 1 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: [], page: { nextCursor: null, hasMore: false } });
    assert.deepEqual(panggilan, [{ nama: "daftar", args: [CTX, { limit: 5, month: "2026-10", status: "ACTIVE", payerId: 3 }] }]);
  });

  it("GET detail, PATCH, DELETE, dan submit memanggil layanan dengan argumen yang benar", async () => {
    const { minta, panggilan } = await mulai();
    assert.equal((await minta("GET", "/7/transactions/5", { userId: 1 })).status, 200);
    assert.equal((await minta("PATCH", "/7/transactions/5", { userId: 1, body: { amount: 8000 } })).status, 200);
    const hapus = await minta("DELETE", "/7/transactions/5", { userId: 1 });
    assert.equal(hapus.status, 204);
    assert.equal(hapus.teks, "");
    const kirim = await minta("POST", "/7/transactions/5/submit", { userId: 1 });
    assert.deepEqual(kirim.body, { data: { nama: "submit" } });
    assert.deepEqual(panggilan, [
      { nama: "detail", args: [CTX, 5] },
      { nama: "ubah", args: [{ tx: true }, CTX, 5, { amount: 8000 }] },
      { nama: "hapus", args: [{ tx: true }, CTX, 5] },
      { nama: "submit", args: [{ tx: true }, CTX, 5] },
    ]);
  });

  it("PATCH tanpa field yang berubah atau dengan mode tak didukung 400 sebelum layanan", async () => {
    const { minta, panggilan } = await mulai();
    for (const body of [{}, { status: "ACTIVE" }, { mode: "CUSTOM" }, { amount: 0 }]) {
      assert.equal((await minta("PATCH", "/7/transactions/5", { userId: 1, body })).status, 400, JSON.stringify(body));
    }
    assert.equal(panggilan.length, 0);
  });
});
