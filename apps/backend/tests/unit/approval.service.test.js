import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananApproval } from "../../src/services/approval.js";
import { kodeKursor } from "../../src/utils/pagination.js";

// db/tx palsu di memori yang mencatat urutan panggilan. BUKAN bukti SQL Server.
const SEKARANG = 10_000_000;
const KEDALUWARSA_BELUM = new Date(SEKARANG + 1000);

function buatDb(awal = {}) {
  const s = {
    approvals: { 31: { id: 31, groupId: 7, subjectType: "TRANSACTION", subjectId: 5, rule: "ADMIN_ANY", requestedBy: 2, eligibleCount: 2, required: 1, status: "OPEN", expiresAt: KEDALUWARSA_BELUM, decidedAt: null, createdAt: new Date(1000), requester: { id: 2, name: "Pengguna 2" }, ...(awal.approval ?? {}) } },
    votes: awal.votes ?? [],
    transaksi: { 5: { id: 5, groupId: 7, payerId: 2, description: "Makan", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "FAILED", status: "PENDING_APPROVAL", expiresAt: KEDALUWARSA_BELUM, ...(awal.transaksi ?? {}) } },
    shares: [{ transactionId: 5, userId: 1, amount: 23334 }, { transactionId: 5, userId: 2, amount: 23333 }, { transactionId: 5, userId: 3, amount: 23333 }],
    daftarHasil: awal.daftarHasil ?? null, terbukaHasil: awal.terbukaHasil ?? [], keanggotaan: awal.keanggotaan ?? [],
  };
  const log = [];
  const catat = (nama, arg) => log.push({ nama, arg });
  const cocokApproval = (baris, where) =>
    Object.entries(where).every(([k, v]) => (k === "expiresAt" ? baris.expiresAt.getTime() <= v.lte.getTime() : baris[k] === v));
  const cocokTransaksi = (baris, where) => Object.entries(where).every(([k, v]) => baris[k] === v);
  const dengan = (a) => ({ ...a, votes: s.votes.filter((v) => v.approvalId === a.id).map((v) => ({ userId: v.userId, vote: v.vote })) });
  const db = {
    log, s,
    approval: {
      findFirst: async (arg) => {
        catat("approval.findFirst", arg);
        const a = s.approvals[arg.where.id];
        return a === undefined || (a.groupId === arg.where.groupId) === false ? null : dengan(a);
      },
      findMany: async (arg) => {
        catat("approval.findMany", arg);
        if (arg.where.expiresAt && arg.where.expiresAt.lte) return Object.values(s.approvals).filter((a) => cocokApproval(a, { groupId: arg.where.groupId, status: "OPEN", expiresAt: arg.where.expiresAt }));
        if (arg.select.id === undefined) return s.terbukaHasil;
        return (s.daftarHasil ?? Object.values(s.approvals)).map(dengan);
      },
      updateMany: async (arg) => {
        catat("approval.updateMany", arg);
        const a = s.approvals[arg.where.id];
        if (a === undefined || cocokApproval(a, arg.where) === false) return { count: 0 };
        Object.assign(a, arg.data);
        return { count: 1 };
      },
    },
    approvalVote: {
      findMany: async (arg) => { catat("approvalVote.findMany", arg); return s.votes.filter((v) => v.approvalId === arg.where.approvalId).map((v) => ({ userId: v.userId, vote: v.vote })); },
      create: async ({ data }) => { catat("approvalVote.create", data); s.votes.push({ ...data }); return { id: 1 }; },
    },
    transaction: {
      findFirst: async (arg) => { catat("transaction.findFirst", arg); const t = s.transaksi[arg.where.id]; return t === undefined || (t.groupId === arg.where.groupId) === false ? null : { ...t }; },
      findMany: async (arg) => { catat("transaction.findMany", arg); return Object.values(s.transaksi).filter((t) => arg.where.id.in.includes(t.id)); },
      updateMany: async (arg) => {
        catat("transaction.updateMany", arg);
        const t = s.transaksi[arg.where.id];
        if (t === undefined || cocokTransaksi(t, arg.where) === false) return { count: 0 };
        Object.assign(t, arg.data);
        return { count: 1 };
      },
    },
    transactionShare: { findMany: async (arg) => { catat("transactionShare.findMany", arg); return s.shares.filter((x) => x.transactionId === arg.where.transactionId).map((x) => ({ userId: x.userId, amount: x.amount })); } },
    groupMember: { findMany: async (arg) => { catat("groupMember.findMany", arg); return s.keanggotaan; } },
    auditLog: { create: async (arg) => { catat("auditLog.create", arg.data); return { id: 1 }; } },
    $transaction: async (fn) => { catat("$transaction", null); return fn(db); },
  };
  const ledger = { catatTanggungan: async (tx, arg) => { catat("ledger.catatTanggungan", arg); } };
  return { db, ledger, s, log };
}
const layananDari = (d, jam = SEKARANG) => buatLayananApproval({ db: d.db, ledger: d.ledger, sekarang: () => jam });
const admin = { userId: 1, groupId: 7, role: "OWNER" };
const anggotaBiasa = { userId: 4, groupId: 7, role: "MEMBER" };
const galat = (status, code) => (e) => e.status === status && e.code === code;
const nama = (d) => d.log.map((l) => l.nama);
const ambil = (d, n) => d.log.filter((l) => l.nama === n);
const urut = (d, a, b) => nama(d).indexOf(a) >= 0 && nama(d).indexOf(a) < nama(d).indexOf(b);
const tulisan = (d) => nama(d).filter((n) => /create|updateMany|catatTanggungan/.test(n));
const aksiAudit = (d) => ambil(d, "auditLog.create").map((l) => l.arg.action);
const kuorum = (votes = [], ubah = {}) => ({ approval: { rule: "QUORUM_20", eligibleCount: 6, required: 2, ...ubah }, votes: votes.map(([userId, vote]) => ({ approvalId: 31, userId, vote })) });

