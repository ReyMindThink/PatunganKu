// Layanan transaksi (api-contract 9.1-9.2), jalur minimum T1.7a: mode EQUAL_ALL, struk wajib
// terverifikasi saat submit. Pabrik murni: db, ledger, dan jam disuntik. Fungsi tulis menerima
// tx dari pembungkus idempotensi sehingga perubahan, share, CHARGE, dan audit satu atomik.
// ctx = { userId, groupId, role } berasal dari token dan keanggotaan, bukan dari body.
import { TRANSAKSI } from "../config/constants.js";
import { catatAudit } from "../utils/audit.js";
import { rentangBulanWib } from "../utils/bulanWib.js";
import { HttpError } from "../utils/httpError.js";
import { muatTransaksi } from "../utils/muatTransaksi.js";
import { objekApproval } from "../utils/objekApproval.js";
import { objekTransaksi } from "../utils/objekTransaksi.js";
import { pilihAturan } from "../utils/aturanPersetujuan.js";
import { bagiMerata } from "../utils/pembagian.js";
import { ambilHalaman } from "../utils/pagination.js";
import { kursorTransaksiSkema } from "../validators/transaksi.validator.js";

const HARI_MS = 24 * 60 * 60 * 1000;
const PILIH = {
  id: true, groupId: true, payerId: true, description: true, amount: true, mode: true, status: true,
  receiptUrl: true, receiptStatus: true, version: true, expiresAt: true, createdAt: true,
  payer: { select: { id: true, name: true } },
};
const konflik = (pesan) => new HttpError(409, "invalid-state", pesan);

