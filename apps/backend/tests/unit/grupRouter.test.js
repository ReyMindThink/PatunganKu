import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterGrup, buatPembatasGrup } from "../../src/routes/grup.router.js";

const SECRET = "rahasia-uji-router-grup-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const MENIT = 60 * 1000;

// Keanggotaan palsu: grup 7 dengan pengguna 1 OWNER ACTIVE, 2 LEFT, 3 REMOVED; 4 bukan anggota.
const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:2": { role: "MEMBER", status: "LEFT" },
  "7:3": { role: "MEMBER", status: "REMOVED" },
};
const dbPalsu = {
  groupMember: {
    findUnique: async ({ where }) => tabel[where.groupId_userId.groupId + ":" + where.groupId_userId.userId] ?? null,
  },
};

// Layanan palsu: setiap metode mencatat (nama, args) dan mengembalikan { nama }.
function buatLayananPalsu() {
  const panggilan = [];
  const layanan = new Proxy({}, {
    get: (_, nama) => async (...args) => {
      panggilan.push({ nama, args });
      return { nama };
    },
  });
  return { layanan, panggilan };
}

// idempoten palsu: menjalankan fn(req, { tx: true }) dan menjawab sesuai hasilnya.
const idempotenPalsu = (fn) => async (req, res) => {
  const hasil = await fn(req, { tx: true });
  res.status(hasil.status).json(hasil.body);
};

async function siapkan({ jam } = {}) {
  const { layanan, panggilan } = buatLayananPalsu();
  const akses = buatAkses({ db: dbPalsu });
  const pembatas = jam ? buatPembatasGrup({ sekarang: () => jam.t }) : buatPembatasGrup();
  const router = buatRouterGrup({
    layanan,
    requireAuth: buatRequireAuth({ secret: SECRET }),
    requireActiveMember: akses.requireActiveMember,
    idempoten: idempotenPalsu,
    pembatas,
  });
  const server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  const minta = async (metode, path, { userId, body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (Number.isInteger(userId)) headers.authorization = "Bearer " + token(userId);
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { res, status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  };
  return { router, server, minta, panggilan };
}

const rute = (router) =>
  router.stack
    .filter((l) => l.route)
    .flatMap((l) => Object.keys(l.route.methods).map((m) => ({ path: l.route.path, metode: m.toUpperCase() })));

describe("router grup", async () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));
  const mulai = async (opsi) => {
    const x = await siapkan(opsi);
    buka.push(x.server);
    return x;
  };

  it("setiap rute berparameter groupId: tanpa token 401; non-anggota, LEFT, REMOVED, grup tak ada 403; id tak sah 400; ACTIVE 200", async () => {
    const { router, minta } = await mulai();
    const berparameter = rute(router).filter((r) => r.path.includes(":groupId"));
    assert.ok(berparameter.length >= 2, "rute berparameter tidak ditemukan");
    for (const r of berparameter) {
      const di = (id) => r.path.replace(":groupId", id);
      const nama = r.metode + " " + r.path;
      assert.equal((await minta(r.metode, di(7))).status, 401, nama + " tanpa token");
      for (const [userId, id, alasan] of [[4, 7, "bukan anggota"], [2, 7, "LEFT"], [3, 7, "REMOVED"], [1, 99, "grup tak ada"]]) {
        const h = await minta(r.metode, di(id), { userId });
        assert.equal(h.status, 403, nama + " " + alasan);
        assert.equal(h.body.code, "forbidden", nama + " " + alasan);
      }
      for (const id of ["abc", "0", "1.5"]) {
        const h = await minta(r.metode, di(id), { userId: 1 });
        assert.equal(h.status, 400, nama + " id " + id);
        assert.equal(h.body.code, "validation-failed", nama + " id " + id);
      }
      assert.equal((await minta(r.metode, di(7), { userId: 1 })).status, 200, nama + " anggota ACTIVE");
    }
  });

  it("rute tanpa groupId menolak permintaan tanpa token", async () => {
    const { router, minta } = await mulai();
    const tanpa = rute(router).filter((r) => r.path.includes(":groupId") === false);
    assert.equal(tanpa.length, 3);
    for (const r of tanpa) {
      assert.equal((await minta(r.metode, r.path, { body: r.metode === "GET" ? undefined : { name: "Kos", code: "ABC234" } })).status, 401, r.metode + " " + r.path);
    }
  });

  it("POST / memvalidasi nama dan memanggil layanan.buat dengan tx, pengguna, dan nama terpangkas", async () => {
    const { minta, panggilan } = await mulai();
    const buruk = await minta("POST", "/", { userId: 1, body: { name: "   " } });
    assert.equal(buruk.status, 400);
    assert.equal(buruk.body.code, "validation-failed");
    assert.equal(panggilan.length, 0);
    const baik = await minta("POST", "/", { userId: 1, body: { name: "  Kos  " } });
    assert.equal(baik.status, 201);
    assert.deepEqual(panggilan, [{ nama: "buat", args: [{ tx: true }, 1, { name: "Kos" }] }]);
  });

  it("POST /join menormalisasi kode dan menolak kode kosong", async () => {
    const { minta, panggilan } = await mulai();
    assert.equal((await minta("POST", "/join", { userId: 1, body: { code: "" } })).status, 400);
    assert.equal(panggilan.length, 0);
    const baik = await minta("POST", "/join", { userId: 1, body: { code: " ab12cd " } });
    assert.equal(baik.status, 200);
    assert.deepEqual(panggilan, [{ nama: "gabung", args: [{ tx: true }, 1, { code: "AB12CD" }] }]);
  });

  it("batas laju gabung: 10 per pengguna, ke-11 429 dengan Retry-After; tak valid tidak dihitung; POST / tidak dibatasi; pulih setelah jendela", async () => {
    const jam = { t: 1_000_000 };
    const { minta } = await mulai({ jam });
    const gabung = (userId, code = "ABC234") => minta("POST", "/join", { userId, body: { code } });
    for (let i = 0; i < 10; i++) assert.equal((await gabung(1)).status, 200, "gabung ke-" + (i + 1));
    const tolak = await gabung(1);
    assert.equal(tolak.status, 429);
    assert.equal(tolak.body.code, "rate-limited");
    assert.equal(tolak.res.headers.get("retry-after"), "900");

    for (let i = 0; i < 12; i++) assert.equal((await gabung(2, "")).status, 400);
    for (let i = 0; i < 10; i++) assert.equal((await gabung(2)).status, 200, "pengguna lain ke-" + (i + 1));
    assert.equal((await gabung(2)).status, 429);

    for (let i = 0; i < 11; i++) assert.equal((await minta("POST", "/", { userId: 3, body: { name: "Kos" } })).status, 201);

    jam.t += 15 * MENIT + 1;
    assert.equal((await gabung(1)).status, 200);
  });

  it("GET memanggil layanan dengan argumen yang benar", async () => {
    const { minta, panggilan } = await mulai();
    assert.equal((await minta("GET", "/", { userId: 1 })).status, 200);
    assert.equal((await minta("GET", "/7", { userId: 1 })).status, 200);
    assert.equal((await minta("GET", "/7/members", { userId: 1 })).status, 200);
    assert.deepEqual(panggilan, [
      { nama: "daftarSaya", args: [1] },
      { nama: "detail", args: [7, { groupId: 7, role: "OWNER", status: "ACTIVE" }] },
      { nama: "anggota", args: [7] },
    ]);
  });
});
