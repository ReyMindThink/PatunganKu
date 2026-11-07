import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterApproval } from "../../src/routes/approval.router.js";

const SECRET = "rahasia-uji-router-approval-yang-cukup-panjang";
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

async function siapkan() {
  const { layanan, panggilan } = buatLayananPalsu();
  const lewatIdempoten = [];
  const idempoten = (fn) => async (req, res) => {
    lewatIdempoten.push(req.method + " " + req.route.path);
    const hasil = await fn(req, { tx: true });
    return res.status(hasil.status).json(hasil.body);
  };
  const router = buatRouterApproval({
    layanan,
    requireAuth: buatRequireAuth({ secret: SECRET }),
    requireActiveMember: buatAkses({ db: dbPalsu }).requireActiveMember,
    idempoten,
  });
  const server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  const minta = async (metode, path, { userId, body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (Number.isInteger(userId)) headers.authorization = "Bearer " + token(userId);
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
  };
  return { router, server, minta, panggilan, lewatIdempoten };
}

const rute = (router) =>
  router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => ({ path: l.route.path, metode: m.toUpperCase() })));
const SUKSES = { "GET /:groupId/approvals": 200, "GET /:groupId/approvals/:approvalId": 200, "POST /:groupId/approvals/:approvalId/votes": 201 };

describe("router approval", async () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));
  const mulai = async () => {
    const x = await siapkan();
    buka.push(x.server);
    return x;
  };

  it("setiap rute berparameter groupId: tanpa token 401; non-anggota, LEFT, REMOVED, grup tak ada 403; id tak sah 400; ACTIVE sukses", async () => {
    const { router, minta } = await mulai();
    const semua = rute(router);
    assert.equal(semua.length, 3);
    for (const r of semua) {
      assert.ok(r.path.includes(":groupId"), r.path);
      const nama = r.metode + " " + r.path;
      assert.ok(typeof SUKSES[nama] === "number", "rute baru tanpa nilai harapan: " + nama);
      const di = (grup, id = "31") => r.path.replace(":groupId", grup).replace(":approvalId", id);
      const body = r.metode === "POST" ? { vote: "APPROVE" } : undefined;
      assert.equal((await minta(r.metode, di("7"), { body })).status, 401, nama + " tanpa token");
      for (const [userId, grup, alasan] of [[4, "7", "bukan anggota"], [2, "7", "LEFT"], [3, "7", "REMOVED"], [1, "99", "grup tak ada"]]) {
        const h = await minta(r.metode, di(grup), { userId, body });
        assert.equal(h.status, 403, nama + " " + alasan);
        assert.equal(h.body.code, "forbidden", nama + " " + alasan);
      }
      for (const grup of ["abc", "0", "1.5"]) assert.equal((await minta(r.metode, di(grup), { userId: 1, body })).status, 400, nama + " groupId " + grup);
      if (r.path.includes(":approvalId")) {
        for (const id of ["abc", "0", "1.5"]) {
          const h = await minta(r.metode, di("7", id), { userId: 1, body });
          assert.equal(h.status, 400, nama + " approvalId " + id);
          assert.equal(h.body.code, "validation-failed");
        }
      }
      assert.equal((await minta(r.metode, di("7"), { userId: 1, body })).status, SUKSES[nama], nama + " anggota ACTIVE");
    }
  });

  it("GET daftar: query divalidasi sebelum layanan dan diteruskan lengkap; respons memuat page", async () => {
    const { minta, panggilan } = await mulai();
    for (const q of ["status=open", "status=DONE", "mine=yes", "limit=101", "limit=0"]) {
      assert.equal((await minta("GET", "/7/approvals?" + q, { userId: 1 })).status, 400, q);
    }
    assert.equal(panggilan.length, 0);
    const h = await minta("GET", "/7/approvals?mine=true&status=OPEN&limit=5", { userId: 5 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: [], page: { nextCursor: null, hasMore: false } });
    assert.deepEqual(panggilan, [{ nama: "daftar", args: [{ userId: 5, groupId: 7, role: "MEMBER" }, { limit: 5, status: "OPEN", mine: true }] }]);
  });

  it("GET detail memanggil layanan dengan konteks dari token dan keanggotaan", async () => {
    const { minta, panggilan } = await mulai();
    const h = await minta("GET", "/7/approvals/31", { userId: 1 });
    assert.deepEqual(h.body, { data: { nama: "detail" } });
    assert.deepEqual(panggilan, [{ nama: "detail", args: [{ userId: 1, groupId: 7, role: "OWNER" }, 31] }]);
  });

  it("POST votes: body divalidasi sebelum layanan; konteks dari token (bukan body); hanya POST yang lewat idempotensi", async () => {
    const { minta, panggilan, lewatIdempoten } = await mulai();
    for (const body of [{}, { vote: "approve" }, { vote: "ABSTAIN" }, { vote: "APPROVE", userId: 9 }]) {
      const h = await minta("POST", "/7/approvals/31/votes", { userId: 1, body });
      assert.equal(h.status, 400, JSON.stringify(body));
      assert.equal(h.body.code, "validation-failed");
    }
    assert.equal(panggilan.length, 0);
    assert.deepEqual(lewatIdempoten, []);
    const baik = await minta("POST", "/7/approvals/31/votes", { userId: 5, body: { vote: "REJECT" } });
    assert.equal(baik.status, 201);
    assert.deepEqual(baik.body, { data: { nama: "beriSuara" } });
    assert.deepEqual(panggilan, [{ nama: "beriSuara", args: [{ tx: true }, { userId: 5, groupId: 7, role: "MEMBER" }, 31, "REJECT"] }]);
    await minta("GET", "/7/approvals", { userId: 1 });
    await minta("GET", "/7/approvals/31", { userId: 1 });
    assert.deepEqual(lewatIdempoten, ["POST /:groupId/approvals/:approvalId/votes"]);
  });
});