describe("approval: beriSuara, aturan penentu tunggal", () => {
  it("ADMIN_ANY setuju: Approval APPROVED, transaksi ACTIVE tanpa kedaluwarsa, CHARGE atas nama penalang asal, audit atomik", async () => {
    const d = buatDb();
    const hasil = await layananDari(d).beriSuara(d.db, admin, 31, "APPROVE");
    assert.equal(hasil.status, "APPROVED");
    assert.equal(hasil.approveCount, 1);
    assert.equal(hasil.myVote, "APPROVE");
    assert.equal(hasil.canVote, false);
    assert.deepEqual(d.s.votes, [{ approvalId: 31, userId: 1, vote: "APPROVE" }]);
    assert.deepEqual(d.s.approvals[31].decidedAt, new Date(SEKARANG));
    assert.deepEqual(ambil(d, "transaction.updateMany")[0].arg, { where: { id: 5, groupId: 7, status: "PENDING_APPROVAL" }, data: { status: "ACTIVE", expiresAt: null } });
    assert.deepEqual(ambil(d, "ledger.catatTanggungan")[0].arg, {
      groupId: 7, transactionId: 5, penalangId: 2, kategori: "GROUP", createdBy: 2,
      bagian: [{ userId: 1, amount: 23334 }, { userId: 2, amount: 23333 }, { userId: 3, amount: 23333 }],
    });
    assert.deepEqual(aksiAudit(d), ["APPROVAL_VOTE", "TRANSACTION_APPROVE"]);
    const [suara, setuju] = ambil(d, "auditLog.create").map((l) => l.arg);
    assert.deepEqual([suara.groupId, suara.actorId, suara.transactionId, suara.entity, suara.entityId, JSON.parse(suara.newValue)], [7, 1, 5, "Approval", 31, { vote: "APPROVE", rule: "ADMIN_ANY" }]);
    assert.deepEqual([setuju.actorId, setuju.entity, setuju.entityId, JSON.parse(setuju.oldValue), JSON.parse(setuju.newValue)], [1, "Transaction", 5, { status: "PENDING_APPROVAL" }, { status: "ACTIVE", approvalId: 31 }]);
  });

  it("urutan penulisan: klaim, baca suara, suara, audit suara, tutup Approval, transaksi, CHARGE, audit transaksi", async () => {
    const d = buatDb();
    await layananDari(d).beriSuara(d.db, admin, 31, "APPROVE");
    const tulis = nama(d).filter((n) => /approval.updateMany|approvalVote|auditLog|transaction.updateMany|catatTanggungan/.test(n));
    assert.deepEqual(tulis, ["approval.updateMany", "approvalVote.findMany", "approvalVote.create", "auditLog.create", "approval.updateMany", "transaction.updateMany", "ledger.catatTanggungan", "auditLog.create"]);
    assert.deepEqual(ambil(d, "approval.updateMany")[0].arg, { where: { id: 31, groupId: 7, status: "OPEN" }, data: { status: "OPEN" } });
  });

  it("ADMIN_ANY tolak: Approval REJECTED, transaksi REJECTED (kedaluwarsa tidak diubah), tanpa CHARGE", async () => {
    const d = buatDb();
    const hasil = await layananDari(d).beriSuara(d.db, admin, 31, "REJECT");
    assert.equal(hasil.status, "REJECTED");
    assert.equal(hasil.rejectCount, 1);
    assert.deepEqual(ambil(d, "transaction.updateMany")[0].arg.data, { status: "REJECTED" });
    assert.equal(d.s.transaksi[5].expiresAt, KEDALUWARSA_BELUM);
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
    assert.deepEqual(aksiAudit(d), ["APPROVAL_VOTE", "TRANSACTION_REJECT"]);
    assert.deepEqual(JSON.parse(ambil(d, "auditLog.create")[1].arg.newValue), { status: "REJECTED", approvalId: 31 });
  });

  it("ADMIN_OTHER sama: satu suara admin lain memutuskan", async () => {
    const d = buatDb({ approval: { rule: "ADMIN_OTHER", eligibleCount: 1 } });
    assert.equal((await layananDari(d).beriSuara(d.db, admin, 31, "APPROVE")).status, "APPROVED");
  });
});

