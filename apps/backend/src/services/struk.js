// Layanan struk (api-contract 9.3): unggah dan verifikasi. Pabrik murni: penyimpanan blob,
// pemverifikasi (Gemini), dan pembaca transaksi disuntik; fungsi menerima tx dari pembungkus
// idempotensi. Panggilan ke layanan luar dilakukan SEBELUM penulisan apa pun di transaksi itu,
// jadi tidak menahan kunci baris. Klaim baris transaksi mendahului penulisan ekstraksi karena
// (transactionId, version) unik: yang kedua menunggu yang pertama commit lalu membaca versi terbaru.
import { STRUK } from "../config/constants.js";
import { HttpError } from "../utils/httpError.js";
import { detectImageType } from "../utils/imageType.js";
import { putuskanStruk } from "../utils/keputusanStruk.js";
import { muatTransaksi } from "../utils/muatTransaksi.js";
import { fingerprintStruk, sha256Hex } from "../utils/sidikStruk.js";

const PILIH = { id: true, groupId: true, payerId: true, amount: true, status: true, receiptUrl: true, receiptStatus: true, imageSha256: true };
const konflik = (pesan) => new HttpError(409, "invalid-state", pesan);
const hulu = (pesan) => new HttpError(502, "upstream-error", pesan);

export function buatLayananStruk({ penyimpanan, pemverif, bacaTransaksi }) {
  async function unggah(tx, ctx, transactionId, { buffer }) {
    const t = await muatTransaksi(tx, ctx, transactionId, { tulis: true, pilih: PILIH });
    if ((t.status === "DRAFT") === false) throw konflik("Struk hanya dapat diunggah pada transaksi DRAFT.");
    const tipe = detectImageType(buffer);
    if (tipe === null) throw new HttpError(415, "unsupported-media-type", "Format gambar harus JPEG, PNG, atau WebP.");
    if (buffer.length > STRUK.UKURAN_MAKS) throw new HttpError(413, "payload-too-large", "Ukuran berkas maksimal 5 MB.");

    const sha = sha256Hex(buffer);
    const kembar = await tx.transaction.findFirst({
      where: { groupId: ctx.groupId, imageSha256: sha, status: { in: STRUK.STATUS_DUPLIKAT }, id: { not: transactionId } },
      select: { id: true },
    });
    if (kembar) {
      throw new HttpError(409, "duplicate-receipt", "Gambar struk ini sudah dipakai pada transaksi lain di grup.", undefined, { existingTransactionId: kembar.id });
    }

    const nama = await penyimpanan.simpan(buffer, tipe);
    try {
      const hasil = await tx.transaction.updateMany({
        where: { id: transactionId, groupId: ctx.groupId, payerId: ctx.userId, status: "DRAFT" },
        data: { receiptUrl: nama, imageSha256: sha, receiptStatus: "PENDING", fingerprint: null },
      });
      if (hasil.count === 0) throw konflik("Transaksi sudah tidak berstatus DRAFT.");
    } catch (e) {
      try {
        await penyimpanan.hapus(nama);
      } catch {
        // Sisa blob dibersihkan job pembersih (Tahap 4); galat asli lebih penting.
      }
      throw e;
    }
    return bacaTransaksi(tx, ctx, transactionId);
  }

  async function verifikasi(tx, ctx, transactionId) {
    const t = await muatTransaksi(tx, ctx, transactionId, { tulis: true, pilih: PILIH });
    if ((t.status === "DRAFT") === false) throw konflik("Struk hanya dapat diverifikasi pada transaksi DRAFT.");
    if (Boolean(t.receiptUrl) === false) throw konflik("Struk belum diunggah.");

    let buffer;
    try {
      buffer = await penyimpanan.baca(t.receiptUrl);
    } catch {
      throw hulu("Penyimpanan struk tidak tersedia.");
    }
    const tipe = detectImageType(buffer);
    if (tipe === null) throw hulu("Berkas struk tidak dapat dibaca.");
    const hasil = await pemverif(buffer, tipe);

    const fingerprint = fingerprintStruk({ merchant: hasil.merchant, purchasedAt: hasil.purchasedAt, total: hasil.total });
    const mirip =
      fingerprint === null
        ? null
        : await tx.transaction.findFirst({
            where: { groupId: ctx.groupId, fingerprint, status: { in: STRUK.STATUS_DUPLIKAT }, id: { not: transactionId } },
            select: { id: true },
          });
    const keputusan = putuskanStruk({ hasil, nominal: t.amount, duplikatId: mirip ? mirip.id : null });

    const klaim = await tx.transaction.updateMany({
      where: { id: transactionId, groupId: ctx.groupId, payerId: ctx.userId, status: "DRAFT", imageSha256: t.imageSha256 },
      data: { receiptStatus: keputusan.status, fingerprint },
    });
    if (klaim.count === 0) throw konflik("Struk atau status transaksi berubah selama verifikasi.");

    const terakhir = await tx.receiptExtraction.findFirst({ where: { transactionId }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.receiptExtraction.create({
      data: {
        transactionId,
        version: (terakhir ? terakhir.version : 0) + 1,
        source: "AI",
        createdBy: ctx.userId,
        merchant: hasil.merchant,
        purchasedAt: hasil.purchasedAt,
        total: hasil.total,
        confidence: hasil.confidence,
        rawJson: JSON.stringify({
          isReceipt: hasil.isReceipt, total: hasil.total, confidence: hasil.confidence, merchant: hasil.merchant,
          purchasedAt: hasil.purchasedAt ? hasil.purchasedAt.toISOString() : null, decision: { status: keputusan.status, reason: keputusan.reason },
        }),
        aiModel: hasil.aiModel,
        promptVersion: hasil.promptVersion,
      },
    });
    return { transaction: await bacaTransaksi(tx, ctx, transactionId), decision: keputusan, detected: { total: hasil.total, confidence: hasil.confidence } };
  }

  return { unggah, verifikasi };
}
