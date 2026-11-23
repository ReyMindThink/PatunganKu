// Pelunasan bilateral (api-contract 10.4, T1.9b-2: tunai, BANK, EWALLET). Pabrik murni: db, ledger,
// penyimpanan bukti, dan jam disuntik. Kirim dan konfirmasi menerima tx dari pembungkus idempotensi; tolak dan batal membuka
// transaksi sendiri. Kunci pasangan = kunci baris Group (update tanpa perubahan nilai), dan saldo
// dibaca lewat tx setelah kunci didapat, sehingga dua pelunasan serentak berjalan bergiliran.
import { STRUK } from "../config/constants.js";
import { HttpError } from "../utils/httpError.js";
import { catatAudit } from "../utils/audit.js";
import { detectImageType } from "../utils/imageType.js";
import { ambilHalaman } from "../utils/pagination.js";
import { kursorPelunasanSkema } from "../validators/pelunasan.validator.js";

const PIHAK = { select: { id: true, name: true } };
const DENGAN_PIHAK = { sender: PIHAK, receiver: PIHAK };
const iso = (d) => (d === null ? null : d.toISOString());
const pihak = (u) => ({ kind: "USER", id: u.id, name: u.name });

export function objekPelunasan(b) {
  return {
    id: b.id,
    groupId: b.groupId,
    sender: pihak(b.sender),
    receiver: pihak(b.receiver),
    amount: b.amount,
    methodType: b.methodType,
    method: b.methodId === null ? null : { id: b.methodId, provider: b.methodProvider, accountName: b.methodAccountName },
    note: b.note,
    hasProof: (b.proofUrl === null) === false,
    status: b.status,
    rejectReason: b.rejectReason,
    createdAt: iso(b.createdAt),
    decidedAt: iso(b.decidedAt),
    cancelledAt: iso(b.cancelledAt),
  };
}