describe("approval: beriSuara, QUORUM_20", () => {
  it("suara belum cukup: tetap OPEN, hanya suara dan audit suara yang ditulis", async () => {
    const d = buatDb(kuorum());
    const hasil = await layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "APPROVE");
    assert.equal(hasil.status, "OPEN");
    assert.equal(hasil.approveCount, 1);
    assert.equal(hasil.canVote, false);
    assert.equal(ambil(d, "transaction.updateMany").length, 0);
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
    assert.deepEqual(aksiAudit(d), ["APPROVAL_VOTE"]);
    assert.equal(ambil(d, "approval.updateMany").length, 1);
  });

  it("suara setuju kedua mencapai required (2 dari 6): APPROVED dan CHARGE", async () => {
    const d = buatDb(kuorum([[1, "APPROVE"]]));
    const hasil = await layananDari(d).beriSuara(d.db, { userId: 3, groupId: 7, role: "MEMBER" }, 31, "APPROVE");
    assert.equal(hasil.status, "APPROVED");
    assert.equal(hasil.approveCount, 2);
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 1);
  });

  it("empat penolakan dari enam (required 2) belum menolak; yang kelima menolak", async () => {
    let d = buatDb(kuorum([[11, "REJECT"], [12, "REJECT"], [13, "REJECT"]]));
    let hasil = await layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "REJECT");
    assert.equal(hasil.status, "OPEN");
    assert.equal(hasil.rejectCount, 4);
    d = buatDb(kuorum([[11, "REJECT"], [12, "REJECT"], [13, "REJECT"], [14, "REJECT"]]));
    hasil = await layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "REJECT");
    assert.equal(hasil.status, "REJECTED");
    assert.deepEqual(aksiAudit(d), ["APPROVAL_VOTE", "TRANSACTION_REJECT"]);
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
  });

  it("n = 1: satu penolakan langsung menolak", async () => {
    const d = buatDb(kuorum([], { eligibleCount: 1, required: 1 }));
    assert.equal((await layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "REJECT")).status, "REJECTED");
  });

  it("MEMBER boleh memilih pada QUORUM_20; suara setuju tidak membatalkan penolakan yang sudah ada", async () => {
    const d = buatDb(kuorum([[11, "REJECT"]]));
    const hasil = await layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "APPROVE");
    assert.equal(hasil.status, "OPEN");
    assert.equal(hasil.rejectCount, 1);
    assert.equal(hasil.approveCount, 1);
  });
});

