import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananTransaksi } from "../../src/services/transaksi.js";
import { kodeKursor } from "../../src/utils/pagination.js";

// db/tx palsu di memori yang mencatat urutan panggilan. BUKAN bukti SQL Server.
function buatDb(awal = {}) {
  const s = {
    transaksi: { 5: { id: 5, groupId: 7, payerId: 1, description: "Makan", amount: 70000, mode: "EQUAL_ALL", status: "DRAFT", receiptUrl: "https://blob/struk", receiptStatus: "VERIFIED", version: 1, expiresAt: null, createdAt: new Date(0) } },
    shares: [], anggota: [3, 1, 2], ekstraksi: 0, daftarHasil: [], ...awal,
  };
  const log = [];
  const catat = (nama, arg) => log.push({ nama, arg });
  const cocok = (t, w) => Object.entries(w).every(([k, v]) => t[k] === v);
  const db = {
    log, s,
    transaction: {
      findFirst: async (arg) => {
        catat("transaction.findFirst", arg);
        const t = s.transaksi[arg.where.id];
        if (t === undefined || (t.groupId === arg.where.groupId) === false) return null;
        const keluar = { ...t, payer: { id: t.payerId, name: "Pengguna " + t.payerId } };
        if (arg.select.shares) {
          keluar.shares = s.shares.filter((x) => x.transactionId === t.id).map((x) => ({ userId: x.userId, amount: x.amount, consent: x.consent, user: { id: x.userId, name: "Pengguna " + x.userId } }));
        }
        return keluar;
      },
      create: async (arg) => {
        catat("transaction.create", arg);
        return { id: 9, ...arg.data, status: "DRAFT", receiptUrl: null, receiptStatus: "PENDING", version: 1, expiresAt: null, createdAt: new Date(0), payer: { id: arg.data.payerId, name: "Pengguna " + arg.data.payerId } };
      },
      updateMany: async (arg) => {
        catat("transaction.updateMany", arg);
        const t = s.transaksi[arg.where.id];
        if (t === undefined || cocok(t, arg.where) === false) return { count: 0 };
        Object.assign(t, arg.data);
        return { count: 1 };
      },
      deleteMany: async (arg) => {
        catat("transaction.deleteMany", arg);
        const t = s.transaksi[arg.where.id];
        if (t === undefined || cocok(t, arg.where) === false) return { count: 0 };
        delete s.transaksi[arg.where.id];
        return { count: 1 };
      },
      findMany: async (arg) => {
        catat("transaction.findMany", arg);
        return s.daftarHasil;
      },
    },
    receiptExtraction: { count: async (arg) => { catat("receiptExtraction.count", arg); return s.ekstraksi; } },
    groupMember: { findMany: async (arg) => { catat("groupMember.findMany", arg); return s.anggota.map((userId) => ({ userId, role: (s.peran ?? {})[userId] ?? "MEMBER" })); } },
    approval: { create: async (arg) => { catat("approval.create", arg.data); return { id: 31, status: "OPEN", decidedAt: null, createdAt: new Date(0), ...arg.data }; } },
    transactionShare: { create: async ({ data }) => { catat("transactionShare.create", data); s.shares.push({ ...data }); return { id: 1 }; } },
    auditLog: { create: async (arg) => { catat("auditLog.create", arg.data); return { id: 1 }; } },
  };
  const ledger = { catatTanggungan: async (tx, arg) => { catat("ledger.catatTanggungan", arg); } };
  return { db, ledger, s, log };
}
const layananDari = (d, jam = 1_000_000) => buatLayananTransaksi({ db: d.db, ledger: d.ledger, sekarang: () => jam });
const penalang = { userId: 1, groupId: 7, role: "OWNER" };
const anggotaBiasa = { userId: 2, groupId: 7, role: "MEMBER" };
const galat = (status, code) => (e) => e.status === status && e.code === code;
const nama = (d) => d.log.map((l) => l.nama);
const ambil = (d, n) => d.log.filter((l) => l.nama === n);
const urut = (d, a, b) => nama(d).indexOf(a) >= 0 && nama(d).indexOf(a) < nama(d).indexOf(b);
const tulisan = (d) => nama(d).filter((n) => /create|updateMany|deleteMany|catatTanggungan/.test(n));

