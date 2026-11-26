// Layanan akun di SQL Server nyata dengan bcryptjs biaya produksi dan JWT sungguhan:
// pendaftaran atomik dengan AuditLog, email kembar (termasuk paralel dan beda huruf),
// login, profil, dan ganti password. AuditLog tambah-saja: tes tidak UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma, teksGalat } from "../helpers/db.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatLayananAkun } from "../../src/services/akun.js";
import { buatRouterAkun } from "../../src/routes/akun.router.js";

const SECRET = "rahasia-integrasi-yang-cukup-panjang-abcdef";
const lolos = (req, res, next) => next();
const emailBaru = () => "akun-" + randomUUID() + "@uji.test";

describe("akun di SQL Server", () => {
  let server;
  before(async () => {
    const layanan = buatLayananAkun({ db: prisma, jwtSecret: SECRET, jwtExpiresIn: "1h" });
    const pembatas = { daftar: lolos, loginIp: lolos, loginPasangan: lolos, passwordAkun: lolos };
    server = await mulaiAplikasi((app) => {
      const { auth, me } = buatRouterAkun({ layanan, requireAuth: buatRequireAuth({ secret: SECRET }), pembatas });
      app.use("/api/auth", auth);
      app.use("/api/me", me);
    });
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function kirim(path, { metode = "POST", body, token } = {}) {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(server.url + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
  }
  const daftar = (email, password = "rahasia-123") => kirim("/api/auth/register", { body: { email, password, name: "Rey" } });
  const masuk = (email, password = "rahasia-123") => kirim("/api/auth/login", { body: { email, password } });
  const auditUser = (userId, action) => prisma.auditLog.findMany({ where: { actorId: userId, action }, orderBy: { id: "asc" } });

  it("register: user tersimpan dengan hash bcrypt biaya 10; AuditLog REGISTER atomik, tanpa grup dan tanpa rahasia", async () => {
    const email = emailBaru();
    const r = await daftar(email);
    assert.equal(r.status, 201);
    const id = r.body.data.user.id;
    const baris = await prisma.user.findUnique({ where: { email } });
    assert.equal(baris.id, id);
    assert.match(baris.passwordHash, /^\$2[aby]\$10\$.{53}$/);
    assert.equal(baris.notifyByEmail, false);
    const a = await auditUser(id, "REGISTER");
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].groupId, a[0].entity, a[0].entityId, a[0].reason], [null, "User", id, null]);
    assert.deepEqual(Object.keys(JSON.parse(a[0].newValue)), ["ip"]);
    assert.equal(JSON.stringify(a).includes(baris.passwordHash), false);
    assert.equal(jwt.decode(r.body.data.accessToken, { complete: true }).header.alg, "HS256");
  });

  it("email kembar (juga beda huruf): 409 email-taken; database menolak beda huruf; satu baris", async () => {
    const email = emailBaru();
    assert.equal((await daftar(email)).status, 201);
    const kembar = await daftar(email.toUpperCase());
    assert.equal(kembar.status, 409);
    assert.equal(kembar.body.code, "email-taken");
    await assert.rejects(
      () => prisma.user.create({ data: { email: email.toUpperCase(), passwordHash: "x", name: "x" } }),
      (e) => /unique|P2002|duplicate/i.test(teksGalat(e)),
    );
    assert.equal(await prisma.user.count({ where: { email } }), 1);
  });

  it("lima pendaftaran paralel dengan email sama: tepat satu 201, sisanya 409, satu user, satu baris audit", async () => {
    const email = emailBaru();
    const semua = await Promise.all([1, 2, 3, 4, 5].map(() => daftar(email)));
    assert.deepEqual(semua.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
    for (const r of semua.filter((x) => x.status === 409)) assert.equal(r.body.code, "email-taken");
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    const menang = semua.find((r) => r.status === 201);
    assert.equal((await auditUser(menang.body.data.user.id, "REGISTER")).length, 1);
  });

  it("login: berhasil (juga beda huruf), password salah dan email tak dikenal sama persis", async () => {
    const email = emailBaru();
    const reg = await daftar(email);
    for (const e of [email, email.toUpperCase()]) {
      const r = await masuk(e);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.user.id, reg.body.data.user.id);
    }
    const salah = await masuk(email, "salah-salah");
    const tak = await masuk(emailBaru(), "salah-salah");
    assert.equal(salah.status, 401);
    assert.equal(salah.body.code, "invalid-credentials");
    assert.equal(salah.teks, tak.teks);
  });

  it("/me lewat requireAuth: GET dan PATCH; nama tersimpan dan tercatat; token rahasia lain ditolak", async () => {
    const email = emailBaru();
    const reg = await daftar(email);
    const token = reg.body.data.accessToken;
    const me = await kirim("/api/me", { metode: "GET", token });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, email);
    assert.equal(me.teks.includes("passwordHash"), false);
    const p = await kirim("/api/me", { metode: "PATCH", token, body: { name: "  Nama Baru " } });
    assert.equal(p.body.data.name, "Nama Baru");
    assert.equal((await prisma.user.findUnique({ where: { email } })).name, "Nama Baru");
    const a = await auditUser(reg.body.data.user.id, "PROFILE_UPDATE");
    assert.equal(a.length, 1);
    assert.deepEqual(JSON.parse(a[0].oldValue), { name: "Rey" });
    const asing = jwt.sign({ sub: String(reg.body.data.user.id) }, "rahasia-lain-yang-juga-cukup-panjang-123", { algorithm: "HS256" });
    assert.equal((await kirim("/api/me", { metode: "GET", token: asing })).status, 401);
  });

  it("ganti password: hash berubah, login lama gagal dan baru berhasil; audit tanpa password dan hash; salah 400", async () => {
    const email = emailBaru();
    const reg = await daftar(email);
    const token = reg.body.data.accessToken;
    const id = reg.body.data.user.id;
    const lama = (await prisma.user.findUnique({ where: { email } })).passwordHash;
    const salah = await kirim("/api/me/password", { token, body: { currentPassword: "bukan-ini", newPassword: "baru-passw0rd" } });
    assert.equal(salah.status, 400);
    assert.deepEqual(salah.body.errors, [{ field: "currentPassword", message: "Password saat ini salah" }]);
    assert.equal((await prisma.user.findUnique({ where: { email } })).passwordHash, lama);
    const r = await kirim("/api/me/password", { token, body: { currentPassword: "rahasia-123", newPassword: "baru-passw0rd" } });
    assert.equal(r.status, 200);
    const baru = (await prisma.user.findUnique({ where: { email } })).passwordHash;
    assert.notEqual(baru, lama);
    assert.match(baru, /^\$2[aby]\$10\$/);
    assert.equal((await masuk(email, "baru-passw0rd")).status, 200);
    assert.equal((await masuk(email, "rahasia-123")).status, 401);
    assert.equal((await kirim("/api/me", { metode: "GET", token: r.body.data.accessToken })).status, 200);
    const a = await auditUser(id, "PASSWORD_CHANGE");
    assert.equal(a.length, 1);
    const teksAudit = JSON.stringify(await prisma.auditLog.findMany({ where: { actorId: id } }));
    for (const rahasia of ["rahasia-123", "baru-passw0rd", lama, baru]) assert.equal(teksAudit.includes(rahasia), false);
  });
});
