import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterSaldoGrup, buatRouterSaldoSaya } from "../../src/routes/saldo.router.js";

const SECRET = "rahasia-uji-router-saldo-yang-cukup-panjang-abc";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

// Grup 7: 1 OWNER ACTIVE, 5 MEMBER ACTIVE, 2 LEFT, 3 REMOVED; 4 bukan anggota.
const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:5": { role: "MEMBER", status: "ACTIVE" },
  "7:2": { role: "MEMBER", status: "LEFT" },
  "7:3": { role: "MEMBER", status: "REMOVED" },
};
const dbPalsu = { groupMember: { findUnique: async ({ where }) => tabel[where.groupId_userId.groupId + ":" + where.groupId_userId.userId] ?? null } };

describe("router saldo", async () => {
  const panggilan = [];
  const layanan = new Proxy({}, { get: (_, n) => async (...args) => { panggilan.push({ n, args }); return { n }; } });
  const requireAuth = buatRequireAuth({ secret: SECRET });
  const grup = buatRouterSaldoGrup({ layanan, requireAuth, requireMember: buatAkses({ db: dbPalsu }).requireMember });
  const saya = buatRouterSaldoSaya({ layanan, requireAuth });
  const server = await mulaiAplikasi((app) => {
    app.use("/api/groups", grup);
    app.use("/api/me", saya);
  });
  after(() => server.tutup());
  const minta = async (path, userId) => {
    const res = await fetch(server.url + "/api" + path, { headers: Number.isInteger(userId) ? { authorization: "Bearer " + token(userId) } : {} });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  };
  const rute = (r) => r.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => m + " " + l.route.path));

  it("hanya tiga rute GET", () => {
    assert.deepEqual(rute(grup), ["get /:groupId/balances", "get /:groupId/balances/:userId"]);
    assert.deepEqual(rute(saya), ["get /balances"]);
  });

  it("tanpa token 401 pada semua rute", async () => {
    for (const p of ["/groups/7/balances", "/groups/7/balances/1", "/me/balances"]) assert.equal((await minta(p)).status, 401, p);
    assert.deepEqual(panggilan, []);
  });

  it("bukan anggota dan grup tak ada 403; id tak sah 400; tidak ada yang sampai ke layanan", async () => {
    for (const p of ["/groups/7/balances", "/groups/7/balances/1"]) {
      assert.equal((await minta(p, 4)).status, 403, p + " bukan anggota");
      assert.equal((await minta(p.replace("/7/", "/99/"), 1)).status, 403, p + " grup tak ada");
    }
    assert.equal((await minta("/groups/abc/balances", 1)).status, 400);
    for (const id of ["abc", "0", "1.5", "Fund"]) {
      const h = await minta("/groups/7/balances/" + id, 1);
      assert.equal(h.status, 400, "userId " + id);
      assert.equal(h.body.code, "validation-failed");
    }
    assert.deepEqual(panggilan, []);
  });

  it("anggota ACTIVE, LEFT, dan REMOVED boleh masuk; konteks memuat status keanggotaan", async () => {
    panggilan.length = 0;
    for (const [userId, role, status] of [[1, "OWNER", "ACTIVE"], [5, "MEMBER", "ACTIVE"], [2, "MEMBER", "LEFT"], [3, "MEMBER", "REMOVED"]]) {
      const h = await minta("/groups/7/balances", userId);
      assert.equal(h.status, 200, status);
      assert.deepEqual(h.body, { data: { n: "ringkasanGrup" } });
      assert.deepEqual(panggilan.at(-1), { n: "ringkasanGrup", args: [{ userId, groupId: 7, role, status }] });
    }
  });

  it("rincian: id angka menjadi number dan fund diteruskan ke layanan; ringkasan saya memakai id token", async () => {
    panggilan.length = 0;
    assert.equal((await minta("/groups/7/balances/5", 1)).status, 200);
    assert.deepEqual(panggilan.at(-1), { n: "rincian", args: [{ userId: 1, groupId: 7, role: "OWNER", status: "ACTIVE" }, 5] });
    assert.equal((await minta("/groups/7/balances/fund", 2)).status, 200);
    assert.deepEqual(panggilan.at(-1), { n: "rincian", args: [{ userId: 2, groupId: 7, role: "MEMBER", status: "LEFT" }, "fund"] });
    const saldoSaya = await minta("/me/balances", 9);
    assert.deepEqual(saldoSaya.body, { data: { n: "ringkasanSaya" } });
    assert.deepEqual(panggilan.at(-1), { n: "ringkasanSaya", args: [9] });
  });
});