describe("transaksi: buat, ubah, hapus", () => {
  it("buat: penalang dan grup dari konteks (bukan body), status DRAFT, tanpa audit (K19), daftar peserta kosong", async () => {
    const d = buatDb();
    const hasil = await layananDari(d).buat(d.db, penalang, { description: "Makan", amount: 70000, mode: "EQUAL_ALL" });
    assert.deepEqual(ambil(d, "transaction.create")[0].arg.data, { groupId: 7, payerId: 1, description: "Makan", amount: 70000, mode: "EQUAL_ALL" });
    assert.equal(hasil.status, "DRAFT");
    assert.equal(hasil.receiptStatus, "PENDING");
    assert.deepEqual(hasil.participants, []);
    assert.equal(ambil(d, "auditLog.create").length, 0);
  });

  it("ubah: transaksi tak ada 404; DRAFT milik orang lain 404; bukan DRAFT oleh bukan penalang 403; bukan DRAFT oleh penalang 409", async () => {
    const d = buatDb({ transaksi: { 5: { id: 5, groupId: 7, payerId: 1, description: "a", amount: 5, mode: "EQUAL_ALL", status: "DRAFT", receiptUrl: null, receiptStatus: "PENDING", version: 1, expiresAt: null, createdAt: new Date(0) }, 6: { id: 6, groupId: 7, payerId: 1, description: "b", amount: 5, mode: "EQUAL_ALL", status: "ACTIVE", receiptUrl: null, receiptStatus: "VERIFIED", version: 1, expiresAt: null, createdAt: new Date(0) } } });
    const l = layananDari(d);
    await assert.rejects(() => l.ubah(d.db, penalang, 99, { amount: 5 }), galat(404, "not-found"));
    await assert.rejects(() => l.ubah(d.db, anggotaBiasa, 5, { amount: 5 }), galat(404, "not-found"));
    await assert.rejects(() => l.ubah(d.db, anggotaBiasa, 6, { amount: 5 }), galat(403, "forbidden"));
    await assert.rejects(() => l.ubah(d.db, penalang, 6, { amount: 5 }), galat(409, "invalid-state"));
    assert.equal(ambil(d, "transaction.updateMany").length, 0);
  });

  it("ubah: perubahan nominal membatalkan hasil verifikasi struk; deskripsi atau nominal sama tidak", async () => {
    const jalankan = async (perubahan, receiptStatus) => {
      const d = buatDb();
      d.s.transaksi[5].receiptStatus = receiptStatus;
      await layananDari(d).ubah(d.db, penalang, 5, perubahan);
      return ambil(d, "transaction.updateMany")[0].arg;
    };
    const a = await jalankan({ amount: 80000 }, "VERIFIED");
    assert.deepEqual(a.data, { amount: 80000, receiptStatus: "PENDING" });
    assert.deepEqual(a.where, { id: 5, groupId: 7, payerId: 1, status: "DRAFT" });
    assert.deepEqual((await jalankan({ amount: 80000 }, "FAILED")).data, { amount: 80000, receiptStatus: "PENDING" });
    assert.deepEqual((await jalankan({ amount: 80000 }, "PENDING")).data, { amount: 80000 });
    assert.deepEqual((await jalankan({ amount: 70000 }, "VERIFIED")).data, { amount: 70000 });
    assert.deepEqual((await jalankan({ description: "Baru" }, "VERIFIED")).data, { description: "Baru" });
  });

  it("ubah: bila status berubah di antara baca dan tulis (updateMany menyentuh 0 baris) 409", async () => {
    const d = buatDb();
    d.db.transaction.updateMany = async () => ({ count: 0 });
    await assert.rejects(() => layananDari(d).ubah(d.db, penalang, 5, { amount: 5 }), galat(409, "invalid-state"));
  });

  it("hapus: DRAFT milik penalang dihapus dengan syarat status; ekstraksi struk, bukan DRAFT, atau bukan penalang ditolak", async () => {
    const d = buatDb();
    await layananDari(d).hapus(d.db, penalang, 5);
    assert.deepEqual(ambil(d, "transaction.deleteMany")[0].arg.where, { id: 5, groupId: 7, payerId: 1, status: "DRAFT" });
    assert.equal(d.s.transaksi[5], undefined);

    const adaStruk = buatDb({ ekstraksi: 2 });
    await assert.rejects(() => layananDari(adaStruk).hapus(adaStruk.db, penalang, 5), galat(409, "invalid-state"));
    assert.equal(ambil(adaStruk, "transaction.deleteMany").length, 0);

    const aktif = buatDb();
    aktif.s.transaksi[5].status = "ACTIVE";
    await assert.rejects(() => layananDari(aktif).hapus(aktif.db, penalang, 5), galat(409, "invalid-state"));
    await assert.rejects(() => layananDari(aktif).hapus(aktif.db, anggotaBiasa, 5), galat(403, "forbidden"));
    const orangLain = buatDb();
    await assert.rejects(() => layananDari(orangLain).hapus(orangLain.db, anggotaBiasa, 5), galat(404, "not-found"));
    assert.equal(ambil(orangLain, "transaction.deleteMany").length, 0);
  });

  it("hapus: bila status berubah di antara baca dan hapus 409", async () => {
    const d = buatDb();
    d.db.transaction.deleteMany = async () => ({ count: 0 });
    await assert.rejects(() => layananDari(d).hapus(d.db, penalang, 5), galat(409, "invalid-state"));
  });
});

