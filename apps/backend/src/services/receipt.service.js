import { prisma } from "../lib/prisma.js";
import { uploadReceipt, readReceiptBuffer } from "../lib/blob.js";
import { verifyReceipt } from "../lib/receiptVerifier.js";
import { decideReceipt } from "../utils/receiptDecision.js";
import { HttpError } from "../utils/httpError.js";
import { detectImageType } from "../utils/imageType.js";
import { RECEIPT_STATUS } from "../config/constants.js";

export async function attachReceipt(userId, groupId, transactionId, file) {
  if (!file) {
    throw new HttpError(400, "file-required", "File struk wajib dikirim di field 'receipt'");
  }

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!member) throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");

  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.groupId !== groupId) {
    throw new HttpError(404, "transaction-not-found", "Transaksi tidak ditemukan");
  }
  if (tx.payerId !== userId) {
    throw new HttpError(403, "forbidden", "Hanya pembayar yang boleh mengunggah struk");
  }
  if (tx.receiptStatus === RECEIPT_STATUS.VERIFIED) {
    throw new HttpError(409, "already-verified", "Struk sudah terverifikasi dan tidak bisa diganti");
  }

  const type = detectImageType(file.buffer);
  if (!type) {
    throw new HttpError(415, "unsupported-type", "File harus berupa gambar JPEG, PNG, atau WebP");
  }

  const blobName = await uploadReceipt(file.buffer, type);
  return prisma.transaction.update({
    where: { id: transactionId },
    data: { receiptUrl: blobName, receiptStatus: RECEIPT_STATUS.PENDING },
  });
}

export async function verifyTransactionReceipt(userId, groupId, transactionId) {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!member) throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");

  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.groupId !== groupId) {
    throw new HttpError(404, "transaction-not-found", "Transaksi tidak ditemukan");
  }
  if (tx.payerId !== userId) {
    throw new HttpError(403, "forbidden", "Hanya pembayar yang boleh memverifikasi struk");
  }
  if (!tx.receiptUrl) {
    throw new HttpError(400, "no-receipt", "Struk belum diunggah");
  }
  if (tx.receiptStatus === RECEIPT_STATUS.VERIFIED) {
    throw new HttpError(409, "already-verified", "Struk sudah terverifikasi");
  }

  let result;
  try {
    const buffer = await readReceiptBuffer(tx.receiptUrl);
    result = await verifyReceipt(buffer, detectImageType(buffer) ?? "image/jpeg");
  } catch (err) {
    console.error("Verifikasi struk gagal:", err.message);
    throw new HttpError(502, "verifier-unavailable", "Layanan verifikasi struk sedang bermasalah, coba lagi nanti");
  }

  const decision = decideReceipt(result, tx.amount);
  const transaction = await prisma.transaction.update({
    where: { id: transactionId },
    data: { receiptStatus: decision.status },
  });
  return { transaction, decision, detected: { total: result.total, confidence: result.confidence } };
}
