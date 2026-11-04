// Transaksi di SQL Server nyata (T1.7a): router, layanan, ledger, requireActiveMember, idempotensi,
// dan CHECK database yang asli. Tabel tambah-saja (AuditLog, LedgerEntry, ReceiptExtraction) tidak
// di-UPDATE atau DELETE. Struk diset lewat prisma karena unggah dan verifikasi baru ada di T1.7b.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatTransaksi } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananTransaksi } from "../../src/services/transaksi.js";
import { buatRouterTransaksi } from "../../src/routes/transaksi.router.js";

const SECRET = "rahasia-integrasi-transaksi-yang-cukup-panjang-abcdef";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const HARI_MS = 24 * 60 * 60 * 1000;
const layananLedger = buatLayananLedger({ db: prisma });

describe("transaksi di SQL Server", () => {
  let server;
  before(async () => {
    const router = buatRouterTransaksi({
      layanan: buatLayananTransaksi({ db: prisma, ledger: layananLedger }),
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
  const tulis = (path, metode, user, body) => kirim(path, { metode, user, body, kunci: randomUUID() });

  // Grup dengan n anggota ACTIVE (anggota pertama OWNER dan penalang).
  async function buatRuang(n = 3) {
    const user = [];
    for (let i = 0; i < n; i++) user.push(await buatUser());
    const grup = await buatGrup(user[0].id);
    for (let i = 0; i < n; i++) await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: "ACTIVE" });
    return { user, grup, base: "/" + grup.id + "/transactions" };
  }
  const buatDraft = async (r, ubah = {}) => (await tulis(r.base, "POST", r.user[0], { description: "Makan bersama", amount: 70000, ...ubah })).body.data;
  const siapKirim = (id, status = "VERIFIED") => prisma.transaction.update({ where: { id }, data: { receiptUrl: "https://blob.example/struk-uji.jpg", receiptStatus: status } });
  const ledgerDari = (id) => prisma.ledgerEntry.findMany({ where: { transactionId: id }, orderBy: { id: "asc" } });
  const shareDari = (id) => prisma.transactionShare.findMany({ where: { transactionId: id }, orderBy: { userId: "asc" } });

  it("buat DRAFT: 201 tanpa audit dan ledger (K19); replay Idempotency-Key tidak menggandakan; tanpa header 400", async () => {
    const r = await buatRuang(2);
    const kunci = randomUUID();
    const h = await kirim(r.base, { metode: "POST", user: r.user[0], kunci, body: { description: "  Makan  ", amount: 70000 } });
    assert.equal(h.status, 201);
    const t = h.body.data;
    assert.equal(t.description, "Makan");
    assert.equal(t.status, "DRAFT");
    assert.equal(t.mode, "EQUAL_ALL");
    assert.equal(t.receiptStatus, "PENDING");
    assert.equal(t.payer.id, r.user[0].id);
    assert.deepEqual(t.participants, []);
    const baris = await prisma.transaction.findUnique({ where: { id: t.id } });
    assert.equal(baris.groupId, r.grup.id);
    assert.equal(baris.payerId, r.user[0].id);
    assert.equal(baris.amount, 70000);
    assert.equal(await prisma.auditLog.count({ where: { transactionId: t.id } }), 0);
    assert.equal((await ledgerDari(t.id)).length, 0);

    const ulang = await kirim(r.base, { metode: "POST", user: r.user[0], kunci, body: { description: "  Makan  ", amount: 70000 } });
    assert.equal(ulang.status, 201);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    assert.equal(await prisma.transaction.count({ where: { groupId: r.grup.id } }), 1);

    const tanpa = await kirim(r.base, { metode: "POST", user: r.user[0], body: { description: "x", amount: 5 } });
    assert.equal(tanpa.status, 400);
    assert.ok(tanpa.body.errors.some((e) => e.field === "Idempotency-Key"));
  });

  it("validasi: nominal, deskripsi, mode, dan participants yang salah 400 tanpa baris baru", async () => {
    const r = await buatRuang(2);
    for (const body of [
      { description: "x", amount: 0 }, { description: "x", amount: 100000001 }, { description: "x", amount: 1.5 }, { description: "x", amount: "100" },
      { description: "  ", amount: 5 }, { description: "x", amount: 5, mode: "ITEMIZED" }, { description: "x", amount: 5, participants: [r.user[1].id] },
    ]) {
      const h = await tulis(r.base, "POST", r.user[0], body);
      assert.equal(h.status, 400, JSON.stringify(body));
      assert.equal(h.body.code, "validation-failed");
    }
    assert.equal(await prisma.transaction.count({ where: { groupId: r.grup.id } }), 0);
    assert.equal((await tulis(r.base, "POST", r.user[0], { description: "x", amount: 100000000 })).status, 201);
  });

  it("DRAFT hanya terlihat penalang: anggota lain 404 pada detail, ubah, hapus, dan submit; tidak muncul di daftar", async () => {
    const r = await buatRuang(2);
    const t = await buatDraft(r);
    const [a, b] = r.user;
    assert.equal((await kirim(r.base + "/" + t.id, { user: b })).status, 404);
    assert.equal((await tulis(r.base + "/" + t.id, "PATCH", b, { amount: 5 })).status, 404);
    assert.equal((await tulis(r.base + "/" + t.id, "DELETE", b)).status, 404);
    assert.equal((await tulis(r.base + "/" + t.id + "/submit", "POST", b)).status, 404);
    assert.equal((await kirim(r.base, { user: b })).body.data.length, 0);
    assert.equal((await kirim(r.base + "?status=DRAFT", { user: b })).body.data.length, 0);
    assert.deepEqual((await kirim(r.base + "?status=DRAFT", { user: a })).body.data.map((x) => x.id), [t.id]);
    assert.equal((await kirim(r.base, { user: a })).body.data.length, 0);
    assert.equal((await kirim(r.base + "/" + t.id, { user: a })).status, 200);
  });

  it("ubah DRAFT: nominal berubah membatalkan verifikasi struk; deskripsi saja tidak; setelah dikirim 409 untuk penalang dan 403 untuk lain", async () => {
    const r = await buatRuang(2);
    const t = await buatDraft(r);
    await siapKirim(t.id);
    const sama = await tulis(r.base + "/" + t.id, "PATCH", r.user[0], { description: "Makan malam" });
    assert.equal(sama.status, 200);
    assert.equal(sama.body.data.description, "Makan malam");
    assert.equal(sama.body.data.receiptStatus, "VERIFIED");
    const baru = await tulis(r.base + "/" + t.id, "PATCH", r.user[0], { amount: 80000 });
    assert.equal(baru.body.data.amount, 80000);
    assert.equal(baru.body.data.receiptStatus, "PENDING");
    assert.equal((await prisma.transaction.findUnique({ where: { id: t.id } })).receiptStatus, "PENDING");
    assert.equal((await tulis(r.base + "/" + t.id, "PATCH", r.user[0], {})).status, 400);
    assert.equal((await tulis(r.base + "/" + t.id, "PATCH", r.user[0], { amount: 100000001 })).status, 400);

    await prisma.transaction.update({ where: { id: t.id }, data: { status: "ACTIVE" } });
    const penalang = await tulis(r.base + "/" + t.id, "PATCH", r.user[0], { amount: 5 });
    assert.equal(penalang.status, 409);
    assert.equal(penalang.body.code, "invalid-state");
    assert.equal((await tulis(r.base + "/" + t.id, "PATCH", r.user[1], { amount: 5 })).status, 403);
  });

  it("hapus DRAFT: 204 dan baris hilang; bukan DRAFT 409; draft yang punya hasil ekstraksi struk 409 dan tetap ada", async () => {
    const r = await buatRuang(2);
    const t = await buatDraft(r);
    assert.equal((await tulis(r.base + "/" + t.id, "DELETE", r.user[0])).status, 204);
    assert.equal(await prisma.transaction.count({ where: { id: t.id } }), 0);
    assert.equal((await tulis(r.base + "/" + t.id, "DELETE", r.user[0])).status, 404);

    const aktif = await buatDraft(r);
    await prisma.transaction.update({ where: { id: aktif.id }, data: { status: "ACTIVE" } });
    assert.equal((await tulis(r.base + "/" + aktif.id, "DELETE", r.user[0])).status, 409);
    assert.equal((await tulis(r.base + "/" + aktif.id, "DELETE", r.user[1])).status, 403);

    const berstruk = await buatDraft(r);
    await prisma.receiptExtraction.create({ data: { transactionId: berstruk.id, version: 1, source: "AI" } });
    const h = await tulis(r.base + "/" + berstruk.id, "DELETE", r.user[0]);
    assert.equal(h.status, 409);
    assert.equal(h.body.code, "invalid-state");
    assert.equal(await prisma.transaction.count({ where: { id: berstruk.id } }), 1);
  });

  it("submit: tanpa struk 400 (field receipt); struk belum diverifikasi 409; tidak menulis share, CHARGE, atau audit", async () => {
    const r = await buatRuang(3);
    const t = await buatDraft(r);
    const tanpa = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0]);
    assert.equal(tanpa.status, 400);
    assert.ok(tanpa.body.errors.some((e) => e.field === "receipt"));
    await siapKirim(t.id, "PENDING");
    const belum = await tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0]);
    assert.equal(belum.status, 409);
    assert.equal(belum.body.code, "invalid-state");
    assert.equal((await shareDari(t.id)).length, 0);
    assert.equal((await ledgerDari(t.id)).length, 0);
    assert.equal(await prisma.auditLog.count({ where: { transactionId: t.id } }), 0);
    assert.equal((await prisma.transaction.findUnique({ where: { id: t.id } })).status, "DRAFT");
  });

  it("submit struk VERIFIED: ACTIVE; share merata 23.334/23.333/23.333; dua CHARGE ke penalang; audit; replay dan submit ulang tidak menggandakan", async () => {
    const r = await buatRuang(3);
    const [a, b, c] = r.user;
    const t = await buatDraft(r);
    await siapKirim(t.id);
    const kunci = randomUUID();
    const h = await kirim(r.base + "/" + t.id + "/submit", { metode: "POST", user: a, kunci });
    assert.equal(h.status, 200);
    assert.equal(h.body.data.approval, null);
    assert.equal(h.body.data.transaction.status, "ACTIVE");
    assert.equal(h.body.data.transaction.participants.length, 3);
    const baris = await prisma.transaction.findUnique({ where: { id: t.id } });
    assert.equal(baris.status, "ACTIVE");
    assert.equal(baris.expiresAt, null);

    const share = await shareDari(t.id);
    assert.deepEqual(share.map((s) => [s.userId, s.amount, s.consent]), [[a.id, 23334, "ACCEPTED"], [b.id, 23333, "ACCEPTED"], [c.id, 23333, "ACCEPTED"]]);
    const ledger = await ledgerDari(t.id);
    assert.deepEqual(ledger.map((l) => [l.type, l.sign, l.amount, l.debtorUserId, l.creditorUserId, l.category]), [
      ["CHARGE", 1, 23333n, b.id, a.id, "GROUP"], ["CHARGE", 1, 23333n, c.id, a.id, "GROUP"],
    ]);
    const log = await prisma.auditLog.findMany({ where: { transactionId: t.id, action: "TRANSACTION_SUBMIT" } });
    assert.equal(log.length, 1);
    assert.equal(log[0].actorId, a.id);
    assert.deepEqual(JSON.parse(log[0].newValue), { status: "ACTIVE", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "VERIFIED", participantCount: 3 });
    assert.deepEqual((await layananLedger.ringkasan(r.grup.id)).map((x) => x.balance), [46666, -23333, -23333]);

    const detail = await kirim(r.base + "/" + t.id, { user: b });
    assert.equal(detail.body.data.participants.length, 3);
    assert.deepEqual(detail.body.data.myShare, { amount: 23333, consent: "ACCEPTED" });
    assert.equal(detail.teks.includes("@"), false, "email bocor di detail transaksi");

    const ulang = await kirim(r.base + "/" + t.id + "/submit", { metode: "POST", user: a, kunci });
    assert.equal(ulang.status, 200);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    const lagi = await tulis(r.base + "/" + t.id + "/submit", "POST", a);
    assert.equal(lagi.status, 409);
    assert.equal((await shareDari(t.id)).length, 3);
    assert.equal((await ledgerDari(t.id)).length, 2);
    assert.equal(await prisma.auditLog.count({ where: { transactionId: t.id, action: "TRANSACTION_SUBMIT" } }), 1);
  });

  it("submit struk FAILED: PENDING_APPROVAL kedaluwarsa 7 hari, share ditulis, tanpa CHARGE; daftar peserta hanya untuk penalang dan admin", async () => {
    const r = await buatRuang(3);
    const [a, b, c] = r.user;
    const t = await buatDraft(r);
    await siapKirim(t.id, "FAILED");
    const mulai = Date.now();
    const h = await tulis(r.base + "/" + t.id + "/submit", "POST", a);
    assert.equal(h.status, 200);
    assert.equal(h.body.data.transaction.status, "PENDING_APPROVAL");
    const baris = await prisma.transaction.findUnique({ where: { id: t.id } });
    assert.ok(Math.abs(baris.expiresAt.getTime() - (mulai + 7 * HARI_MS)) < 60000, "kedaluwarsa harus sekitar 7 hari");
    assert.equal((await shareDari(t.id)).length, 3);
    assert.equal((await ledgerDari(t.id)).length, 0);
    assert.equal(JSON.parse((await prisma.auditLog.findFirst({ where: { transactionId: t.id } })).newValue).status, "PENDING_APPROVAL");

    const peserta = await kirim(r.base + "/" + t.id, { user: b });
    assert.equal(peserta.body.data.participants, null);
    assert.deepEqual(peserta.body.data.myShare, { amount: 23333, consent: "ACCEPTED" });
    assert.equal(peserta.body.data.participantCount, 3);
    assert.equal((await kirim(r.base + "/" + t.id, { user: a })).body.data.participants.length, 3);
    await prisma.groupMember.update({ where: { groupId_userId: { groupId: r.grup.id, userId: c.id } }, data: { role: "ADMIN" } });
    assert.equal((await kirim(r.base + "/" + t.id, { user: c })).body.data.participants.length, 3);
    assert.equal((await kirim(r.base + "/" + t.id, { user: b })).body.data.participants, null);
  });

  it("submit serentak dengan dua kunci berbeda: satu 200 dan satu 409; share, CHARGE, dan audit tidak ganda", async () => {
    const r = await buatRuang(3);
    const t = await buatDraft(r);
    await siapKirim(t.id);
    const hasil = await Promise.all([tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0]), tulis(r.base + "/" + t.id + "/submit", "POST", r.user[0])]);
    assert.deepEqual(hasil.map((h) => h.status).sort((x, y) => x - y), [200, 409]);
    assert.equal(hasil.find((h) => h.status === 409).body.code, "invalid-state");
    assert.equal((await shareDari(t.id)).length, 3);
    assert.equal((await ledgerDari(t.id)).length, 2);
    assert.equal(await prisma.auditLog.count({ where: { transactionId: t.id, action: "TRANSACTION_SUBMIT" } }), 1);
  });

  it("daftar: bulan menurut WIB (batas 00:00 WIB), terbaru dulu, seri waktu stabil lewat id, kursor lintas halaman, filter payerId, DRAFT tidak muncul", async () => {
    const r = await buatRuang(2);
    const [a, b] = r.user;
    const buat = (payer, createdAt, status = "ACTIVE") => buatTransaksi(r.grup.id, payer.id, { status, createdAt: new Date(createdAt) });
    const sep = await buat(a, "2026-09-30T16:59:00.000Z");
    const o1 = await buat(a, "2026-09-30T17:01:00.000Z");
    const o2a = await buat(a, "2026-10-15T03:00:00.000Z");
    const o2b = await buat(b, "2026-10-15T03:00:00.000Z");
    const o3 = await buat(a, "2026-10-31T16:59:00.000Z");
    const nov = await buat(a, "2026-10-31T17:01:00.000Z");
    await buat(a, "2026-10-20T00:00:00.000Z", "DRAFT");
    const ids = async (query) => (await kirim(r.base + "?" + query, { user: b })).body.data.map((x) => x.id);

    assert.deepEqual(await ids("month=2026-10"), [o3.id, o2b.id, o2a.id, o1.id]);
    assert.deepEqual(await ids("month=2026-09"), [sep.id]);
    assert.deepEqual(await ids("month=2026-11"), [nov.id]);
    assert.deepEqual(await ids("month=2026-10&payerId=" + b.id), [o2b.id]);

    const halaman1 = await kirim(r.base + "?month=2026-10&limit=2", { user: b });
    assert.deepEqual(halaman1.body.data.map((x) => x.id), [o3.id, o2b.id]);
    assert.equal(halaman1.body.page.hasMore, true);
    const halaman2 = await kirim(r.base + "?month=2026-10&limit=2&cursor=" + halaman1.body.page.nextCursor, { user: b });
    assert.deepEqual(halaman2.body.data.map((x) => x.id), [o2a.id, o1.id]);
    assert.deepEqual(halaman2.body.page, { nextCursor: null, hasMore: false });

    const satuSatu = [];
    let kursor = "";
    for (let i = 0; i < 10; i++) {
      const h = await kirim(r.base + "?month=2026-10&limit=1" + kursor, { user: b });
      satuSatu.push(...h.body.data.map((x) => x.id));
      if (h.body.page.hasMore === false) break;
      kursor = "&cursor=" + h.body.page.nextCursor;
    }
    assert.deepEqual(satuSatu, [o3.id, o2b.id, o2a.id, o1.id]);
    assert.equal((await kirim(r.base + "?cursor=rusak", { user: b })).status, 400);
  });

  it("isolasi grup: transaksi grup lain tidak dapat dibaca atau diubah lewat grup yang dimasuki pengguna", async () => {
    const r1 = await buatRuang(2);
    const r2 = await buatRuang(2);
    await buatAnggota(r2.grup.id, r1.user[0].id, { role: "MEMBER", status: "ACTIVE" });
    const t = await buatTransaksi(r1.grup.id, r1.user[0].id, { status: "ACTIVE" });
    const lewat = "/" + r2.grup.id + "/transactions/" + t.id;
    assert.equal((await kirim(lewat, { user: r1.user[0] })).status, 404);
    assert.equal((await tulis(lewat, "PATCH", r1.user[0], { amount: 5 })).status, 404);
    assert.equal((await tulis(lewat, "DELETE", r1.user[0])).status, 404);
    assert.equal((await tulis(lewat + "/submit", "POST", r1.user[0])).status, 404);
    assert.equal((await kirim(r2.base, { user: r1.user[0] })).body.data.length, 0);
    assert.equal((await kirim(r1.base + "/" + t.id, { user: r1.user[0] })).status, 200);
  });
});
