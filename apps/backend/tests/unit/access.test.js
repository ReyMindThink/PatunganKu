import { describe, it, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";

// db palsu: tabel anggota { "groupId:userId": { role, status } }, dan catatan pemanggilan.
function buatDb(tabel, { galat = null } = {}) {
  const panggilan = [];
  return {
    panggilan,
    groupMember: {
      findUnique: async (arg) => {
        panggilan.push(arg);
        if (galat) throw galat;
        const { groupId, userId } = arg.where.groupId_userId;
        return tabel[groupId + ":" + userId] ?? null;
      },
    },
  };
}

const SEMUA = ["ACTIVE", "LEFT", "REMOVED"];
const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:2": { role: "ADMIN", status: "ACTIVE" },
  "7:3": { role: "MEMBER", status: "ACTIVE" },
  "7:4": { role: "MEMBER", status: "LEFT" },
  "7:5": { role: "MEMBER", status: "REMOVED" },
};

const db = buatDb(tabel);
const { requireMember, requireActiveMember, requireRole } = buatAkses({ db });

// Menyuntikkan req.user dari header uji x-user (menggantikan requireAuth).
const sebagai = (req, res, next) => {
  if (req.headers["x-user"]) req.user = { id: Number(req.headers["x-user"]) };
  next();
};
const kirim = (req, res) => res.json({ membership: req.membership ?? null });

let server;
async function panggil(jalur, user) {
  const res = await fetch(server.url + jalur, { headers: user === undefined ? {} : { "x-user": String(user) } });
  return { res, body: await res.json() };
}

describe("requireActiveMember dan requireMember", async () => {
  server = await mulaiAplikasi((app) => {
    app.get("/g/:groupId/ping", sebagai, requireActiveMember(), kirim);
    app.get("/k/:idGrup/ping", sebagai, requireActiveMember("idGrup"), kirim);
    app.get("/semua/:groupId/ping", sebagai, requireMember("groupId", { status: SEMUA }), kirim);
    app.get("/mantan/:groupId/ping", sebagai, requireMember("groupId", { status: ["LEFT"] }), kirim);
  });
  after(() => server.tutup());

  it("anggota ACTIVE lolos dan req.membership terisi", async () => {
    const { res, body } = await panggil("/g/7/ping", 3);
    assert.equal(res.status, 200);
    assert.deepEqual(body.membership, { groupId: 7, role: "MEMBER", status: "ACTIVE" });
  });

  it("mencari lewat kunci gabungan groupId_userId dengan angka, bukan teks", async () => {
    db.panggilan.length = 0;
    await panggil("/g/7/ping", 1);
    assert.equal(db.panggilan.length, 1);
    assert.deepEqual(db.panggilan[0].where, { groupId_userId: { groupId: 7, userId: 1 } });
  });

  it("non-anggota, grup yang tidak ada, LEFT, dan REMOVED semuanya 403 forbidden", async () => {
    const kasus = [
      ["/g/7/ping", 99, "non-anggota"],
      ["/g/2147483647/ping", 1, "grup tidak ada"],
      ["/g/7/ping", 4, "mantan anggota (LEFT)"],
      ["/g/7/ping", 5, "dikeluarkan (REMOVED)"],
    ];
    for (const [jalur, user, label] of kasus) {
      const { res, body } = await panggil(jalur, user);
      assert.equal(res.status, 403, label);
      assert.equal(body.code, "forbidden", label);
      assert.match(res.headers.get("content-type"), /^application\/problem\+json/, label);
    }
  });

  it("pesan 403 identik untuk semua penyebab (tidak membocorkan keberadaan grup atau status)", async () => {
    const pesan = new Set();
    for (const [jalur, user] of [["/g/7/ping", 99], ["/g/2147483647/ping", 1], ["/g/7/ping", 4], ["/g/7/ping", 5]]) {
      pesan.add((await panggil(jalur, user)).body.detail);
    }
    assert.equal(pesan.size, 1);
  });

  it("id grup bukan bilangan bulat sah: 400 validation-failed tanpa menyentuh database", async () => {
    db.panggilan.length = 0;
    for (const id of ["abc", "0", "1.5", "007", "99999999999", "2147483648"]) {
      const { res, body } = await panggil("/g/" + id + "/ping", 1);
      assert.equal(res.status, 400, "id " + id);
      assert.equal(body.code, "validation-failed", "id " + id);
      assert.equal(body.errors[0].field, "groupId", "id " + id);
    }
    assert.equal(db.panggilan.length, 0);
  });

  it("tanpa req.user: 401 unauthorized", async () => {
    const { res, body } = await panggil("/g/7/ping");
    assert.equal(res.status, 401);
    assert.equal(body.code, "unauthorized");
  });

  it("nama parameter dapat diubah", async () => {
    assert.equal((await panggil("/k/7/ping", 3)).res.status, 200);
    const { res, body } = await panggil("/k/abc/ping", 3);
    assert.equal(res.status, 400);
    assert.equal(body.errors[0].field, "idGrup");
  });

  it("opsi status: LEFT dan REMOVED lolos bila diizinkan, non-anggota tetap 403", async () => {
    for (const user of [3, 4, 5]) assert.equal((await panggil("/semua/7/ping", user)).res.status, 200, "user " + user);
    assert.equal((await panggil("/semua/7/ping", 99)).res.status, 403);
    const { body } = await panggil("/semua/7/ping", 4);
    assert.deepEqual(body.membership, { groupId: 7, role: "MEMBER", status: "LEFT" });
  });

  it("opsi status hanya LEFT: ACTIVE dan REMOVED ditolak", async () => {
    assert.equal((await panggil("/mantan/7/ping", 4)).res.status, 200);
    assert.equal((await panggil("/mantan/7/ping", 3)).res.status, 403);
    assert.equal((await panggil("/mantan/7/ping", 5)).res.status, 403);
  });

  it("status yang tidak dikenal ditolak saat pembuatan", () => {
    assert.throws(() => requireMember("groupId", { status: ["AKTIF"] }), /status/);
  });

  it("galat database menjadi 500 internal-error generik, detail tidak bocor", async () => {
    mock.method(console, "error", () => {});
    const akses = buatAkses({ db: buatDb({}, { galat: new Error("koneksi putus ke server-rahasia") }) });
    const s = await mulaiAplikasi((app) => {
      app.get("/g/:groupId/ping", sebagai, akses.requireActiveMember(), kirim);
    });
    try {
      const res = await fetch(s.url + "/g/7/ping", { headers: { "x-user": "1" } });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.code, "internal-error");
      assert.equal(JSON.stringify(body).includes("server-rahasia"), false);
    } finally {
      mock.restoreAll();
      await s.tutup();
    }
  });
});

