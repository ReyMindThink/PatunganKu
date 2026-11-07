// Layanan persetujuan (api-contract 6.3, architecture 6.4 dan 7.2), jalur minimum T1.8: subjek
// TRANSACTION. Pabrik murni: db, ledger, dan jam disuntik. beriSuara menerima tx dari pembungkus
// idempotensi (suara, keputusan, perubahan transaksi, CHARGE, dan audit satu atomik).
// Kedaluwarsa (7 hari) dievaluasi saat dibaca atau diberi suara, tanpa job.
import { APPROVAL } from "../config/constants.js";
import { catatAudit } from "../utils/audit.js";
import { HttpError } from "../utils/httpError.js";
import { ambilHalaman } from "../utils/pagination.js";
import { bolehMemilih, tentukanKeputusan } from "../utils/aturanPersetujuan.js";
import { objekApproval } from "../utils/objekApproval.js";
import { kursorApprovalSkema } from "../validators/approval.validator.js";

const PILIH = {
  id: true, groupId: true, subjectType: true, subjectId: true, rule: true, requestedBy: true,
  eligibleCount: true, required: true, status: true, expiresAt: true, decidedAt: true, createdAt: true,
  requester: { select: { id: true, name: true } },
  votes: { select: { userId: true, vote: true } },
};
const PILIH_SUBJEK = { id: true, description: true, amount: true, mode: true, receiptStatus: true, payerId: true };
const konflik = (pesan) => new HttpError(409, "invalid-state", pesan);
const tidakAda = () => new HttpError(404, "not-found", "Persetujuan tidak ditemukan.");

