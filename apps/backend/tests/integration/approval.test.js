// Persetujuan di SQL Server nyata (T1.8): router transaksi (submit), router approval, ringkasan,
// layanan, ledger, idempotensi, dan CHECK database yang asli. Tabel tambah-saja (AuditLog,
// LedgerEntry, ReceiptExtraction) tidak di-UPDATE atau DELETE. Struk diset lewat prisma.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananTransaksi } from "../../src/services/transaksi.js";
import { buatLayananApproval } from "../../src/services/approval.js";
import { buatRouterTransaksi } from "../../src/routes/transaksi.router.js";
import { buatRouterApproval } from "../../src/routes/approval.router.js";
import { buatRouterRingkasan } from "../../src/routes/ringkasan.router.js";

const SECRET = "rahasia-integrasi-approval-yang-cukup-panjang-abcdef";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const layananLedger = buatLayananLedger({ db: prisma });

describe("persetujuan di SQL Server", () => {
  let server;
  before(async () => {
    const requireAuth = buatRequireAuth({ secret: SECRET });
    const requireActiveMember = buatAkses({ db: prisma }).requireActiveMember;
    const idempoten = buatIdempotensi({ db: prisma }).idempoten;
    const layananApproval = buatLayananApproval({ db: prisma, ledger: layananLedger });
    server = await mulaiAplikasi((app) => {
      app.use("/api/groups", buatRouterTransaksi({ layanan: buatLayananTransaksi({ db: prisma, ledger: layananLedger }), requireAuth, requireActiveMember, idempoten }));
      app.use("/api/groups", buatRouterApproval({ layanan: layananApproval, requireAuth, requireActiveMember, idempoten }));
      app.use("/api/me", buatRouterRingkasan({ jumlahPerluSuara: layananApproval.jumlahPerluSuara, requireAuth }));
    });
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function kirim(path, { metode = "GET", body, user, kunci } = {}) {
    const headers = { "content-type": "application/json" };
    if (user) headers.authorization = "Bearer " + token(user.id);
    if (kunci) headers["idempotency-key"] = kunci;
    const res = await fetch(server.url + "/api" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
  }
  const tulis = (path, metode, user, body) => kirim(path, { metode, user, body, kunci: randomUUID() });
  const pilih = (r, user, vote, idApproval) => tulis(r.a + "/" + idApproval + "/votes", "POST", user, { vote });

  // Grup dengan anggota ACTIVE berperan sesuai daftar (anggota pertama harus OWNER).
  async function buatRuang(peran) {
    const user = [];
    for (let i = 0; i < peran.length; i++) user.push(await buatUser());
    const grup = await buatGrup(user[0].id);
    for (let i = 0; i < peran.length; i++) await buatAnggota(grup.id, user[i].id, { role: peran[i], status: "ACTIVE" });
    return { user, grup, t: "/groups/" + grup.id + "/transactions", a: "/groups/" + grup.id + "/approvals" };
  }
  // Satu transaksi Rp70.000 berstruk FAILED yang dikirim penalang.
  async function ajukan(r, penalang) {
    const dibuat = await tulis(r.t, "POST", penalang, { description: "Makan bersama", amount: 70000 });
    const id = dibuat.body.data.id;
    await prisma.transaction.update({ where: { id }, data: { receiptUrl: "https://blob.example/struk-uji.jpg", receiptStatus: "FAILED" } });
    const h = await tulis(r.t + "/" + id + "/submit", "POST", penalang);
    return { id, h, approvalId: h.body.data.approval === null ? null : h.body.data.approval.id };
  }
  const trx = (id) => prisma.transaction.findUnique({ where: { id } });
  const apr = (id) => prisma.approval.findUnique({ where: { id } });
  const ledgerDari = (id) => prisma.ledgerEntry.findMany({ where: { transactionId: id }, orderBy: { id: "asc" } });
  const auditDari = (id) => prisma.auditLog.findMany({ where: { transactionId: id }, orderBy: { id: "asc" } });
  const aksi = async (id) => (await auditDari(id)).map((x) => x.action);

  it("pengaju MEMBER, struk gagal AI: Approval ADMIN_ANY; admin menyetujui menjadi ACTIVE dengan CHARGE, saldo, audit, dan ringkasan", async () => {
    const r = await buatRuang(["OWNER", "ADMIN", "MEMBER", "MEMBER"]);
    const [pemilik, admin, penalang, biasa] = r.user;
    const { id, h, approvalId } = await ajukan(r, penalang);
    assert.equal(h.status, 200);
    assert.equal(h.body.data.transaction.status, "PENDING_APPROVAL");
    const a = h.body.data.approval;
    assert.deepEqual([a.rule, a.eligibleCount, a.required, a.status, a.canVote, a.requestedBy.id, a.subject.transactionId], ["ADMIN_ANY", 2, 1, "OPEN", false, penalang.id, id]);
    assert.equal(await prisma.approval.count({ where: { subjectId: id } }), 1);
    assert.equal((await ledgerDari(id)).length, 0);

    const punyaPemilik = await kirim(r.a + "?mine=true", { user: pemilik });
    assert.equal(punyaPemilik.body.data.length, 1);
    assert.equal(punyaPemilik.body.data[0].canVote, true);
    assert.equal((await kirim(r.a + "?mine=true", { user: penalang })).body.data.length, 0);
    assert.equal((await kirim(r.a + "?mine=true", { user: biasa })).body.data.length, 0);
    assert.equal((await kirim(r.a + "/" + approvalId, { user: biasa })).body.data.canVote, false);
    assert.equal((await kirim("/me/summary", { user: pemilik })).body.data.approvalsToVote, 1);
    assert.equal((await kirim("/me/summary", { user: penalang })).body.data.approvalsToVote, 0);

    const suara = await pilih(r, pemilik, "APPROVE", approvalId);
    assert.equal(suara.status, 201);
    assert.deepEqual([suara.body.data.status, suara.body.data.approveCount, suara.body.data.myVote, suara.body.data.canVote], ["APPROVED", 1, "APPROVE", false]);
    const baris = await trx(id);
    assert.equal(baris.status, "ACTIVE");
    assert.equal(baris.expiresAt, null);
    const entri = await ledgerDari(id);
    assert.equal(entri.length, 3);
    for (const e of entri) assert.deepEqual([e.type, Number(e.amount), e.creditorUserId, e.createdBy], ["CHARGE", 17500, penalang.id, penalang.id]);
    assert.equal(await layananLedger.saldoPasangan(r.grup.id, pemilik.id, penalang.id), 17500);
    assert.equal(await layananLedger.saldoPasangan(r.grup.id, penalang.id, biasa.id), -17500);
    assert.deepEqual(await aksi(id), ["TRANSACTION_SUBMIT", "APPROVAL_VOTE", "TRANSACTION_APPROVE"]);
    assert.deepEqual((await auditDari(id)).map((x) => x.actorId), [penalang.id, pemilik.id, pemilik.id]);
    assert.equal((await apr(approvalId)).status, "APPROVED");
    assert.equal((await kirim("/me/summary", { user: pemilik })).body.data.approvalsToVote, 0);
    assert.equal((await kirim("/me/summary", { user: admin })).body.data.approvalsToVote, 0);
  });

  it("admin menolak: Approval dan transaksi REJECTED, tanpa CHARGE; suara berikutnya 409 invalid-state", async () => {
    const r = await buatRuang(["OWNER", "MEMBER"]);
    const [pemilik, penalang] = r.user;
    const { id, approvalId } = await ajukan(r, penalang);
    const suara = await pilih(r, pemilik, "REJECT", approvalId);
    assert.equal(suara.status, 201);
    assert.deepEqual([suara.body.data.status, suara.body.data.rejectCount], ["REJECTED", 1]);
    assert.equal((await trx(id)).status, "REJECTED");
    assert.equal((await ledgerDari(id)).length, 0);
    assert.equal(await prisma.transactionShare.count({ where: { transactionId: id } }), 2);
    assert.deepEqual(await aksi(id), ["TRANSACTION_SUBMIT", "APPROVAL_VOTE", "TRANSACTION_REJECT"]);
    const lagi = await pilih(r, pemilik, "APPROVE", approvalId);
    assert.equal(lagi.status, 409);
    assert.equal(lagi.body.code, "invalid-state");
    assert.equal((await trx(id)).status, "REJECTED");
  });

  it("admin tunggal dengan enam anggota lain: QUORUM_20 butuh 2; satu suara belum cukup, suara ganda 409 already-voted, suara kedua menyetujui", async () => {
    const r = await buatRuang(["OWNER", "MEMBER", "MEMBER", "MEMBER", "MEMBER", "MEMBER", "MEMBER"]);
    const [pemilik, m1, m2] = r.user;
    const { id, h, approvalId } = await ajukan(r, pemilik);
    const a = h.body.data.approval;
    assert.deepEqual([a.rule, a.eligibleCount, a.required], ["QUORUM_20", 6, 2]);
    assert.equal((await kirim(r.a + "/" + approvalId, { user: m1 })).body.data.canVote, true);

    const pertama = await pilih(r, m1, "APPROVE", approvalId);
    assert.equal(pertama.status, 201);
    assert.deepEqual([pertama.body.data.status, pertama.body.data.approveCount, pertama.body.data.canVote], ["OPEN", 1, false]);
    assert.equal((await trx(id)).status, "PENDING_APPROVAL");
    assert.equal((await ledgerDari(id)).length, 0);
    const ganda = await pilih(r, m1, "REJECT", approvalId);
    assert.equal(ganda.status, 409);
    assert.equal(ganda.body.code, "already-voted");
    assert.equal(await prisma.approvalVote.count({ where: { approvalId } }), 1);

    const kedua = await pilih(r, m2, "APPROVE", approvalId);
    assert.equal(kedua.body.data.status, "APPROVED");
    assert.equal((await trx(id)).status, "ACTIVE");
    const entri = await ledgerDari(id);
    assert.equal(entri.length, 6);
    for (const e of entri) assert.equal(Number(e.amount), 10000);
    assert.deepEqual(await aksi(id), ["TRANSACTION_SUBMIT", "APPROVAL_VOTE", "APPROVAL_VOTE", "TRANSACTION_APPROVE"]);
  });

  it("QUORUM_20 menolak tepat saat persetujuan mustahil: empat penolakan dari enam masih OPEN, yang kelima menolak", async () => {
    const r = await buatRuang(["OWNER", "MEMBER", "MEMBER", "MEMBER", "MEMBER", "MEMBER", "MEMBER"]);
    const [pemilik, ...anggota] = r.user;
    const { id, approvalId } = await ajukan(r, pemilik);
    for (let i = 0; i < 4; i++) {
      const h = await pilih(r, anggota[i], "REJECT", approvalId);
      assert.equal(h.body.data.status, "OPEN", "penolakan ke-" + (i + 1));
    }
    assert.equal((await trx(id)).status, "PENDING_APPROVAL");
    const kelima = await pilih(r, anggota[4], "REJECT", approvalId);
    assert.deepEqual([kelima.body.data.status, kelima.body.data.rejectCount], ["REJECTED", 5]);
    assert.equal((await trx(id)).status, "REJECTED");
    assert.equal((await ledgerDari(id)).length, 0);
    assert.equal((await pilih(r, anggota[5], "APPROVE", approvalId)).status, 409);
    assert.equal(await prisma.approvalVote.count({ where: { approvalId } }), 5);
  });

  it("hak akses: pengaju 403, MEMBER pada ADMIN_OTHER 403, bukan anggota 403, grup lain 404; tidak ada yang tertulis", async () => {
    const r = await buatRuang(["OWNER", "ADMIN", "MEMBER"]);
    const [pemilik, admin, biasa] = r.user;
    const { id, h, approvalId } = await ajukan(r, pemilik);
    assert.deepEqual([h.body.data.approval.rule, h.body.data.approval.eligibleCount], ["ADMIN_OTHER", 1]);
    for (const [user, alasan] of [[pemilik, "pengaju"], [biasa, "MEMBER pada rule admin"], [await buatUser(), "bukan anggota"]]) {
      const x = await pilih(r, user, "APPROVE", approvalId);
      assert.equal(x.status, 403, alasan);
      assert.equal(x.body.code, "forbidden", alasan);
    }
    const lain = await buatRuang(["OWNER", "MEMBER"]);
    const asing = await pilih(lain, lain.user[0], "APPROVE", approvalId);
    assert.equal(asing.status, 404);
    assert.equal((await kirim(lain.a + "/" + approvalId, { user: lain.user[0] })).status, 404);
    assert.equal(await prisma.approvalVote.count({ where: { approvalId } }), 0);
    assert.equal((await apr(approvalId)).status, "OPEN");
    assert.equal((await trx(id)).status, "PENDING_APPROVAL");
    assert.equal((await pilih(r, admin, "APPROVE", approvalId)).body.data.status, "APPROVED");
  });

  it("kedaluwarsa dievaluasi saat dibaca: Approval dan transaksi EXPIRED, satu audit tanpa pelaku; daftar juga mengevaluasi; suara berikutnya 409", async () => {
    const r = await buatRuang(["OWNER", "MEMBER"]);
    const [pemilik, penalang] = r.user;
    const { id, approvalId } = await ajukan(r, penalang);
    await prisma.approval.update({ where: { id: approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const detail = await kirim(r.a + "/" + approvalId, { user: pemilik });
    assert.deepEqual([detail.body.data.status, detail.body.data.canVote], ["EXPIRED", false]);
    assert.equal((await apr(approvalId)).status, "EXPIRED");
    assert.notEqual((await apr(approvalId)).decidedAt, null);
    assert.equal((await trx(id)).status, "EXPIRED");
    assert.equal((await auditDari(id)).filter((x) => x.action === "TRANSACTION_EXPIRE" && x.actorId === null).length, 1);
    await kirim(r.a + "/" + approvalId, { user: pemilik });
    assert.equal((await aksi(id)).filter((x) => x === "TRANSACTION_EXPIRE").length, 1);
    const suara = await pilih(r, pemilik, "APPROVE", approvalId);
    assert.equal(suara.status, 409);
    assert.equal(suara.body.code, "invalid-state");
    assert.equal((await ledgerDari(id)).length, 0);

    const dua = await ajukan(r, penalang);
    await prisma.approval.update({ where: { id: dua.approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const daftar = await kirim(r.a + "?status=EXPIRED", { user: penalang });
    assert.ok(daftar.body.data.some((x) => x.id === dua.approvalId), "daftar memuat Approval yang baru kedaluwarsa");
    assert.equal((await trx(dua.id)).status, "EXPIRED");
  });

  it("suara pada Approval yang sudah lewat batas: 409, tetapi kedaluwarsa tetap tersimpan (klien utama), tanpa suara", async () => {
    const r = await buatRuang(["OWNER", "MEMBER"]);
    const [pemilik, penalang] = r.user;
    const { id, approvalId } = await ajukan(r, penalang);
    await prisma.approval.update({ where: { id: approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const suara = await pilih(r, pemilik, "APPROVE", approvalId);
    assert.equal(suara.status, 409);
    assert.equal(suara.body.code, "invalid-state");
    assert.equal((await apr(approvalId)).status, "EXPIRED");
    assert.equal((await trx(id)).status, "EXPIRED");
    assert.equal(await prisma.approvalVote.count({ where: { approvalId } }), 0);
    assert.equal((await aksi(id)).filter((x) => x === "TRANSACTION_EXPIRE").length, 1);
  });

  it("suara penentu serentak (tiga admin, kunci berbeda): tepat satu 201 dan dua 409; satu keputusan, satu suara, CHARGE tidak ganda", async () => {
    const r = await buatRuang(["OWNER", "ADMIN", "ADMIN", "MEMBER"]);
    const [pemilik, a2, a3, penalang] = r.user;
    const { id, approvalId } = await ajukan(r, penalang);
    const hasil = await Promise.all([pilih(r, pemilik, "APPROVE", approvalId), pilih(r, a2, "REJECT", approvalId), pilih(r, a3, "APPROVE", approvalId)]);
    assert.deepEqual(hasil.map((x) => x.status).sort(), [201, 409, 409]);
    for (const x of hasil.filter((y) => y.status === 409)) assert.equal(x.body.code, "invalid-state");
    const menang = hasil.find((x) => x.status === 201).body.data.status;
    assert.ok(menang === "APPROVED" || menang === "REJECTED");
    assert.equal((await apr(approvalId)).status, menang);
    assert.equal((await trx(id)).status, menang === "APPROVED" ? "ACTIVE" : "REJECTED");
    assert.equal(await prisma.approvalVote.count({ where: { approvalId } }), 1);
    assert.equal((await ledgerDari(id)).length, menang === "APPROVED" ? 3 : 0);
    assert.equal((await aksi(id)).filter((x) => x === "TRANSACTION_APPROVE" || x === "TRANSACTION_REJECT").length, 1);
  });

  it("tiga suara setuju serentak pada QUORUM_20 (required 2): dua 201 dan satu 409, satu keputusan, CHARGE sekali", async () => {
    const r = await buatRuang(["OWNER", "MEMBER", "MEMBER", "MEMBER", "MEMBER", "MEMBER", "MEMBER"]);
    const [pemilik, m1, m2, m3] = r.user;
    const { id, approvalId } = await ajukan(r, pemilik);
    const hasil = await Promise.all([pilih(r, m1, "APPROVE", approvalId), pilih(r, m2, "APPROVE", approvalId), pilih(r, m3, "APPROVE", approvalId)]);
    assert.deepEqual(hasil.map((x) => x.status).sort(), [201, 201, 409]);
    assert.equal((await apr(approvalId)).status, "APPROVED");
    assert.equal(await prisma.approvalVote.count({ where: { approvalId } }), 2);
    assert.equal((await trx(id)).status, "ACTIVE");
    assert.equal((await ledgerDari(id)).length, 6);
    assert.equal((await aksi(id)).filter((x) => x === "TRANSACTION_APPROVE").length, 1);
  });

  it("grup satu anggota: struk gagal langsung berlaku tanpa Approval, dicatat di audit", async () => {
    const r = await buatRuang(["OWNER"]);
    const { id, h } = await ajukan(r, r.user[0]);
    assert.equal(h.status, 200);
    assert.equal(h.body.data.transaction.status, "ACTIVE");
    assert.equal(h.body.data.approval, null);
    assert.equal(await prisma.approval.count({ where: { subjectId: id, groupId: r.grup.id } }), 0);
    const baris = await trx(id);
    assert.deepEqual([baris.status, baris.expiresAt], ["ACTIVE", null]);
    assert.equal((await ledgerDari(id)).length, 0);
    const audit = await auditDari(id);
    assert.equal(audit.length, 1);
    assert.deepEqual(JSON.parse(audit[0].newValue), { status: "ACTIVE", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "FAILED", participantCount: 1, approval: "NO_VOTERS" });
  });

  it("daftar berkursor terbaru lebih dulu, ringkasan menghitung yang menunggu, kunci sama memutar ulang tanpa CHARGE ganda, kunci dipakai ulang 409, tanpa kunci 400", async () => {
    const r = await buatRuang(["OWNER", "MEMBER"]);
    const [pemilik, penalang] = r.user;
    const dibuat = [];
    for (let i = 0; i < 3; i++) dibuat.push(await ajukan(r, penalang));
    const idApproval = dibuat.map((x) => x.approvalId);
    const hal1 = await kirim(r.a + "?limit=2", { user: pemilik });
    assert.equal(hal1.body.data.length, 2);
    assert.equal(hal1.body.page.hasMore, true);
    assert.deepEqual(hal1.body.data.map((x) => x.id), [idApproval[2], idApproval[1]]);
    const hal2 = await kirim(r.a + "?limit=2&cursor=" + encodeURIComponent(hal1.body.page.nextCursor), { user: pemilik });
    assert.deepEqual(hal2.body.data.map((x) => x.id), [idApproval[0]]);
    assert.equal(hal2.body.page.hasMore, false);
    assert.equal((await kirim("/me/summary", { user: pemilik })).body.data.approvalsToVote, 3);

    const kunci = randomUUID();
    const path = r.a + "/" + idApproval[0] + "/votes";
    const pertama = await kirim(path, { metode: "POST", user: pemilik, body: { vote: "APPROVE" }, kunci });
    assert.equal(pertama.status, 201);
    const ulang = await kirim(path, { metode: "POST", user: pemilik, body: { vote: "APPROVE" }, kunci });
    assert.equal(ulang.status, 201);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    assert.deepEqual(ulang.body, pertama.body);
    assert.equal((await ledgerDari(dibuat[0].id)).length, 1);
    assert.equal(await prisma.approvalVote.count({ where: { approvalId: idApproval[0] } }), 1);
    const beda = await kirim(path, { metode: "POST", user: pemilik, body: { vote: "REJECT" }, kunci });
    assert.equal(beda.status, 409);
    assert.equal(beda.body.code, "idempotency-key-reuse");
    const tanpa = await kirim(r.a + "/" + idApproval[1] + "/votes", { metode: "POST", user: pemilik, body: { vote: "APPROVE" } });
    assert.equal(tanpa.status, 400);
    assert.equal(tanpa.body.errors[0].field, "Idempotency-Key");
    assert.equal((await apr(idApproval[1])).status, "OPEN");
    assert.equal((await kirim("/me/summary", { user: pemilik })).body.data.approvalsToVote, 2);
  });
});