describe("requireRole", async () => {
  let s;
  s = await mulaiAplikasi((app) => {
    app.get("/g/:groupId/admin", sebagai, requireActiveMember(), requireRole("OWNER", "ADMIN"), kirim);
    app.get("/g/:groupId/owner", sebagai, requireActiveMember(), requireRole("OWNER"), kirim);
    app.get("/g/:groupId/tanpa-member", sebagai, requireRole("OWNER"), kirim);
  });
  after(() => s.tutup());

  const minta = async (jalur, user) => {
    const res = await fetch(s.url + jalur, { headers: { "x-user": String(user) } });
    return { res, body: await res.json() };
  };

  it("peran dalam daftar lolos", async () => {
    assert.equal((await minta("/g/7/admin", 1)).res.status, 200);
    assert.equal((await minta("/g/7/admin", 2)).res.status, 200);
    assert.equal((await minta("/g/7/owner", 1)).res.status, 200);
  });

  it("peran di luar daftar: 403 forbidden problem+json", async () => {
    const a = await minta("/g/7/admin", 3);
    assert.equal(a.res.status, 403);
    assert.equal(a.body.code, "forbidden");
    assert.match(a.res.headers.get("content-type"), /^application\/problem\+json/);
    assert.equal((await minta("/g/7/owner", 2)).res.status, 403);
  });

  it("non-anggota tetap ditolak oleh requireMember sebelum peran diperiksa", async () => {
    assert.equal((await minta("/g/7/admin", 99)).res.status, 403);
    assert.equal((await minta("/g/7/admin", 4)).res.status, 403);
  });

  it("dipasang tanpa requireMember: 500 internal-error, bukan lolos diam-diam", async () => {
    mock.method(console, "error", () => {});
    try {
      const { res, body } = await minta("/g/7/tanpa-member", 1);
      assert.equal(res.status, 500);
      assert.equal(body.code, "internal-error");
    } finally {
      mock.restoreAll();
    }
  });

  it("argumen requireRole divalidasi saat pembuatan", () => {
    assert.throws(() => requireRole(), /minimal satu peran/);
    assert.throws(() => requireRole("SUPERUSER"), /peran/);
  });
});