export function buatLayananApproval({ db, ledger, sekarang = Date.now }) {
  async function subjekDari(klien, groupId, daftarApproval) {
    const ids = daftarApproval.filter((a) => a.subjectType === "TRANSACTION").map((a) => a.subjectId);
    if (ids.length === 0) return new Map();
    const baris = await klien.transaction.findMany({ where: { id: { in: ids }, groupId }, select: PILIH_SUBJEK });
    return new Map(baris.map((t) => [t.id, t]));
  }

  async function bacaApproval(klien, ctx, approvalId) {
    const a = await klien.approval.findFirst({ where: { id: approvalId, groupId: ctx.groupId }, select: PILIH });
    if (a === null) throw tidakAda();
    const subjek = await subjekDari(klien, ctx.groupId, [a]);
    return objekApproval(a, subjek.get(a.subjectId) ?? null, ctx, sekarang());
  }

  // Satu Approval yang sudah lewat batas: tandai EXPIRED dan transaksinya EXPIRED (atomik dalam
  // klien tx yang diberikan). Mengembalikan true bila baris ini yang berpindah status.
  async function akhiriKedaluwarsa(tx, a) {
    const sekarangMs = new Date(sekarang());
    const klaim = await tx.approval.updateMany({
      where: { id: a.id, groupId: a.groupId, status: "OPEN", expiresAt: { lte: sekarangMs } },
      data: { status: "EXPIRED", decidedAt: sekarangMs },
    });
    if (klaim.count === 0) return false;
    if (a.subjectType === "TRANSACTION") {
      const t = await tx.transaction.updateMany({
        where: { id: a.subjectId, groupId: a.groupId, status: "PENDING_APPROVAL" },
        data: { status: "EXPIRED" },
      });
      if (t.count === 1) {
        await catatAudit(tx, {
          groupId: a.groupId, actorId: null, transactionId: a.subjectId, entity: "Transaction", entityId: a.subjectId,
          action: "TRANSACTION_EXPIRE", oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: "EXPIRED", approvalId: a.id },
        });
      }
    }
    return true;
  }

  const lewatBatas = (a) => a.status === "OPEN" && a.expiresAt.getTime() <= sekarang();

  async function kedaluwarsakanSatu(groupId, approvalId) {
    const a = await db.approval.findFirst({ where: { id: approvalId, groupId }, select: { id: true, groupId: true, subjectType: true, subjectId: true, status: true, expiresAt: true } });
    if (a === null) return;
    if (lewatBatas(a)) await db.$transaction((tx) => akhiriKedaluwarsa(tx, a));
  }

  async function kedaluwarsakanGrup(groupId) {
    const lewat = await db.approval.findMany({
      where: { groupId, status: "OPEN", expiresAt: { lte: new Date(sekarang()) } },
      select: { id: true, groupId: true, subjectType: true, subjectId: true, status: true, expiresAt: true },
      take: APPROVAL.KEDALUWARSA_PROSES_MAKS,
    });
    for (const a of lewat) await db.$transaction((tx) => akhiriKedaluwarsa(tx, a));
  }

  async function detail(ctx, approvalId) {
    await kedaluwarsakanSatu(ctx.groupId, approvalId);
    return bacaApproval(db, ctx, approvalId);
  }

  async function daftar(ctx, { limit, cursor, status, mine }) {
    await kedaluwarsakanGrup(ctx.groupId);
    const where = { groupId: ctx.groupId };
    if (typeof status === "string") where.status = status;
    if (mine === true) {
      // Hanya yang dapat saya putuskan sekarang: terbuka, belum lewat, bukan milik saya, belum saya pilih.
      if (typeof status === "string" && (status === "OPEN") === false) return { data: [], nextCursor: null, hasMore: false };
      where.status = "OPEN";
      where.expiresAt = { gt: new Date(sekarang()) };
      where.requestedBy = { not: ctx.userId };
      where.votes = { none: { userId: ctx.userId } };
      if (bolehMemilih({ rule: APPROVAL.RULE.ADMIN_ANY, role: ctx.role }) === false) {
        where.rule = { in: [APPROVAL.RULE.QUORUM_20, APPROVAL.RULE.MAJORITY] };
      }
    }
    const hasil = await ambilHalaman({
      limit,
      kursor: cursor,
      skemaKursor: kursorApprovalSkema,
      ambil: ({ take, kursor }) =>
        db.approval.findMany({
          where: kursor === null ? where : { ...where, AND: [{ OR: [{ createdAt: { lt: new Date(kursor.t) } }, { createdAt: new Date(kursor.t), id: { lt: kursor.id } }] }] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          select: PILIH,
        }),
      buatKursor: (a) => ({ t: a.createdAt.toISOString(), id: a.id }),
    });
    const subjek = await subjekDari(db, ctx.groupId, hasil.data);
    const data = hasil.data.map((a) => objekApproval(a, subjek.get(a.subjectId) ?? null, ctx, sekarang()));
    return { data, nextCursor: hasil.nextCursor, hasMore: hasil.hasMore };
  }

  // Akibat keputusan pada transaksi. APPROVED: ACTIVE dan CHARGE atas nama penalang asal.
  async function terapkanKeputusan(tx, ctx, a, keputusan) {
    const akhir = keputusan === "APPROVED" ? "ACTIVE" : "REJECTED";
    const t = await tx.transaction.findFirst({ where: { id: a.subjectId, groupId: a.groupId }, select: { id: true, payerId: true, status: true } });
    if (t === null || (t.status === "PENDING_APPROVAL") === false) throw konflik("Transaksi sudah tidak menunggu persetujuan.");
    const hasil = await tx.transaction.updateMany({
      where: { id: a.subjectId, groupId: a.groupId, status: "PENDING_APPROVAL" },
      data: keputusan === "APPROVED" ? { status: akhir, expiresAt: null } : { status: akhir },
    });
    if (hasil.count === 0) throw konflik("Transaksi sudah tidak menunggu persetujuan.");
    if (keputusan === "APPROVED") {
      const shares = await tx.transactionShare.findMany({ where: { transactionId: a.subjectId }, select: { userId: true, amount: true } });
      await ledger.catatTanggungan(tx, {
        groupId: a.groupId, transactionId: a.subjectId, penalangId: t.payerId,
        bagian: shares.map((s) => ({ userId: s.userId, amount: s.amount })), kategori: "GROUP", createdBy: t.payerId,
      });
    }
    await catatAudit(tx, {
      groupId: a.groupId, actorId: ctx.userId, transactionId: a.subjectId, entity: "Transaction", entityId: a.subjectId,
      action: keputusan === "APPROVED" ? "TRANSACTION_APPROVE" : "TRANSACTION_REJECT",
      oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: akhir, approvalId: a.id },
    });
  }

  async function beriSuara(tx, ctx, approvalId, vote) {
    const a = await tx.approval.findFirst({ where: { id: approvalId, groupId: ctx.groupId }, select: PILIH });
    if (a === null) throw tidakAda();
    if (a.requestedBy === ctx.userId) throw new HttpError(403, "forbidden", "Pengaju tidak dapat memberi suara pada permintaannya sendiri.");
    if (bolehMemilih({ rule: a.rule, role: ctx.role }) === false) throw new HttpError(403, "forbidden", "Hanya admin yang dapat memberi suara pada persetujuan ini.");
    if ((a.subjectType === "TRANSACTION") === false) throw konflik("Jenis persetujuan ini belum didukung.");
    if (lewatBatas(a)) {
      // Dicatat lewat klien utama supaya tetap tersimpan walau 409 membatalkan transaksi ini.
      await db.$transaction((t2) => akhiriKedaluwarsa(t2, a));
      throw konflik("Persetujuan ini sudah kedaluwarsa.");
    }
    // Klaim baris Approval (pola kunci baris): suara serentak berjalan bergiliran dan yang
    // terlambat membaca status terbaru.
    const klaim = await tx.approval.updateMany({ where: { id: approvalId, groupId: ctx.groupId, status: "OPEN" }, data: { status: "OPEN" } });
    if (klaim.count === 0) throw konflik("Persetujuan ini sudah diputuskan atau kedaluwarsa.");
    const suara = await tx.approvalVote.findMany({ where: { approvalId }, select: { userId: true, vote: true } });
    if (suara.some((s) => s.userId === ctx.userId)) throw new HttpError(409, "already-voted", "Anda sudah memberi suara pada persetujuan ini.");

    await tx.approvalVote.create({ data: { approvalId, userId: ctx.userId, vote } });
    await catatAudit(tx, {
      groupId: ctx.groupId, actorId: ctx.userId, transactionId: a.subjectId, entity: "Approval", entityId: approvalId,
      action: "APPROVAL_VOTE", newValue: { vote, rule: a.rule },
    });
    const semua = [...suara, { userId: ctx.userId, vote }];
    const keputusan = tentukanKeputusan({
      rule: a.rule, required: a.required, eligibleCount: a.eligibleCount,
      approve: semua.filter((s) => s.vote === "APPROVE").length,
      reject: semua.filter((s) => s.vote === "REJECT").length,
    });
    if ((keputusan === null) === false) {
      const tutup = await tx.approval.updateMany({ where: { id: approvalId, groupId: ctx.groupId, status: "OPEN" }, data: { status: keputusan, decidedAt: new Date(sekarang()) } });
      if (tutup.count === 0) throw konflik("Persetujuan ini sudah diputuskan atau kedaluwarsa.");
      await terapkanKeputusan(tx, ctx, a, keputusan);
    }
    return bacaApproval(tx, ctx, approvalId);
  }

  // Jumlah Approval yang menunggu suara pemanggil, lintas grup (GET /api/me/summary).
  async function jumlahPerluSuara(userId) {
    const keanggotaan = await db.groupMember.findMany({ where: { userId, status: "ACTIVE" }, select: { groupId: true, role: true } });
    if (keanggotaan.length === 0) return 0;
    const peran = new Map(keanggotaan.map((k) => [k.groupId, k.role]));
    const terbuka = await db.approval.findMany({
      where: {
        groupId: { in: [...peran.keys()] }, status: "OPEN", expiresAt: { gt: new Date(sekarang()) },
        requestedBy: { not: userId }, votes: { none: { userId } },
      },
      select: { groupId: true, rule: true },
    });
    return terbuka.filter((a) => bolehMemilih({ rule: a.rule, role: peran.get(a.groupId) })).length;
  }

  return { daftar, detail, beriSuara, jumlahPerluSuara, kedaluwarsakanGrup };
}