describe("transaksi: submit", () => {
  it("penjaga: bukan penalang 404 (DRAFT) atau 403; bukan DRAFT 409; mode tak didukung 400; tanpa struk 400; struk belum diverifikasi 409", async () => {
    const siap = (ubah) => { const d = buatDb(); Object.assign(d.s.transaksi[5], ubah); return d; };
    let d = siap({});
    await assert.rejects(() => layananDari(d).submit(d.db, anggotaBiasa, 5), galat(404, "not-found"));
    d = siap({ status: "ACTIVE" });
    await assert.rejects(() => layananDari(d).submit(d.db, anggotaBiasa, 5), galat(403, "forbidden"));
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), galat(409, "invalid-state"));
    d = siap({ status: "PENDING_APPROVAL", receiptUrl: null, receiptStatus: "PENDING", mode: "CUSTOM" });
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), galat(409, "invalid-state"));
    d = siap({ mode: "CUSTOM" });
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), (e) => e.status === 400 && e.errors[0].field === "mode");
    d = siap({ receiptUrl: null, receiptStatus: "PENDING" });
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), (e) => e.status === 400 && e.errors[0].field === "receipt");
    d = siap({ receiptStatus: "PENDING" });
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), galat(409, "invalid-state"));
    for (const dd of [d]) assert.deepEqual(tulisan(dd), []);
  });

  it("struk VERIFIED: ACTIVE tanpa kedaluwarsa; klaim status lebih dulu, lalu peserta, share, CHARGE, audit", async () => {
    const d = buatDb();
    const hasil = await layananDari(d).submit(d.db, penalang, 5);
    assert.deepEqual(ambil(d, "transaction.updateMany")[0].arg, { where: { id: 5, groupId: 7, payerId: 1, status: "DRAFT" }, data: { status: "ACTIVE", expiresAt: null } });
    assert.ok(urut(d, "transaction.updateMany", "groupMember.findMany"));
    assert.ok(urut(d, "groupMember.findMany", "transactionShare.create"));
    assert.ok(urut(d, "transactionShare.create", "ledger.catatTanggungan"));
    assert.ok(urut(d, "ledger.catatTanggungan", "auditLog.create"));
    assert.deepEqual(ambil(d, "groupMember.findMany")[0].arg.where, { groupId: 7, status: "ACTIVE" });
    assert.deepEqual(ambil(d, "transactionShare.create").map((c) => [c.arg.userId, c.arg.amount, c.arg.consent]), [[1, 23334, "ACCEPTED"], [2, 23333, "ACCEPTED"], [3, 23333, "ACCEPTED"]]);
    assert.deepEqual(ambil(d, "ledger.catatTanggungan")[0].arg, {
      groupId: 7, transactionId: 5, penalangId: 1, kategori: "GROUP", createdBy: 1,
      bagian: [{ userId: 1, amount: 23334 }, { userId: 2, amount: 23333 }, { userId: 3, amount: 23333 }],
    });
    const audit = ambil(d, "auditLog.create")[0].arg;
    assert.equal(audit.action, "TRANSACTION_SUBMIT");
    assert.equal(audit.entity, "Transaction");
    assert.equal(audit.transactionId, 5);
    assert.equal(audit.groupId, 7);
    assert.equal(audit.actorId, 1);
    assert.deepEqual(JSON.parse(audit.newValue), { status: "ACTIVE", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "VERIFIED", participantCount: 3 });
    assert.equal(hasil.approval, null);
    assert.equal(hasil.transaction.status, "ACTIVE");
    assert.equal(hasil.transaction.participants.length, 3);
  });

  it("struk FAILED atau NEEDS_REVIEW: PENDING_APPROVAL kedaluwarsa tepat 7 hari, share ditulis, tanpa CHARGE, Approval dibuat dengan kedaluwarsa yang sama", async () => {
    for (const receiptStatus of ["FAILED", "NEEDS_REVIEW"]) {
      const d = buatDb();
      d.s.transaksi[5].receiptStatus = receiptStatus;
      const hasil = await layananDari(d, 5_000_000).submit(d.db, penalang, 5);
      const kedaluwarsa = new Date(5_000_000 + 7 * 24 * 60 * 60 * 1000);
      assert.deepEqual(ambil(d, "transaction.updateMany")[0].arg.data, { status: "PENDING_APPROVAL", expiresAt: kedaluwarsa });
      assert.equal(ambil(d, "transactionShare.create").length, 3);
      assert.equal(ambil(d, "ledger.catatTanggungan").length, 0);
      const audit = ambil(d, "auditLog.create")[0].arg;
      assert.equal(JSON.parse(audit.newValue).status, "PENDING_APPROVAL");
      assert.equal(JSON.parse(audit.newValue).approvalId, 31);
      assert.equal(JSON.parse(audit.newValue).approvalRule, "QUORUM_20");
      assert.equal(hasil.transaction.status, "PENDING_APPROVAL");
      assert.deepEqual(ambil(d, "approval.create")[0].arg, { groupId: 7, subjectType: "TRANSACTION", subjectId: 5, rule: "QUORUM_20", requestedBy: 1, eligibleCount: 2, required: 1, expiresAt: kedaluwarsa });
      assert.deepEqual(ambil(d, "groupMember.findMany")[0].arg.select, { userId: true, role: true });
      assert.equal(hasil.approval.id, 31);
      assert.equal(hasil.approval.status, "OPEN");
      assert.equal(hasil.approval.canVote, false);
      assert.deepEqual(hasil.approval.subject, { transactionId: 5, description: "Makan", amount: 70000, mode: "EQUAL_ALL", receiptStatus });
      assert.ok(urut(d, "transaction.updateMany", "approval.create"));
    }
  });

  it("aturan persetujuan saat submit: pengaju MEMBER ADMIN_ANY atas semua admin; admin dengan admin lain ADMIN_OTHER; admin tunggal QUORUM_20 (n = 6 butuh 2)", async () => {
    const aturanDari = async (payerId, role, peran, anggota) => {
      const d = buatDb({ anggota, peran });
      d.s.transaksi[5].payerId = payerId;
      d.s.transaksi[5].receiptStatus = "FAILED";
      await layananDari(d).submit(d.db, { userId: payerId, groupId: 7, role }, 5);
      const { rule, eligibleCount, required } = ambil(d, "approval.create")[0].arg;
      return { rule, eligibleCount, required };
    };
    assert.deepEqual(await aturanDari(2, "MEMBER", { 1: "OWNER", 3: "ADMIN" }, [1, 2, 3, 4]), { rule: "ADMIN_ANY", eligibleCount: 2, required: 1 });
    assert.deepEqual(await aturanDari(1, "OWNER", { 1: "OWNER", 3: "ADMIN" }, [1, 2, 3, 4]), { rule: "ADMIN_OTHER", eligibleCount: 1, required: 1 });
    assert.deepEqual(await aturanDari(3, "ADMIN", { 1: "OWNER", 3: "ADMIN" }, [1, 2, 3]), { rule: "ADMIN_OTHER", eligibleCount: 1, required: 1 });
    assert.deepEqual(await aturanDari(1, "OWNER", { 1: "OWNER" }, [1, 2, 3, 4, 5, 6, 7]), { rule: "QUORUM_20", eligibleCount: 6, required: 2 });
  });

  it("struk FAILED tanpa pemilih sama sekali: langsung ACTIVE, tanpa Approval, CHARGE ditulis, dicatat di audit", async () => {
    const d = buatDb({ anggota: [1] });
    d.s.transaksi[5].receiptStatus = "FAILED";
    const hasil = await layananDari(d).submit(d.db, penalang, 5);
    const klaim = ambil(d, "transaction.updateMany");
    assert.equal(klaim.length, 2);
    assert.equal(klaim[0].arg.data.status, "PENDING_APPROVAL");
    assert.deepEqual(klaim[1].arg, { where: { id: 5, groupId: 7, payerId: 1, status: "PENDING_APPROVAL" }, data: { status: "ACTIVE", expiresAt: null } });
    assert.equal(ambil(d, "approval.create").length, 0);
    assert.equal(ambil(d, "ledger.catatTanggungan").length, 1);
    assert.deepEqual(JSON.parse(ambil(d, "auditLog.create")[0].arg.newValue), { status: "ACTIVE", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "FAILED", participantCount: 1, approval: "NO_VOTERS" });
    assert.equal(hasil.approval, null);
    assert.equal(hasil.transaction.status, "ACTIVE");
    assert.equal(d.s.transaksi[5].expiresAt, null);
  });

  it("struk FAILED, pengaju MEMBER tanpa admin aktif lain: galat pemrogram, tanpa share, Approval, atau audit", async () => {
    const d = buatDb({ anggota: [1, 2], peran: { 1: "MEMBER", 2: "MEMBER" } });
    d.s.transaksi[5].receiptStatus = "FAILED";
    await assert.rejects(() => layananDari(d).submit(d.db, { userId: 1, groupId: 7, role: "MEMBER" }, 5), /grup tanpa admin aktif/);
    assert.equal(ambil(d, "transactionShare.create").length + ambil(d, "approval.create").length + ambil(d, "auditLog.create").length, 0);
  });

  it("klaim gagal pada penurunan ke ACTIVE tanpa pemilih: 409 tanpa share, CHARGE, atau audit", async () => {
    const d = buatDb({ anggota: [1] });
    d.s.transaksi[5].receiptStatus = "FAILED";
    const asli = d.db.transaction.updateMany;
    let ke = 0;
    d.db.transaction.updateMany = async (arg) => (++ke === 2 ? { count: 0 } : asli(arg));
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), galat(409, "invalid-state"));
    assert.equal(ambil(d, "transactionShare.create").length + ambil(d, "ledger.catatTanggungan").length + ambil(d, "auditLog.create").length, 0);
  });

  it("submit serentak: klaim gagal (0 baris) 409 tanpa menulis share, CHARGE, atau audit", async () => {
    const d = buatDb();
    d.db.transaction.updateMany = async () => ({ count: 0 });
    await assert.rejects(() => layananDari(d).submit(d.db, penalang, 5), galat(409, "invalid-state"));
    assert.deepEqual(tulisan(d), []);
    assert.equal(ambil(d, "auditLog.create").length, 0);
  });

  it("grup satu anggota: satu share seluruh nominal dan tidak ada CHARGE", async () => {
    const d = buatDb({ anggota: [1] });
    await layananDari(d).submit(d.db, penalang, 5);
    assert.deepEqual(ambil(d, "transactionShare.create").map((c) => [c.arg.userId, c.arg.amount]), [[1, 70000]]);
    assert.deepEqual(ambil(d, "ledger.catatTanggungan")[0].arg.bagian, [{ userId: 1, amount: 70000 }]);
  });
});

