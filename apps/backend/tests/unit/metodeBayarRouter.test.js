import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterMetodeAnggota, buatRouterMetodeSaya } from "../../src/routes/metodeBayar.router.js";

const SECRET = "rahasia-uji-router-metode-bayar-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

// Grup 7: 1 OWNER ACTIVE, 5 MEMBER ACTIVE, 2 LEFT, 3 REMOVED; 4 bukan anggota.
const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:5": { role: "MEMBER", status: "ACTIVE" },
  "7:2": { role: "MEMBER", status: "LEFT" },
  "7:3": { role: "MEMBER", status: "REMOVED" },
  "8:1": { role: "OWNER", status: "ACTIVE" },
};
const dbPalsu = { groupMember: { findUnique: async ({ where }) => tabel[where.groupId_userId.groupId + ":" + where.groupId_userId.userId] ?? null } };

describe("router metode pembayaran", async () => {
  const panggilan = [];
  const layanan = new Proxy({}, { get: (_, n) => async (...args) => { panggilan.push({ n, args }); return n === "nonaktifkan" ? undefined : { n }; } });
  const requireAuth = buatRequireAuth({ secret: SECRET });
  const saya = buatRouterMetodeSaya({ layanan, requireAuth });
  const anggota = buatRouterMetodeAnggota({ layanan, requireAuth, requireMember: buatAkses({ db: dbPalsu }).requireMember });
  const server = await mulaiAplikasi((app) => {
    app.use("/api/me", saya);
    app.use("/api/groups", anggota);
  });
  after(() => server.tutup());
  const minta = async (metode, path, { userId, body } = {}) => {
    const headers = {};
    if (Number.isInteger(userId)) headers.authorization = "Bearer " + token(userId);
    if ((body === undefined) === false) headers["content-type"] = "application/json";
    const res = await fetch(server.url + "/api" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  };
  const rute = (r) => r.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => m + " " + l.route.path));
  const bank = { kind: "BANK", provider: "BCA", accountNo: "1234567890", accountName: "Rasyid" };

  it("hanya lima rute", () => {
    assert.deepEqual(rute(saya), ["get /payment-methods", "post /payment-methods", "patch /payment-methods/:methodId", "delete /payment-methods/:methodId"]);
    assert.deepEqual(rute(anggota), ["get /:groupId/members/:userId/payment-methods"]);
  });

  it("tanpa token 401 pada semua rute dan layanan tidak dipanggil", async () => {
    const semua = [["GET", "/me/payment-methods"], ["POST", "/me/payment-methods", bank], ["PATCH", "/me/payment-methods/1", { provider: "BNI" }], ["DELETE", "/me/payment-methods/1"], ["GET", "/groups/7/members/1/payment-methods"]];
    for (const [m, p, body] of semua) assert.equal((await minta(m, p, { body })).status, 401, m + " " + p);
    assert.deepEqual(panggilan, []);
  });

  it("GET daftar: 200 dengan { data } dan id pengguna dari token", async () => {
    panggilan.length = 0;
    const h = await minta("GET", "/me/payment-methods", { userId: 9 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: { n: "daftarSaya" } });
    assert.deepEqual(panggilan, [{ n: "daftarSaya", args: [9] }]);
  });

  it("POST: 201 dengan badan yang sudah dibersihkan; badan tidak sah 400 dan layanan tidak dipanggil", async () => {
    panggilan.length = 0;
    const h = await minta("POST", "/me/payment-methods", { userId: 9, body: { ...bank, provider: " BCA " } });
    assert.equal(h.status, 201);
    assert.deepEqual(h.body, { data: { n: "tambah" } });
    assert.deepEqual(panggilan, [{ n: "tambah", args: [9, bank] }]);
    panggilan.length = 0;
    for (const body of [{}, { kind: "CRYPTO" }, { kind: "BANK" }, { kind: "CASH", provider: "x" }, { ...bank, accountNo: "12ab" }]) {
      const g = await minta("POST", "/me/payment-methods", { userId: 9, body });
      assert.equal(g.status, 400, JSON.stringify(body));
      assert.equal(g.body.code, "validation-failed");
    }
    assert.deepEqual(panggilan, []);
  });

  it("POST CASH: hanya kind diteruskan", async () => {
    panggilan.length = 0;
    assert.equal((await minta("POST", "/me/payment-methods", { userId: 9, body: { kind: "CASH" } })).status, 201);
    assert.deepEqual(panggilan, [{ n: "tambah", args: [9, { kind: "CASH" }] }]);
  });

  it("PATCH: methodId menjadi number; badan kosong, kunci asing, dan id tak sah 400", async () => {
    panggilan.length = 0;
    const h = await minta("PATCH", "/me/payment-methods/12", { userId: 9, body: { provider: "BNI" } });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: { n: "ubah" } });
    assert.deepEqual(panggilan, [{ n: "ubah", args: [9, 12, { provider: "BNI" }] }]);
    panggilan.length = 0;
    for (const [id, body] of [["12", {}], ["12", { kind: "CASH" }], ["12", { isActive: true }], ["abc", { provider: "BNI" }], ["0", { provider: "BNI" }]]) {
      const g = await minta("PATCH", "/me/payment-methods/" + id, { userId: 9, body });
      assert.equal(g.status, 400, id + " " + JSON.stringify(body));
    }
    assert.deepEqual(panggilan, []);
  });

  it("DELETE: 204 tanpa isi; id tak sah 400", async () => {
    panggilan.length = 0;
    const h = await minta("DELETE", "/me/payment-methods/12", { userId: 9 });
    assert.equal(h.status, 204);
    assert.equal(h.body, null);
    assert.deepEqual(panggilan, [{ n: "nonaktifkan", args: [9, 12] }]);
    panggilan.length = 0;
    for (const id of ["abc", "0", "1.5"]) assert.equal((await minta("DELETE", "/me/payment-methods/" + id, { userId: 9 })).status, 400, id);
    assert.deepEqual(panggilan, []);
  });

  it("metode anggota: non-anggota dan grup tak ada 403, id tak sah 400, tidak ada yang sampai ke layanan", async () => {
    panggilan.length = 0;
    assert.equal((await minta("GET", "/groups/7/members/1/payment-methods", { userId: 4 })).status, 403);
    assert.equal((await minta("GET", "/groups/99/members/1/payment-methods", { userId: 1 })).status, 403);
    assert.equal((await minta("GET", "/groups/abc/members/1/payment-methods", { userId: 1 })).status, 400);
    for (const id of ["abc", "0", "fund", "1.5"]) {
      const h = await minta("GET", "/groups/7/members/" + id + "/payment-methods", { userId: 1 });
      assert.equal(h.status, 400, "userId " + id);
      assert.equal(h.body.code, "validation-failed");
    }
    assert.deepEqual(panggilan, []);
  });

  it("anggota ACTIVE, LEFT, dan REMOVED boleh masuk; layanan menerima pemanggil, grup, dan target", async () => {
    for (const userId of [1, 5, 2, 3]) {
      panggilan.length = 0;
      const h = await minta("GET", "/groups/7/members/5/payment-methods", { userId });
      assert.equal(h.status, 200, "pengguna " + userId);
      assert.deepEqual(h.body, { data: { n: "metodeAnggota" } });
      assert.deepEqual(panggilan, [{ n: "metodeAnggota", args: [{ userId, groupId: 7 }, 5] }]);
    }
    panggilan.length = 0;
    assert.equal((await minta("GET", "/groups/8/members/6/payment-methods", { userId: 1 })).status, 200);
    assert.deepEqual(panggilan, [{ n: "metodeAnggota", args: [{ userId: 1, groupId: 8 }, 6] }]);
  });
});