export function buatLayananTransaksi({ db, ledger, sekarang = Date.now }) {
  const muat = (klien, ctx, transactionId, opsi) => muatTransaksi(klien, ctx, transactionId, { ...opsi, pilih: PILIH });

  async function bacaDetail(klien, ctx, transactionId) {
    const t = await klien.transaction.findFirst({
      where: { id: transactionId, groupId: ctx.groupId },
      select: { ...PILIH, shares: { select: { userId: true, amount: true, consent: true, user: { select: { id: true, name: true } } }, orderBy: { userId: "asc" } } },
    });
    return objekTransaksi(t, ctx, { rinci: true });
  }

  async function buat(tx, ctx, { description, amount, mode }) {
    const t = await tx.transaction.create({ data: { groupId: ctx.groupId, payerId: ctx.userId, description, amount, mode }, select: PILIH });
    return objekTransaksi({ ...t, shares: [] }, ctx, { rinci: true });
  }

  async function ubah(tx, ctx, transactionId, perubahan) {
    const t = await muat(tx, ctx, transactionId, { tulis: true });
    if (t.status === "DRAFT") {
      // Nominal berubah: hasil verifikasi struk tidak berlaku lagi.
      const nominalBerubah = Number.isInteger(perubahan.amount) && (perubahan.amount === t.amount) === false;
      const batal = nominalBerubah && (t.receiptStatus === "PENDING") === false;
      const data = { ...perubahan, ...(batal ? { receiptStatus: "PENDING" } : {}) };
      const hasil = await tx.transaction.updateMany({ where: { id: transactionId, groupId: ctx.groupId, payerId: ctx.userId, status: "DRAFT" }, data });
      if (hasil.count === 0) throw konflik("Transaksi sudah tidak berstatus DRAFT.");
      return bacaDetail(tx, ctx, transactionId);
    }
    throw konflik("Hanya transaksi berstatus DRAFT yang dapat diubah.");
  }

  async function hapus(tx, ctx, transactionId) {
    const t = await muat(tx, ctx, transactionId, { tulis: true });
    if ((t.status === "DRAFT") === false) throw konflik("Hanya transaksi berstatus DRAFT yang dapat dihapus.");
    // Hasil ekstraksi struk tambah-saja (tidak dapat dihapus), jadi draft yang sudah punya tidak dihapus fisik.
    const ekstraksi = await tx.receiptExtraction.count({ where: { transactionId } });
    if (ekstraksi > 0) throw konflik("Draft dengan hasil verifikasi struk tidak dapat dihapus.");
    const hasil = await tx.transaction.deleteMany({ where: { id: transactionId, groupId: ctx.groupId, payerId: ctx.userId, status: "DRAFT" } });
    if (hasil.count === 0) throw konflik("Transaksi sudah tidak berstatus DRAFT.");
  }

  async function daftar(ctx, { limit, cursor, month, status, mode, payerId }) {
    const where = { groupId: ctx.groupId };
    if (status === "DRAFT") {
      where.status = "DRAFT";
      where.payerId = ctx.userId;
    } else {
      where.status = status ?? { not: "DRAFT" };
      if (Number.isInteger(payerId)) where.payerId = payerId;
    }
    if (typeof mode === "string") where.mode = mode;
    if (typeof month === "string") {
      const { dari, sampai } = rentangBulanWib(month);
      where.createdAt = { gte: dari, lt: sampai };
    }
    const hasil = await ambilHalaman({
      limit,
      kursor: cursor,
      skemaKursor: kursorTransaksiSkema,
      ambil: ({ take, kursor }) =>
        db.transaction.findMany({
          where: kursor === null ? where : { ...where, AND: [{ OR: [{ createdAt: { lt: new Date(kursor.t) } }, { createdAt: new Date(kursor.t), id: { lt: kursor.id } }] }] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          select: { ...PILIH, shares: { where: { userId: ctx.userId }, select: { userId: true, amount: true, consent: true } }, _count: { select: { shares: true } } },
        }),
      buatKursor: (t) => ({ t: t.createdAt.toISOString(), id: t.id }),
    });
    return { data: hasil.data.map((t) => objekTransaksi({ ...t, jumlahShare: t._count.shares }, ctx)), nextCursor: hasil.nextCursor, hasMore: hasil.hasMore };
  }

  async function detail(ctx, transactionId) {
    await muat(db, ctx, transactionId);
    return bacaDetail(db, ctx, transactionId);
  }

  // Submit: DRAFT menjadi ACTIVE (struk VERIFIED, CHARGE ditulis) atau PENDING_APPROVAL (struk
  // FAILED atau NEEDS_REVIEW, dengan Approval dari T1.8). Klaim status dilakukan lebih dulu
  // supaya submit serentak: satu menang, yang lain 409 tanpa menulis apa pun.
  async function submit(tx, ctx, transactionId) {
    const t = await muat(tx, ctx, transactionId, { tulis: true });
    if ((t.status === "DRAFT") === false) throw konflik("Transaksi ini sudah dikirim.");
    if (TRANSAKSI.MODE_DIDUKUNG.includes(t.mode) === false) throw new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [{ field: "mode", message: "Mode ini belum didukung." }]);
    if (Boolean(t.receiptUrl) === false) throw new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [{ field: "receipt", message: "Foto struk wajib diunggah dan diverifikasi sebelum dikirim." }]);
    if (t.receiptStatus === "PENDING") throw konflik("Verifikasi struk belum dijalankan.");

    const aktif = t.receiptStatus === "VERIFIED";
    const status = aktif ? "ACTIVE" : "PENDING_APPROVAL";
    const kedaluwarsa = aktif ? null : new Date(sekarang() + TRANSAKSI.KEDALUWARSA_HARI * HARI_MS);
    const klaim = await tx.transaction.updateMany({
      where: { id: transactionId, groupId: ctx.groupId, payerId: ctx.userId, status: "DRAFT" },
      data: { status, expiresAt: kedaluwarsa },
    });
    if (klaim.count === 0) throw konflik("Transaksi ini sudah dikirim.");

    const anggota = await tx.groupMember.findMany({ where: { groupId: ctx.groupId, status: "ACTIVE" }, select: { userId: true, role: true } });
    const bagian = bagiMerata(t.amount, anggota.map((a) => a.userId));

    // Struk FAILED atau NEEDS_REVIEW: pilih aturan persetujuan (T1.8). Tanpa pemilih sama
    // sekali (mis. grup satu anggota) transaksi langsung berlaku dan dicatat di audit.
    let statusAkhir = status;
    let barisApproval = null;
    let tanpaPemilih = false;
    if (aktif === false) {
      const aturan = pilihAturan({ pengajuId: ctx.userId, pengajuRole: ctx.role, anggota });
      if (aturan === null) {
        const langsung = await tx.transaction.updateMany({
          where: { id: transactionId, groupId: ctx.groupId, payerId: ctx.userId, status: "PENDING_APPROVAL" },
          data: { status: "ACTIVE", expiresAt: null },
        });
        if (langsung.count === 0) throw konflik("Transaksi ini sudah dikirim.");
        statusAkhir = "ACTIVE";
        tanpaPemilih = true;
      } else {
        barisApproval = await tx.approval.create({
          data: { groupId: ctx.groupId, subjectType: "TRANSACTION", subjectId: transactionId, rule: aturan.rule, requestedBy: ctx.userId, eligibleCount: aturan.eligibleCount, required: aturan.required, expiresAt: kedaluwarsa },
          select: { id: true, groupId: true, subjectType: true, subjectId: true, rule: true, requestedBy: true, eligibleCount: true, required: true, status: true, expiresAt: true, decidedAt: true, createdAt: true },
        });
      }
    }

    for (const b of bagian) {
      await tx.transactionShare.create({ data: { transactionId, userId: b.userId, amount: b.amount, consent: "ACCEPTED", consentAt: new Date(sekarang()) } });
    }
    if (statusAkhir === "ACTIVE") {
      await ledger.catatTanggungan(tx, { groupId: ctx.groupId, transactionId, penalangId: ctx.userId, bagian, kategori: "GROUP", createdBy: ctx.userId });
    }
    const nilaiAudit = { status: statusAkhir, amount: t.amount, mode: t.mode, receiptStatus: t.receiptStatus, participantCount: bagian.length };
    if (barisApproval === null) {
      if (tanpaPemilih) nilaiAudit.approval = "NO_VOTERS";
    } else {
      nilaiAudit.approvalId = barisApproval.id;
      nilaiAudit.approvalRule = barisApproval.rule;
    }
    await catatAudit(tx, {
      groupId: ctx.groupId, actorId: ctx.userId, transactionId, entity: "Transaction", entityId: transactionId, action: "TRANSACTION_SUBMIT",
      newValue: nilaiAudit,
    });
    const approval =
      barisApproval === null
        ? null
        : objekApproval(
            { ...barisApproval, requester: { id: t.payer.id, name: t.payer.name }, votes: [] },
            { id: transactionId, description: t.description, amount: t.amount, mode: t.mode, receiptStatus: t.receiptStatus },
            ctx,
            sekarang(),
          );
    return { transaction: await bacaDetail(tx, ctx, transactionId), approval };
  }

  return { buat, ubah, hapus, daftar, detail, submit, bacaDetail };
}