describe("transaksi: daftar dan detail", () => {
  const kueri = async (query, ctx = anggotaBiasa) => {
    const d = buatDb();
    await layananDari(d).daftar(ctx, { limit: 20, ...query });
    return ambil(d, "transaction.findMany")[0].arg;
  };

  it("bawaan: tanpa DRAFT, urut terbaru, meminta limit + 1 baris", async () => {
    const arg = await kueri({});
    assert.deepEqual(arg.where, { groupId: 7, status: { not: "DRAFT" } });
    assert.deepEqual(arg.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
    assert.equal(arg.take, 21);
  });

  it("status DRAFT hanya milik pemanggil dan mengabaikan filter payerId; filter lain diteruskan", async () => {
    assert.deepEqual((await kueri({ status: "DRAFT", payerId: 9 })).where, { groupId: 7, status: "DRAFT", payerId: 2 });
    assert.deepEqual((await kueri({ status: "ACTIVE", payerId: 9, mode: "EQUAL_ALL" })).where, { groupId: 7, status: "ACTIVE", payerId: 9, mode: "EQUAL_ALL" });
  });

  it("month dikonversi ke rentang WIB", async () => {
    const { createdAt } = (await kueri({ month: "2026-10" })).where;
    assert.equal(createdAt.gte.toISOString(), "2026-09-30T17:00:00.000Z");
    assert.equal(createdAt.lt.toISOString(), "2026-10-31T17:00:00.000Z");
  });

  it("kursor: baris yang lebih tua, atau waktu sama dengan id lebih kecil; kursor rusak 400", async () => {
    const kursor = kodeKursor({ t: "2026-10-05T00:00:00.000Z", id: 12 });
    const arg = await kueri({ cursor: kursor });
    assert.deepEqual(arg.where.AND, [{ OR: [{ createdAt: { lt: new Date("2026-10-05T00:00:00.000Z") } }, { createdAt: new Date("2026-10-05T00:00:00.000Z"), id: { lt: 12 } }] }]);
    await assert.rejects(() => kueri({ cursor: "rusak" }), galat(400, "validation-failed"));
  });

  it("halaman: sisa baris memunculkan nextCursor dari baris terakhir; objek tanpa daftar peserta", async () => {
    const baris = (id, detik) => ({ id, groupId: 7, payerId: 1, description: "x", amount: 100, mode: "EQUAL_ALL", status: "ACTIVE", receiptUrl: null, receiptStatus: "VERIFIED", version: 1, expiresAt: null, createdAt: new Date(detik * 1000), payer: { id: 1, name: "Pengguna 1" }, shares: [], _count: { shares: 3 } });
    const d = buatDb({ daftarHasil: [baris(3, 30), baris(2, 20), baris(1, 10)] });
    const hasil = await layananDari(d).daftar(anggotaBiasa, { limit: 2 });
    assert.deepEqual(hasil.data.map((t) => t.id), [3, 2]);
    assert.equal(hasil.hasMore, true);
    assert.deepEqual(JSON.parse(Buffer.from(hasil.nextCursor, "base64url").toString("utf8")), { t: new Date(20000).toISOString(), id: 2 });
    assert.equal(hasil.data[0].participants, null);
    assert.equal(hasil.data[0].participantCount, 3);
    const habis = await layananDari(buatDb({ daftarHasil: [baris(1, 10)] })).daftar(anggotaBiasa, { limit: 2 });
    assert.deepEqual([habis.hasMore, habis.nextCursor], [false, null]);
  });

  it("detail: tak ada atau DRAFT orang lain 404; ACTIVE menampilkan peserta lengkap", async () => {
    const d = buatDb();
    await assert.rejects(() => layananDari(d).detail(anggotaBiasa, 99), galat(404, "not-found"));
    await assert.rejects(() => layananDari(d).detail(anggotaBiasa, 5), galat(404, "not-found"));
    assert.equal((await layananDari(d).detail(penalang, 5)).status, "DRAFT");
    d.s.transaksi[5].status = "ACTIVE";
    d.s.shares.push({ transactionId: 5, userId: 1, amount: 40000, consent: "ACCEPTED" }, { transactionId: 5, userId: 2, amount: 30000, consent: "ACCEPTED" });
    const hasil = await layananDari(d).detail(anggotaBiasa, 5);
    assert.equal(hasil.participants.length, 2);
    assert.deepEqual(hasil.myShare, { amount: 30000, consent: "ACCEPTED" });
  });
});