describe("approval: beriSuara, penolakan", () => {
  it("Approval tidak ada atau milik grup lain: 404 tanpa menulis", async () => {
    const d = buatDb();
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 99, "APPROVE"), galat(404, "not-found"));
    await assert.rejects(() => layananDari(d).beriSuara(d.db, { ...admin, groupId: 8 }, 31, "APPROVE"), galat(404, "not-found"));
    assert.deepEqual(tulisan(d), []);
  });

  it("pengaju: 403, bahkan bila ia admin; dicek sebelum status", async () => {
    const d = buatDb({ approval: { status: "APPROVED" } });
    await assert.rejects(() => layananDari(d).beriSuara(d.db, { userId: 2, groupId: 7, role: "OWNER" }, 31, "APPROVE"), galat(403, "forbidden"));
    assert.deepEqual(tulisan(d), []);
  });

  it("MEMBER pada ADMIN_ANY: 403 tanpa menulis", async () => {
    const d = buatDb();
    await assert.rejects(() => layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "APPROVE"), galat(403, "forbidden"));
    assert.deepEqual(tulisan(d), []);
  });

  it("sudah memilih: 409 already-voted; hanya klaim yang tertulis (dibatalkan bersama transaksi)", async () => {
    const d = buatDb(kuorum([[4, "APPROVE"]]));
    await assert.rejects(() => layananDari(d).beriSuara(d.db, anggotaBiasa, 31, "REJECT"), galat(409, "already-voted"));
    assert.deepEqual(tulisan(d), ["approval.updateMany"]);
    assert.equal(ambil(d, "auditLog.create").length, 0);
  });

  it("bukan OPEN (sudah diputuskan): 409 invalid-state tanpa suara", async () => {
    for (const status of ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"]) {
      const d = buatDb({ approval: { status } });
      await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"), status);
      assert.equal(ambil(d, "approvalVote.create").length, 0);
    }
  });

  it("jenis REVISION belum didukung: 409", async () => {
    const d = buatDb({ approval: { subjectType: "REVISION" } });
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.deepEqual(tulisan(d), []);
  });

  it("transaksi sudah bukan PENDING_APPROVAL saat keputusan: 409 tanpa CHARGE", async () => {
    const d = buatDb({ transaksi: { status: "ACTIVE" } });
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
  });

  it("penutupan Approval gagal (0 baris): 409 tanpa mengubah transaksi", async () => {
    const d = buatDb();
    const asli = d.db.approval.updateMany;
    let ke = 0;
    d.db.approval.updateMany = async (arg) => (++ke === 2 ? { count: 0 } : asli(arg));
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.equal(ambil(d, "transaction.updateMany").length, 0);
  });

  it("transaksi hilang (tidak ditemukan) saat keputusan: 409 tanpa CHARGE", async () => {
    const d = buatDb();
    delete d.s.transaksi[5];
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
  });

  it("penurunan transaksi gagal (0 baris) walau pembacaan sempat PENDING_APPROVAL: 409 tanpa CHARGE", async () => {
    const d = buatDb();
    d.db.transaction.updateMany = async () => ({ count: 0 });
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
    assert.equal(ambil(d, "auditLog.create").length, 1);
  });
});

