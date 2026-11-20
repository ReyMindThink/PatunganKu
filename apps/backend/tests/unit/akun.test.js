import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatDbAkun } from "../helpers/fakeAkunDb.js";
import { buatLayananAkun } from "../../src/services/akun.js";
import { buatPembatasAkun, buatRouterAkun } from "../../src/routes/akun.router.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";

const SECRET = "rahasia-uji-yang-cukup-panjang-32-karakter-abc";
const BIAYA = 4;
const T0 = 1_700_000_000_000;
const MENIT = 60 * 1000;
const EMAIL = "rey@example.com";

describe("layanan dan router akun", () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));

  async function siap({ jwtExpiresIn = "1h", nyata = false } = {}) {
    const jam = { t: T0 };
    const f = buatDbAkun();
    const panggilan = { hash: [], bandingkan: [] };
    const fungsi = nyata ? {} : {
      hash: async (p, c) => { panggilan.hash.push([p, c]); return "h" + c + ":" + p; },
      bandingkan: async (p, h) => { panggilan.bandingkan.push([p, h]); return h === "h" + BIAYA + ":" + p; },
    };
    const layanan = buatLayananAkun({ db: f.db, jwtSecret: SECRET, jwtExpiresIn, biayaBcrypt: BIAYA, ...fungsi });
    const palsu = nyata ? null : panggilan.hash[0][0];
    panggilan.hash.length = 0;
    const server = await mulaiAplikasi((app) => {
      const pembatas = buatPembatasAkun({ sekarang: () => jam.t });
      const { auth, me } = buatRouterAkun({ layanan, requireAuth: buatRequireAuth({ secret: SECRET }), pembatas });
      app.use("/api/auth", auth);
      app.use("/api/me", me);
    });
    buka.push(server);
    const kirim = async (path, { metode = "POST", body, token } = {}) => {
      const headers = { "content-type": "application/json" };
      if (token) headers.authorization = "Bearer " + token;
      const res = await fetch(server.url + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const teks = await res.text();
      return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
    };
    const daftar = (email = EMAIL, lain = {}) => kirim("/api/auth/register", { body: { email, password: "rahasia-123", name: "Rey", ...lain } });
    const masuk = (email = EMAIL, password = "rahasia-123") => kirim("/api/auth/login", { body: { email, password } });
    return { jam, f, panggilan, palsu, kirim, daftar, masuk };
  }

  it("register: 201 dengan bentuk respons 14.1; hash tersimpan, tidak pernah dikirim balik", async () => {
    const { daftar, f } = await siap();
    const r = await daftar();
    assert.equal(r.status, 201);
    const d = r.body.data;
    assert.deepEqual(Object.keys(d).sort(), ["accessToken", "expiresIn", "refreshMode", "refreshToken", "user"]);
    assert.deepEqual([d.refreshToken, d.refreshMode, d.expiresIn], [null, "NONE", 3600]);
    assert.deepEqual(Object.keys(d.user).sort(), ["createdAt", "email", "id", "name", "notifyByEmail"]);
    assert.equal(f.user.length, 1);
    assert.equal(f.user[0].passwordHash, "h4:rahasia-123");
    assert.equal(r.teks.includes("h4:"), false);
  });

  it("token: HS256, sub berisi id, expiresIn dihitung dari token (15m jadi 900), diterima requireAuth", async () => {
    const { daftar, kirim } = await siap({ jwtExpiresIn: "15m" });
    const r = await daftar();
    const token = r.body.data.accessToken;
    const dekode = jwt.decode(token, { complete: true });
    assert.equal(dekode.header.alg, "HS256");
    assert.equal(dekode.payload.sub, String(r.body.data.user.id));
    assert.equal(r.body.data.expiresIn, 900);
    jwt.verify(token, SECRET, { algorithms: ["HS256"] });
    const me = await kirim("/api/me", { metode: "GET", token });
    assert.equal(me.status, 200);
  });

  it("register: email dipangkas dan huruf kecil; AuditLog REGISTER tanpa grup, tanpa rahasia", async () => {
    const { daftar, f } = await siap();
    const r = await daftar("  REY@Example.COM ");
    assert.equal(f.user[0].email, EMAIL);
    assert.equal(f.audit.length, 1);
    const a = f.audit[0];
    assert.deepEqual([a.groupId, a.actorId, a.entity, a.entityId, a.action, a.reason], [null, r.body.data.user.id, "User", r.body.data.user.id, "REGISTER", null]);
    assert.deepEqual(Object.keys(JSON.parse(a.newValue)), ["ip"]);
    assert.equal(JSON.stringify(f.audit).includes("rahasia-123"), false);
  });

  it("register dengan email terdaftar (juga beda huruf): 409 email-taken, tanpa menghitung hash baru", async () => {
    const { daftar, f, panggilan } = await siap();
    await daftar();
    assert.equal(panggilan.hash.length, 1);
    for (const email of [EMAIL, "REY@EXAMPLE.COM"]) {
      const r = await daftar(email);
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "email-taken");
      assert.match(r.res.headers.get("content-type"), /^application\/problem\+json/);
    }
    assert.equal(panggilan.hash.length, 1);
    assert.equal(f.user.length, 1);
    assert.equal(f.audit.length, 1);
  });

  it("register kalah balapan (pesaing menyisip sebelum create): 409 email-taken, tanpa baris audit", async () => {
    const { daftar, f } = await siap();
    f.s.sebelumCreate = () => f.tambahUser({ email: EMAIL, passwordHash: "h-lain", name: "Lain" });
    const r = await daftar();
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "email-taken");
    assert.deepEqual(f.user.map((u) => u.name), ["Lain"]);
    assert.equal(f.audit.length, 0);
  });

  it("register: galat database biasa menjadi 500 generik; audit gagal membatalkan pembuatan user", async (t) => {
    t.mock.method(console, "error", () => {});
    const { daftar, f } = await siap();
    f.s.gagalCreateUser = true;
    const a = await daftar();
    assert.equal(a.status, 500);
    assert.equal(a.body.code, "internal-error");
    assert.equal(a.teks.includes("db mati"), false);
    f.s.gagalCreateUser = false;
    f.s.gagalAudit = true;
    assert.equal((await daftar()).status, 500);
    assert.equal(f.user.length, 0);
    assert.equal(f.audit.length, 0);
  });

  it("register tidak valid: 400 validation-failed dengan errors per field; phone dibuang", async () => {
    const { daftar, kirim, f, panggilan } = await siap();
    const r = await kirim("/api/auth/register", { body: { email: "x", password: "1", name: "" } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "validation-failed");
    assert.deepEqual(r.body.errors.map((e) => e.field).sort(), ["email", "name", "password"]);
    assert.equal(panggilan.hash.length, 0);
    assert.equal((await daftar(EMAIL, { phone: "0812" })).status, 201);
    assert.equal("phone" in f.user[0], false);
  });

  it("login: 200 dengan bentuk 14.1; email beda huruf besar tetap masuk", async () => {
    const { daftar, masuk } = await siap();
    const reg = await daftar();
    for (const email of [EMAIL, " REY@Example.com "]) {
      const r = await masuk(email);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.body.data).sort(), ["accessToken", "expiresIn", "refreshMode", "refreshToken", "user"]);
      assert.equal(r.body.data.user.id, reg.body.data.user.id);
    }
  });

  it("login gagal: password salah dan email tak dikenal sama persis, masing-masing satu perbandingan hash", async () => {
    const { daftar, masuk, panggilan, palsu } = await siap();
    await daftar();
    panggilan.bandingkan.length = 0;
    const salah = await masuk(EMAIL, "salah-salah");
    assert.equal(panggilan.bandingkan.length, 1);
    const tak = await masuk("tidak@example.com", "salah-salah");
    assert.equal(panggilan.bandingkan.length, 2);
    assert.deepEqual(panggilan.bandingkan[1], ["salah-salah", "h4:" + palsu]);
    assert.equal(salah.status, 401);
    assert.equal(salah.body.code, "invalid-credentials");
    assert.equal(salah.teks, tak.teks);
    assert.equal(tak.status, 401);
    const cocokPalsu = await masuk("tidak@example.com", palsu);
    assert.equal(cocokPalsu.status, 401);
  });

  it("login: password lebih dari 72 byte ditolak 400 sebelum menyentuh hash", async () => {
    const { daftar, masuk, panggilan } = await siap();
    await daftar();
    panggilan.bandingkan.length = 0;
    const r = await masuk(EMAIL, "a".repeat(73));
    assert.equal(r.status, 400);
    assert.equal(r.body.errors[0].field, "password");
    assert.equal(panggilan.bandingkan.length, 0);
  });

  it("GET /me: wajib token; mengembalikan { data: user } tanpa hash; user hilang menjadi 401", async () => {
    const { daftar, kirim, f } = await siap();
    const reg = await daftar();
    const token = reg.body.data.accessToken;
    assert.equal((await kirim("/api/me", { metode: "GET" })).status, 401);
    const r = await kirim("/api/me", { metode: "GET", token });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ["createdAt", "email", "id", "name", "notifyByEmail"]);
    assert.equal(r.body.data.email, EMAIL);
    f.user.length = 0;
    const hilang = await kirim("/api/me", { metode: "GET", token });
    assert.equal(hilang.status, 401);
    assert.equal(hilang.body.code, "unauthorized");
  });

  it("PATCH /me: nama dipangkas dan dicatat di AuditLog; nama sama tidak menulis; email diabaikan; body kosong 400", async () => {
    const { daftar, kirim, f } = await siap();
    const token = (await daftar()).body.data.accessToken;
    const r = await kirim("/api/me", { metode: "PATCH", token, body: { name: "  Rey Baru ", email: "lain@example.com" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, "Rey Baru");
    assert.equal(f.user[0].email, EMAIL);
    const a = f.audit.filter((x) => x.action === "PROFILE_UPDATE");
    assert.equal(a.length, 1);
    assert.deepEqual(JSON.parse(a[0].oldValue), { name: "Rey" });
    assert.equal(JSON.parse(a[0].newValue).name, "Rey Baru");
    assert.equal(a[0].groupId, null);
    const sama = await kirim("/api/me", { metode: "PATCH", token, body: { name: "Rey Baru" } });
    assert.equal(sama.status, 200);
    assert.equal(f.audit.filter((x) => x.action === "PROFILE_UPDATE").length, 1);
    const kosong = await kirim("/api/me", { metode: "PATCH", token, body: {} });
    assert.equal(kosong.status, 400);
    assert.equal(kosong.body.errors[0].field, "name");
  });

  it("ganti password: 200 dengan token baru; login lama gagal, baru berhasil; audit tanpa rahasia", async () => {
    const { daftar, kirim, masuk, f } = await siap();
    const reg = await daftar();
    const r = await kirim("/api/me/password", { token: reg.body.data.accessToken, body: { currentPassword: "rahasia-123", newPassword: "baru-passw0rd" } });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ["accessToken", "expiresIn", "refreshMode", "refreshToken"]);
    assert.deepEqual([r.body.data.refreshToken, r.body.data.refreshMode, r.body.data.expiresIn], [null, "NONE", 3600]);
    assert.equal(f.user[0].passwordHash, "h4:baru-passw0rd");
    assert.equal((await masuk(EMAIL, "baru-passw0rd")).status, 200);
    assert.equal((await masuk(EMAIL, "rahasia-123")).status, 401);
    assert.equal((await kirim("/api/me", { metode: "GET", token: r.body.data.accessToken })).status, 200);
    const a = f.audit.filter((x) => x.action === "PASSWORD_CHANGE");
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].groupId, a[0].actorId], [null, reg.body.data.user.id]);
    assert.deepEqual(Object.keys(JSON.parse(a[0].newValue)), ["ip"]);
    const semua = JSON.stringify(f.audit);
    for (const rahasia of ["rahasia-123", "baru-passw0rd", "h4:"]) assert.equal(semua.includes(rahasia), false, rahasia);
  });

  it("ganti password: password saat ini salah 400 field currentPassword; password baru tidak valid 400; tidak ada perubahan", async () => {
    const { daftar, kirim, f } = await siap();
    const token = (await daftar()).body.data.accessToken;
    const salah = await kirim("/api/me/password", { token, body: { currentPassword: "bukan-ini", newPassword: "baru-passw0rd" } });
    assert.equal(salah.status, 400);
    assert.equal(salah.body.code, "validation-failed");
    assert.deepEqual(salah.body.errors, [{ field: "currentPassword", message: "Password saat ini salah" }]);
    const pendek = await kirim("/api/me/password", { token, body: { currentPassword: "rahasia-123", newPassword: "pendek" } });
    assert.equal(pendek.status, 400);
    assert.equal(pendek.body.errors[0].field, "newPassword");
    assert.equal(f.user[0].passwordHash, "h4:rahasia-123");
    assert.equal(f.audit.filter((x) => x.action === "PASSWORD_CHANGE").length, 0);
  });

  it("ganti password: audit gagal membatalkan penggantian hash", async (t) => {
    t.mock.method(console, "error", () => {});
    const { daftar, kirim, f } = await siap();
    const token = (await daftar()).body.data.accessToken;
    f.s.gagalAudit = true;
    const r = await kirim("/api/me/password", { token, body: { currentPassword: "rahasia-123", newPassword: "baru-passw0rd" } });
    assert.equal(r.status, 500);
    assert.equal(f.user[0].passwordHash, "h4:rahasia-123");
  });

  it("rute lama GET /api/auth/me sudah tidak ada: 404 problem+json", async () => {
    const { daftar, kirim } = await siap();
    const token = (await daftar()).body.data.accessToken;
    const r = await kirim("/api/auth/me", { metode: "GET", token });
    assert.equal(r.status, 404);
    assert.equal(r.body.code, "not-found");
  });

  it("dengan bcryptjs sungguhan: hash berawalan $2, masuk berhasil, password salah 401", async () => {
    const { daftar, masuk, f } = await siap({ nyata: true });
    await daftar();
    assert.match(f.user[0].passwordHash, /^\$2[aby]\$04\$/);
    assert.equal((await masuk()).status, 200);
    assert.equal((await masuk(EMAIL, "rahasia-124")).status, 401);
    assert.equal((await masuk("tidak@example.com")).status, 401);
  });

  it("batas laju login per pasangan IP+email: 10 percobaan, ke-11 429 Retry-After 900; email lain dan sesudah jendela lolos", async () => {
    const { daftar, masuk, jam } = await siap();
    await daftar();
    for (let i = 0; i < 10; i++) assert.equal((await masuk(EMAIL, "salah-salah")).status, 401);
    const r = await masuk(EMAIL, "salah-salah");
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "rate-limited");
    assert.equal(r.res.headers.get("retry-after"), "900");
    assert.equal((await masuk("lain@example.com", "salah-salah")).status, 401);
    jam.t = T0 + 15 * MENIT + 1;
    assert.equal((await masuk(EMAIL, "salah-salah")).status, 401);
  });

  it("batas laju login per IP: 50 percobaan dengan email berbeda, ke-51 429", async () => {
    const { masuk } = await siap();
    for (let i = 0; i < 50; i++) assert.equal((await masuk("u" + i + "@example.com", "salah-salah")).status, 401, "ke-" + (i + 1));
    const r = await masuk("u50@example.com", "salah-salah");
    assert.equal(r.status, 429);
    assert.equal(r.res.headers.get("retry-after"), "900");
  });

  it("batas laju register: 10 per jam per IP, ke-11 429 Retry-After 3600, lolos lagi sesudah satu jam", async () => {
    const { daftar, jam } = await siap();
    for (let i = 0; i < 10; i++) assert.equal((await daftar("r" + i + "@example.com")).status, 201, "ke-" + (i + 1));
    const r = await daftar("r10@example.com");
    assert.equal(r.status, 429);
    assert.equal(r.res.headers.get("retry-after"), "3600");
    jam.t = T0 + 60 * MENIT + 1;
    assert.equal((await daftar("r10@example.com")).status, 201);
  });

  it("batas laju ganti password: 5 per 15 menit per pengguna; pengguna lain tidak terpengaruh", async () => {
    const { daftar, kirim } = await siap();
    const a = (await daftar("a@example.com")).body.data.accessToken;
    const b = (await daftar("b@example.com")).body.data.accessToken;
    const coba = (token) => kirim("/api/me/password", { token, body: { currentPassword: "bukan-ini", newPassword: "baru-passw0rd" } });
    for (let i = 0; i < 5; i++) assert.equal((await coba(a)).status, 400);
    const r = await coba(a);
    assert.equal(r.status, 429);
    assert.equal(r.res.headers.get("retry-after"), "900");
    assert.equal((await coba(b)).status, 400);
  });
});
