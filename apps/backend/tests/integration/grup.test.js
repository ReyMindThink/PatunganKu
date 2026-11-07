// Grup dasar di SQL Server nyata (T1.5): router, layanan, requireAuth, requireActiveMember,
// idempotensi, dan pembatas laju asli. Tabel tambah-saja (AuditLog) tidak di-UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatAnggota } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { buatLayananGrup } from "../../src/services/grup.js";
import { buatRouterGrup } from "../../src/routes/grup.router.js";

const SECRET = "rahasia-integrasi-grup-yang-cukup-panjang-abcdef";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const POLA_KODE = /^[A-HJ-NP-Z2-9]{6}$/;

describe("grup di SQL Server", () => {
  let server;
  before(async () => {
    const router = buatRouterGrup({
      layanan: buatLayananGrup({ db: prisma }),
      requireAuth: buatRequireAuth({ secret: SECRET }),
      requireActiveMember: buatAkses({ db: prisma }).requireActiveMember,
      idempoten: buatIdempotensi({ db: prisma }).idempoten,
    });
    server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function kirim(path, { metode = "GET", body, user, kunci } = {}) {
    const headers = { "content-type": "application/json" };
    if (user) headers.authorization = "Bearer " + token(user.id);
    if (kunci) headers["idempotency-key"] = kunci;
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
  }
  const buatGrupApi = (user, name = "Grup Integrasi") => kirim("", { metode: "POST", user, kunci: randomUUID(), body: { name } });
  const gabungApi = (user, code, kunci = randomUUID()) => kirim("/join", { metode: "POST", user, kunci, body: { code } });
  const audit = (actorId, action) => prisma.auditLog.findMany({ where: { actorId, action }, orderBy: { id: "asc" } });
  const baris = (groupId, userId) => prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });

  it("buat grup: 201 tanpa email, kode sah, Group, OWNER, dan audit tersimpan; replay Idempotency-Key tidak membuat grup kedua", async () => {
    const a = await buatUser();
    const kunci = randomUUID();
    const r = await kirim("", { metode: "POST", user: a, kunci, body: { name: "  Kos Integrasi  " } });
    assert.equal(r.status, 201);
    const g = r.body.data;
    assert.match(g.code, POLA_KODE);
    assert.equal(g.name, "Kos Integrasi");
    assert.equal(g.myRole, "OWNER");
    assert.equal(g.memberCount, 1);
    assert.equal(r.teks.includes("@"), false, "email bocor di objek grup");
    const simpan = await prisma.group.findUnique({ where: { id: g.id } });
    assert.equal(simpan.createdBy, a.id);
    assert.equal(simpan.code, g.code);
    const pemilik = await baris(g.id, a.id);
    assert.equal(pemilik.role, "OWNER");
    assert.equal(pemilik.status, "ACTIVE");
    const log = await audit(a.id, "GROUP_CREATE");
    assert.equal(log.length, 1);
    assert.equal(log[0].groupId, g.id);
    assert.deepEqual(JSON.parse(log[0].newValue), { name: "Kos Integrasi" });

    const ulang = await kirim("", { metode: "POST", user: a, kunci, body: { name: "  Kos Integrasi  " } });
    assert.equal(ulang.status, 201);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    assert.equal(await prisma.group.count({ where: { createdBy: a.id } }), 1);
  });

  it("tanpa Idempotency-Key, POST / dan POST /join ditolak 400 pada field Idempotency-Key", async () => {
    const a = await buatUser();
    for (const [path, body] of [["", { name: "Kos" }], ["/join", { code: "ABC234" }]]) {
      const r = await kirim(path, { metode: "POST", user: a, body });
      assert.equal(r.status, 400, path);
      assert.equal(r.body.code, "validation-failed", path);
      assert.ok(r.body.errors.some((e) => e.field === "Idempotency-Key"), path);
    }
    assert.equal(await prisma.group.count({ where: { createdBy: a.id } }), 0);
  });

  it("daftar, detail, dan anggota: hitungan, urutan, peran, dan akses non-anggota", async () => {
    const a = await buatUser();
    const b = await buatUser();
    const c = await buatUser();
    const g1 = (await buatGrupApi(a, "Satu")).body.data;
    const g2 = (await buatGrupApi(a, "Dua")).body.data;
    assert.equal((await gabungApi(b, g1.code)).status, 200);

    const listB = (await kirim("", { user: b })).body.data;
    assert.equal(listB.length, 1);
    assert.equal(listB[0].id, g1.id);
    assert.equal(listB[0].memberCount, 2);
    assert.equal(listB[0].myRole, "MEMBER");
    assert.equal(listB[0].pendingJoinRequests, null);
    const listA = (await kirim("", { user: a })).body.data;
    assert.deepEqual(listA.map((x) => x.id), [g2.id, g1.id]);
    assert.deepEqual(listA.map((x) => x.pendingJoinRequests), [0, 0]);

    assert.equal((await kirim("/" + g1.id, { user: c })).status, 403);
    const det = await kirim("/" + g1.id, { user: b });
    assert.equal(det.status, 200);
    assert.equal(det.body.data.memberCount, 2);
    assert.equal(det.body.data.myRole, "MEMBER");

    const ang = await kirim("/" + g1.id + "/members", { user: a });
    assert.equal(ang.status, 200);
    assert.deepEqual(ang.body.data.map((x) => x.user.id), [a.id, b.id]);
    assert.deepEqual(ang.body.data.map((x) => x.role), ["OWNER", "MEMBER"]);
    assert.equal(ang.teks.includes("@"), false, "email bocor di daftar anggota");
  });

  it("gabung: kode huruf kecil berspasi JOINED, audit rejoin false, replay tidak menambah, already-member 409, kode salah 404", async () => {
    const a = await buatUser();
    const b = await buatUser();
    const g = (await buatGrupApi(a)).body.data;
    const kunci = randomUUID();
    const r = await gabungApi(b, "  " + g.code.toLowerCase() + " ", kunci);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.outcome, "JOINED");
    assert.equal(r.body.data.group.id, g.id);
    assert.equal(r.body.data.requestId, null);
    const anggota = await baris(g.id, b.id);
    assert.equal(anggota.role, "MEMBER");
    assert.equal(anggota.status, "ACTIVE");
    const log = await audit(b.id, "GROUP_JOIN");
    assert.equal(log.length, 1);
    assert.deepEqual(JSON.parse(log[0].newValue), { rejoin: false });

    const ulang = await gabungApi(b, g.code, kunci);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    assert.equal(await prisma.groupMember.count({ where: { groupId: g.id, userId: b.id } }), 1);
    assert.equal((await audit(b.id, "GROUP_JOIN")).length, 1);

    const lagi = await gabungApi(b, g.code);
    assert.equal(lagi.status, 409);
    assert.equal(lagi.body.code, "already-member");
    for (const salah of ["ZZZZZ9", "abc"]) {
      const h = await gabungApi(b, salah);
      assert.equal(h.status, 404, salah);
      assert.equal(h.body.code, "not-found", salah);
    }
  });

  it("bergabung kembali setelah LEFT menghidupkan baris yang sama; REMOVED ditolak invalid-state dan tidak punya akses", async () => {
    const a = await buatUser();
    const b = await buatUser();
    const g = (await buatGrupApi(a)).body.data;
    assert.equal((await gabungApi(b, g.code)).status, 200);
    const awal = await baris(g.id, b.id);
    const kunciBaris = { groupId_userId: { groupId: g.id, userId: b.id } };

    await prisma.groupMember.update({ where: kunciBaris, data: { role: "ADMIN", status: "LEFT", leftAt: new Date(), leftReason: "pindah kos" } });
    const kembali = await gabungApi(b, g.code);
    assert.equal(kembali.status, 200);
    const sesudah = await baris(g.id, b.id);
    assert.equal(sesudah.id, awal.id);
    assert.equal(sesudah.role, "MEMBER");
    assert.equal(sesudah.status, "ACTIVE");
    assert.equal(sesudah.leftAt, null);
    assert.equal(sesudah.leftReason, null);
    const log = await audit(b.id, "GROUP_JOIN");
    assert.equal(log.length, 2);
    assert.deepEqual(JSON.parse(log[1].newValue), { rejoin: true });

    await prisma.groupMember.update({ where: kunciBaris, data: { status: "REMOVED", leftAt: new Date(), leftReason: "dikeluarkan" } });
    const ditolak = await gabungApi(b, g.code);
    assert.equal(ditolak.status, 409);
    assert.equal(ditolak.body.code, "invalid-state");
    assert.equal((await kirim("/" + g.id, { user: b })).status, 403);
  });

  it("batas 50 anggota: lima penggabung serentak ke grup berisi 49 hanya satu yang lolos", async () => {
    const a = await buatUser();
    const g = (await buatGrupApi(a)).body.data;
    for (let i = 0; i < 48; i++) {
      const u = await buatUser();
      await buatAnggota(g.id, u.id, { role: "MEMBER", status: "ACTIVE" });
    }
    assert.equal(await prisma.groupMember.count({ where: { groupId: g.id, status: "ACTIVE" } }), 49);

    const calon = [];
    for (let i = 0; i < 5; i++) calon.push(await buatUser());
    const hasil = await Promise.all(calon.map((u) => gabungApi(u, g.code)));
    assert.deepEqual(hasil.map((h) => h.status).sort((x, y) => x - y), [200, 409, 409, 409, 409]);
    for (const h of hasil.filter((x) => x.status === 409)) assert.equal(h.body.code, "group-full");
    assert.equal(await prisma.groupMember.count({ where: { groupId: g.id, status: "ACTIVE" } }), 50);
    assert.equal(await prisma.auditLog.count({ where: { groupId: g.id, action: "GROUP_JOIN" } }), 1);

    const keenam = await buatUser();
    const lagi = await gabungApi(keenam, g.code);
    assert.equal(lagi.status, 409);
    assert.equal(lagi.body.code, "group-full");
  });
});