describe("approval: kedaluwarsa", () => {
  it("memberi suara setelah batas: 409, kedaluwarsa tersimpan lewat transaksi terpisah (klien utama), tanpa suara", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG) } });
    await assert.rejects(() => layananDari(d).beriSuara(d.db, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.equal(ambil(d, "$transaction").length, 1);
    assert.equal(d.s.approvals[31].status, "EXPIRED");
    assert.equal(d.s.transaksi[5].status, "EXPIRED");
    assert.equal(ambil(d, "approvalVote.create").length, 0);
    const audit = ambil(d, "auditLog.create")[0].arg;
    assert.deepEqual([audit.action, audit.actorId, audit.transactionId, JSON.parse(audit.newValue)], ["TRANSACTION_EXPIRE", null, 5, { status: "EXPIRED", approvalId: 31 }]);
  });

  it("suara setelah batas memakai klien utama untuk menyimpan kedaluwarsa (tx pembungkus idempotensi tidak dipakai, karena 409 membatalkannya)", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG) } });
    const tx = { ...d.db };
    delete tx.$transaction;
    await assert.rejects(() => layananDari(d).beriSuara(tx, admin, 31, "APPROVE"), galat(409, "invalid-state"));
    assert.equal(d.s.approvals[31].status, "EXPIRED");
    assert.equal(d.s.transaksi[5].status, "EXPIRED");
  });

  it("kedaluwarsa serentak: klaim Approval 0 baris (sudah diputuskan pihak lain): transaksi dan audit tidak disentuh", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG - 5) } });
    d.db.approval.updateMany = async (arg) => { d.log.push({ nama: "approval.updateMany", arg }); return { count: 0 }; };
    await layananDari(d).detail(admin, 31);
    assert.equal(ambil(d, "transaction.updateMany").length, 0);
    assert.equal(ambil(d, "auditLog.create").length, 0);
  });

  it("tepat satu milidetik sebelum batas masih sah", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG + 1) } });
    assert.equal((await layananDari(d).beriSuara(d.db, admin, 31, "APPROVE")).status, "APPROVED");
    assert.equal(ambil(d, "$transaction").length, 0);
  });

  it("detail: kedaluwarsa dievaluasi saat dibaca dan hasilnya EXPIRED", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG - 5) } });
    const hasil = await layananDari(d).detail(admin, 31);
    assert.equal(hasil.status, "EXPIRED");
    assert.equal(hasil.canVote, false);
    assert.equal(d.s.transaksi[5].status, "EXPIRED");
    assert.deepEqual(aksiAudit(d), ["TRANSACTION_EXPIRE"]);
    assert.ok(urut(d, "$transaction", "transaction.findMany"));
  });

  it("detail Approval yang belum lewat batas: tanpa tulisan; tak ada atau grup lain 404", async () => {
    const d = buatDb();
    const hasil = await layananDari(d).detail(admin, 31);
    assert.equal(hasil.status, "OPEN");
    assert.equal(hasil.canVote, true);
    assert.deepEqual(hasil.subject, { transactionId: 5, description: "Makan", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "FAILED" });
    assert.deepEqual(tulisan(d), []);
    await assert.rejects(() => layananDari(d).detail(admin, 99), galat(404, "not-found"));
    await assert.rejects(() => layananDari(d).detail({ ...admin, groupId: 8 }, 31), galat(404, "not-found"));
  });

  it("transaksi sudah bukan PENDING_APPROVAL saat kedaluwarsa: Approval EXPIRED tanpa mengubah transaksi dan tanpa audit", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG - 5) }, transaksi: { status: "ACTIVE" } });
    await layananDari(d).detail(admin, 31);
    assert.equal(d.s.approvals[31].status, "EXPIRED");
    assert.equal(d.s.transaksi[5].status, "ACTIVE");
    assert.equal(ambil(d, "auditLog.create").length, 0);
  });

  it("baca basi: Approval sudah APPROVED oleh suara lain sebelum klaim kedaluwarsa: tidak ditimpa, transaksi dan audit tidak disentuh", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG - 5) } });
    const basi = { ...d.s.approvals[31], votes: [] };
    d.s.approvals[31].status = "APPROVED";
    const asli = d.db.approval.findFirst;
    d.db.approval.findFirst = async (arg) => (arg.select.requester ? asli(arg) : basi);
    assert.equal((await layananDari(d).detail(admin, 31)).status, "APPROVED");
    assert.equal(d.s.transaksi[5].status, "PENDING_APPROVAL");
    assert.equal(ambil(d, "auditLog.create").length, 0);
  });

  it("Approval yang sudah diputuskan tidak dikedaluwarsakan walau lewat batas", async () => {
    const d = buatDb({ approval: { status: "APPROVED", expiresAt: new Date(SEKARANG - 5) } });
    assert.equal((await layananDari(d).detail(admin, 31)).status, "APPROVED");
    assert.equal(ambil(d, "$transaction").length, 0);
  });
});