export function buatLayananPelunasan({ db, ledger, penyimpanan, jam = () => new Date() }) {
  const tidakAda = () => new HttpError(404, "not-found", "Pelunasan tidak ditemukan.");
  const sudahDiputuskan = () => new HttpError(409, "invalid-state", "Pelunasan ini sudah diputuskan atau dibatalkan.");

  async function kunciGrup(tx, groupId) {
    const g = await tx.group.findUnique({ where: { id: groupId }, select: { name: true } });
    if (g === null) throw new HttpError(404, "not-found", "Grup tidak ditemukan.");
    await tx.group.update({ where: { id: groupId }, data: { name: g.name } });
  }

  async function bacaMilik(klien, ctx, paymentId) {
    const baris = await klien.paymentConfirmation.findFirst({ where: { id: paymentId, groupId: ctx.groupId }, include: DENGAN_PIHAK });
    const pihakSah = Boolean(baris) && (baris.senderId === ctx.userId || baris.receiverId === ctx.userId);
    if (pihakSah === false) throw tidakAda();
    return baris;
  }

  // bukti = { buffer } wajib untuk BANK dan EWALLET (dijaga router), tidak dipakai untuk CASH.
  async function kirim(tx, ctx, { receiverId, amount, methodType, methodId, note }, bukti) {
    if (receiverId === ctx.userId) throw new HttpError(400, "invalid-receiver", "Tidak dapat melunasi ke diri sendiri.");
    const tunai = methodType === "CASH";
    let tipe = null;
    if (tunai === false) {
      tipe = detectImageType(bukti.buffer);
      if (tipe === null) throw new HttpError(415, "unsupported-media-type", "Format gambar harus JPEG, PNG, atau WebP.");
      if (bukti.buffer.length > STRUK.UKURAN_MAKS) throw new HttpError(413, "payload-too-large", "Ukuran berkas maksimal 5 MB.");
    }
    const anggota = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: ctx.groupId, userId: receiverId } }, select: { status: true } });
    if (anggota === null) throw new HttpError(400, "invalid-receiver", "Penerima bukan anggota grup ini.");
    // Satu kode untuk semua penyebab (bukan milik penerima, nonaktif, jenis berbeda, tidak ada) agar
    // keberadaan metode orang lain tidak bocor.
    let metode = null;
    if (tunai === false) {
      metode = await tx.paymentMethod.findFirst({ where: { id: methodId, userId: receiverId, kind: methodType, isActive: true }, select: { id: true, provider: true, accountName: true } });
      if (metode === null) throw new HttpError(409, "no-accepted-method", "Penerima tidak memiliki metode pembayaran aktif yang cocok.");
    }

    await kunciGrup(tx, ctx.groupId);
    const saldo = await ledger.saldoPasangan(ctx.groupId, ctx.userId, receiverId, tx);
    const tertunda = await tx.paymentConfirmation.findMany({ where: { groupId: ctx.groupId, senderId: ctx.userId, receiverId, status: "PENDING" }, select: { amount: true } });
    const sisa = Math.max(0, saldo - tertunda.reduce((jumlah, b) => jumlah + b.amount, 0));
    if (amount > sisa) {
      throw new HttpError(409, "amount-exceeds-debt", "Nominal melebihi sisa utang yang dapat dilunasi.", undefined, { payable: sisa });
    }

    // Blob diunggah paling akhir sebelum tulis; bila tulis atau audit gagal, blob dihapus (best-effort).
    let nama = null;
    try {
      if (tunai === false) nama = await penyimpanan.simpan(bukti.buffer, tipe);
      const data = { groupId: ctx.groupId, senderId: ctx.userId, receiverId, amount, methodType, note: note ?? null };
      if (tunai === false) Object.assign(data, { methodId: metode.id, methodProvider: metode.provider, methodAccountName: metode.accountName, proofUrl: nama });
      const baru = await tx.paymentConfirmation.create({ data, include: DENGAN_PIHAK });
      const nilai = { receiverId, amount, methodType };
      if (tunai === false) nilai.methodId = metode.id;
      await catatAudit(tx, {
        groupId: ctx.groupId,
        actorId: ctx.userId,
        entity: "PaymentConfirmation",
        entityId: baru.id,
        action: "PAYMENT_SUBMIT",
        newValue: nilai,
      });
      return objekPelunasan(baru);
    } catch (e) {
      if (nama === null) throw e;
      try {
        await penyimpanan.hapus(nama);
      } catch {
        // Sisa blob dibersihkan job pembersih (Tahap 4); galat asli lebih penting.
      }
      throw e;
    }
  }

  async function konfirmasi(tx, ctx, paymentId) {
    const lama = await bacaMilik(tx, ctx, paymentId);
    if ((lama.receiverId === ctx.userId) === false) throw new HttpError(403, "forbidden", "Hanya penerima yang dapat mengonfirmasi pelunasan.");

    await kunciGrup(tx, ctx.groupId);
    const klaim = await tx.paymentConfirmation.updateMany({
      where: { id: paymentId, groupId: ctx.groupId, receiverId: ctx.userId, status: "PENDING" },
      data: { status: "CONFIRMED", decidedAt: jam() },
    });
    if (klaim.count === 0) throw sudahDiputuskan();

    // K25: diperiksa ulang karena saldo dapat berubah sejak pengajuan. Galat ini membatalkan
    // seluruh transaksi, jadi klaim di atas ikut dibatalkan dan pelunasan tetap PENDING.
    const saldo = await ledger.saldoPasangan(ctx.groupId, lama.senderId, lama.receiverId, tx);
    if (lama.amount > saldo) {
      throw new HttpError(409, "amount-exceeds-debt", "Nominal melebihi sisa utang saat ini. Tolak pelunasan ini, atau minta pengirim membatalkan lalu mengajukan ulang.", undefined, { payable: Math.max(0, saldo) });
    }
    await ledger.catatPelunasan(tx, {
      groupId: ctx.groupId,
      paymentId,
      pengirimId: lama.senderId,
      penerimaId: lama.receiverId,
      jumlah: lama.amount,
      createdBy: ctx.userId,
    });
    await catatAudit(tx, {
      groupId: ctx.groupId,
      actorId: ctx.userId,
      entity: "PaymentConfirmation",
      entityId: paymentId,
      action: "PAYMENT_CONFIRM",
      newValue: { amount: lama.amount },
    });
    return objekPelunasan(await tx.paymentConfirmation.findUnique({ where: { id: paymentId }, include: DENGAN_PIHAK }));
  }

  // Tolak dan batal: klaim atomik WHERE status PENDING (tanpa ledger, jadi tanpa kunci grup).
  async function ubahStatus(ctx, paymentId, { kolom, pesan, data, action, reason }) {
    return db.$transaction(async (tx) => {
      const lama = await bacaMilik(tx, ctx, paymentId);
      if ((lama[kolom] === ctx.userId) === false) throw new HttpError(403, "forbidden", pesan);
      const klaim = await tx.paymentConfirmation.updateMany({
        where: { id: paymentId, groupId: ctx.groupId, [kolom]: ctx.userId, status: "PENDING" },
        data,
      });
      if (klaim.count === 0) throw sudahDiputuskan();
      await catatAudit(tx, { groupId: ctx.groupId, actorId: ctx.userId, entity: "PaymentConfirmation", entityId: paymentId, action, reason });
      return objekPelunasan(await tx.paymentConfirmation.findUnique({ where: { id: paymentId }, include: DENGAN_PIHAK }));
    });
  }

  const tolak = (ctx, paymentId, { reason } = {}) =>
    ubahStatus(ctx, paymentId, {
      kolom: "receiverId",
      pesan: "Hanya penerima yang dapat menolak pelunasan.",
      data: { status: "REJECTED", rejectReason: reason ?? null, decidedAt: jam() },
      action: "PAYMENT_REJECT",
      reason,
    });

  const batal = (ctx, paymentId) =>
    ubahStatus(ctx, paymentId, {
      kolom: "senderId",
      pesan: "Hanya pengirim yang dapat membatalkan pelunasan.",
      data: { status: "CANCELLED", cancelledAt: jam() },
      action: "PAYMENT_CANCEL",
    });

  const TIPE_BUKTI = ["image/jpeg", "image/png", "image/webp"];

  // Hanya pengirim dan penerima (bacaMilik); tunai tidak punya bukti. Tipe dari blob dibatasi ke tiga
  // tipe gambar yang kita unggah sendiri, selain itu octet-stream.
  async function bukti(ctx, paymentId) {
    const p = await bacaMilik(db, ctx, paymentId);
    if (p.proofUrl === null) throw new HttpError(404, "not-found", "Pelunasan ini tidak memiliki bukti.");
    let isi;
    try {
      isi = await penyimpanan.unduh(p.proofUrl);
    } catch (e) {
      if (Boolean(e) && e.statusCode === 404) throw new HttpError(404, "not-found", "Berkas bukti tidak ditemukan.");
      throw e;
    }
    return { buffer: isi.buffer, tipe: TIPE_BUKTI.includes(isi.tipe) ? isi.tipe : "application/octet-stream" };
  }

  async function detail(ctx, paymentId) {
    return objekPelunasan(await bacaMilik(db, ctx, paymentId));
  }

  async function daftar(ctx, { role, status, limit, cursor }) {
    const where = { groupId: ctx.groupId };
    if (role === "sent") where.senderId = ctx.userId;
    else if (role === "received") where.receiverId = ctx.userId;
    else where.OR = [{ senderId: ctx.userId }, { receiverId: ctx.userId }];
    if (typeof status === "string") where.status = status;
    const hasil = await ambilHalaman({
      limit,
      kursor: cursor,
      skemaKursor: kursorPelunasanSkema,
      ambil: ({ take, kursor }) =>
        db.paymentConfirmation.findMany({
          where: kursor === null ? where : { AND: [where, { OR: [{ createdAt: { lt: new Date(kursor.t) } }, { createdAt: new Date(kursor.t), id: { lt: kursor.id } }] }] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          include: DENGAN_PIHAK,
        }),
      buatKursor: (b) => ({ t: b.createdAt.toISOString(), id: b.id }),
    });
    return { data: hasil.data.map(objekPelunasan), nextCursor: hasil.nextCursor, hasMore: hasil.hasMore };
  }

  return { kirim, konfirmasi, tolak, batal, bukti, detail, daftar };
}
