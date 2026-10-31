// requireAuth dan requireActiveMember terhadap SQL Server nyata: pencarian groupId_userId
// lewat Prisma Client, plus token HS256 sungguhan. Aplikasi Express mini, tanpa env.js.
// Data uji unik per tes, tidak ada DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatAnggota, buatGrup, buatUser } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatAkses } from "../../src/middlewares/access.js";

const RAHASIA = "rahasia-tes-integrasi-lebih-dari-32-karakter";
const SEMUA = ["ACTIVE", "LEFT", "REMOVED"];
const requireAuth = buatRequireAuth({ secret: RAHASIA });
const { requireMember, requireActiveMember, requireRole } = buatAkses({ db: prisma });
const kirim = (req, res) => res.json({ membership: req.membership });

describe("akses grup: token HS256 dan keanggotaan di SQL Server", () => {
  let server;
  let grup;
  const u = {};

  const bearer = (user) => "Bearer " + jwt.sign({ sub: String(user.id) }, RAHASIA, { algorithm: "HS256", expiresIn: "1h" });
  async function panggil(jalur, user) {
    const headers = user === undefined ? {} : { authorization: bearer(user) };
    const res = await fetch(server.url + jalur, { headers });
    return { res, body: await res.json() };
  }

  before(async () => {
    for (const nama of ["pemilik", "admin", "anggota", "mantan", "dikeluarkan", "luar"]) u[nama] = await buatUser();
    grup = await buatGrup(u.pemilik.id);
    await buatAnggota(grup.id, u.pemilik.id, { role: "OWNER" });
    await buatAnggota(grup.id, u.admin.id, { role: "ADMIN" });
    await buatAnggota(grup.id, u.anggota.id);
    await buatAnggota(grup.id, u.mantan.id, { status: "LEFT", leftAt: new Date() });
    await buatAnggota(grup.id, u.dikeluarkan.id, { status: "REMOVED", leftAt: new Date() });

    server = await mulaiAplikasi((app) => {
      app.get("/g/:groupId/ping", requireAuth, requireActiveMember(), kirim);
      app.get("/g/:groupId/admin", requireAuth, requireActiveMember(), requireRole("OWNER", "ADMIN"), kirim);
      app.get("/g/:groupId/riwayat", requireAuth, requireMember("groupId", { status: SEMUA }), kirim);
    });
  });

  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  it("OWNER, ADMIN, dan MEMBER ACTIVE lolos dengan peran dari database", async () => {
    for (const [user, peran] of [[u.pemilik, "OWNER"], [u.admin, "ADMIN"], [u.anggota, "MEMBER"]]) {
      const { res, body } = await panggil("/g/" + grup.id + "/ping", user);
      assert.equal(res.status, 200, peran);
      assert.deepEqual(body.membership, { groupId: grup.id, role: peran, status: "ACTIVE" });
    }
  });

  it("non-anggota, mantan anggota (LEFT), dan yang dikeluarkan (REMOVED) mendapat 403 forbidden", async () => {
    for (const [user, label] of [[u.luar, "non-anggota"], [u.mantan, "LEFT"], [u.dikeluarkan, "REMOVED"]]) {
      const { res, body } = await panggil("/g/" + grup.id + "/ping", user);
      assert.equal(res.status, 403, label);
      assert.equal(body.code, "forbidden", label);
      assert.match(res.headers.get("content-type"), /^application\/problem\+json/, label);
    }
  });

  it("grup yang tidak ada mendapat 403, sama dengan non-anggota", async () => {
    const tidakAda = await panggil("/g/2147483647/ping", u.pemilik);
    const nonAnggota = await panggil("/g/" + grup.id + "/ping", u.luar);
    assert.equal(tidakAda.res.status, 403);
    assert.equal(tidakAda.body.detail, nonAnggota.body.detail);
  });

  it("id grup bukan angka sah mendapat 400 validation-failed", async () => {
    const { res, body } = await panggil("/g/abc/ping", u.pemilik);
    assert.equal(res.status, 400);
    assert.equal(body.code, "validation-failed");
  });

  it("requireRole: OWNER dan ADMIN lolos, MEMBER ACTIVE mendapat 403", async () => {
    assert.equal((await panggil("/g/" + grup.id + "/admin", u.pemilik)).res.status, 200);
    assert.equal((await panggil("/g/" + grup.id + "/admin", u.admin)).res.status, 200);
    assert.equal((await panggil("/g/" + grup.id + "/admin", u.anggota)).res.status, 403);
  });

  it("opsi status: mantan anggota lolos pada rute yang mengizinkannya, non-anggota tidak", async () => {
    const mantan = await panggil("/g/" + grup.id + "/riwayat", u.mantan);
    assert.equal(mantan.res.status, 200);
    assert.deepEqual(mantan.body.membership, { groupId: grup.id, role: "MEMBER", status: "LEFT" });
    assert.equal((await panggil("/g/" + grup.id + "/riwayat", u.dikeluarkan)).res.status, 200);
    assert.equal((await panggil("/g/" + grup.id + "/riwayat", u.luar)).res.status, 403);
  });

  it("tanpa token: 401, dan keanggotaan tidak diperiksa", async () => {
    const { res, body } = await panggil("/g/" + grup.id + "/ping");
    assert.equal(res.status, 401);
    assert.equal(body.code, "unauthorized");
  });
});