describe("approval: daftar dan ringkasan", () => {
  it("daftar: lebih dulu mengedaluwarsakan Approval grup yang lewat batas (maksimal 100 per panggilan)", async () => {
    const d = buatDb({ approval: { expiresAt: new Date(SEKARANG - 5) } });
    const hasil = await layananDari(d).daftar(admin, { limit: 20 });
    assert.equal(hasil.data[0].status, "EXPIRED");
    assert.deepEqual(ambil(d, "approval.findMany")[0].arg.where, { groupId: 7, status: "OPEN", expiresAt: { lte: new Date(SEKARANG) } });
    assert.equal(ambil(d, "approval.findMany")[0].arg.take, 100);
    assert.ok(urut(d, "$transaction", "transaction.findMany"));
  });

  it("daftar tanpa filter: hanya grup pemanggil, terbaru lebih dulu, take limit + 1, subjek dimuat sekali", async () => {
    const d = buatDb();
    const hasil = await layananDari(d).daftar(anggotaBiasa, { limit: 20 });
    const arg = ambil(d, "approval.findMany")[1].arg;
    assert.deepEqual(arg.where, { groupId: 7 });
    assert.deepEqual(arg.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    assert.equal(arg.take, 21);
    assert.equal(ambil(d, "transaction.findMany").length, 1);
    assert.deepEqual(hasil, { data: hasil.data, nextCursor: null, hasMore: false });
    assert.equal(hasil.data.length, 1);
    assert.equal(hasil.data[0].canVote, false);
  });

  it("filter status diteruskan ke query", async () => {
    const d = buatDb();
    await layananDari(d).daftar(admin, { limit: 20, status: "APPROVED" });
    assert.deepEqual(ambil(d, "approval.findMany")[1].arg.where, { groupId: 7, status: "APPROVED" });
  });

  it("mine untuk admin: OPEN, belum lewat batas, bukan milik saya, belum saya pilih (tanpa batasan rule)", async () => {
    const d = buatDb();
    await layananDari(d).daftar(admin, { limit: 20, mine: true });
    assert.deepEqual(ambil(d, "approval.findMany")[1].arg.where, { groupId: 7, status: "OPEN", expiresAt: { gt: new Date(SEKARANG) }, requestedBy: { not: 1 }, votes: { none: { userId: 1 } } });
  });

  it("mine untuk MEMBER: hanya rule QUORUM_20 dan MAJORITY", async () => {
    const d = buatDb();
    await layananDari(d).daftar(anggotaBiasa, { limit: 20, mine: true });
    assert.deepEqual(ambil(d, "approval.findMany")[1].arg.where.rule, { in: ["QUORUM_20", "MAJORITY"] });
  });

  it("mine bersama status selain OPEN: kosong tanpa query daftar; bersama OPEN tetap berjalan; mine false tidak menyaring", async () => {
    let d = buatDb();
    assert.deepEqual(await layananDari(d).daftar(admin, { limit: 20, mine: true, status: "APPROVED" }), { data: [], nextCursor: null, hasMore: false });
    assert.equal(ambil(d, "approval.findMany").length, 1);
    d = buatDb();
    await layananDari(d).daftar(admin, { limit: 20, mine: true, status: "OPEN" });
    assert.equal(ambil(d, "approval.findMany")[1].arg.where.status, "OPEN");
    d = buatDb();
    await layananDari(d).daftar(admin, { limit: 20, mine: false });
    assert.deepEqual(ambil(d, "approval.findMany")[1].arg.where, { groupId: 7 });
  });

  it("paginasi: halaman penuh memberi nextCursor dari baris terakhir; kursor masuk menjadi kondisi AND OR", async () => {
    const baris = (id, ms) => ({ id, groupId: 7, subjectType: "TRANSACTION", subjectId: 5, rule: "QUORUM_20", requestedBy: 2, eligibleCount: 6, required: 2, status: "APPROVED", expiresAt: KEDALUWARSA_BELUM, decidedAt: null, createdAt: new Date(ms), requester: { id: 2, name: "P" }, votes: [] });
    const d = buatDb({ daftarHasil: [baris(9, 5000), baris(8, 4000), baris(7, 3000)] });
    const hasil = await layananDari(d).daftar(admin, { limit: 2 });
    assert.equal(hasil.data.length, 2);
    assert.equal(hasil.hasMore, true);
    assert.deepEqual(JSON.parse(Buffer.from(hasil.nextCursor, "base64url").toString()), { t: new Date(4000).toISOString(), id: 8 });
    await layananDari(d).daftar(admin, { limit: 2, cursor: hasil.nextCursor });
    const arg = ambil(d, "approval.findMany").at(-1).arg;
    assert.deepEqual(arg.where.AND, [{ OR: [{ createdAt: { lt: new Date(4000) } }, { createdAt: new Date(4000), id: { lt: 8 } }] }]);
    await assert.rejects(() => layananDari(d).daftar(admin, { limit: 2, cursor: kodeKursor({ t: "x", id: 1 }) }), (e) => e.status === 400 && e.errors[0].field === "cursor");
  });

  it("ringkasan: menghitung Approval terbuka yang boleh saya pilih lintas grup; tanpa keanggotaan 0 tanpa query kedua", async () => {
    let d = buatDb({ keanggotaan: [] });
    assert.equal(await layananDari(d).jumlahPerluSuara(1), 0);
    assert.equal(ambil(d, "approval.findMany").length, 0);
    const terbuka = [{ groupId: 7, rule: "ADMIN_ANY" }, { groupId: 7, rule: "QUORUM_20" }, { groupId: 8, rule: "ADMIN_ANY" }, { groupId: 8, rule: "QUORUM_20" }];
    d = buatDb({ keanggotaan: [{ groupId: 7, role: "OWNER" }, { groupId: 8, role: "MEMBER" }], terbukaHasil: terbuka });
    assert.equal(await layananDari(d).jumlahPerluSuara(1), 3);
    assert.deepEqual(ambil(d, "groupMember.findMany")[0].arg.where, { userId: 1, status: "ACTIVE" });
    assert.deepEqual(ambil(d, "approval.findMany")[0].arg.where, { groupId: { in: [7, 8] }, status: "OPEN", expiresAt: { gt: new Date(SEKARANG) }, requestedBy: { not: 1 }, votes: { none: { userId: 1 } } });
  });
});
