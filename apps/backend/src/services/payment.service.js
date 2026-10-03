import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { PAYMENT_STATUS } from "../config/constants.js";

async function getMemberIds(groupId) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return new Set(members.map((m) => m.userId));
}

export async function createPayment(userId, groupId, { receiverId, amount }) {
  const memberIds = await getMemberIds(groupId);
  if (!memberIds.has(userId)) {
    throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");
  }
  if (receiverId === userId) {
    throw new HttpError(400, "invalid-receiver", "Tidak bisa membayar diri sendiri");
  }
  if (!memberIds.has(receiverId)) {
    throw new HttpError(400, "invalid-receiver", "Penerima bukan anggota grup");
  }
  return prisma.paymentConfirmation.create({
    data: { groupId, senderId: userId, receiverId, amount },
  });
}

export async function decidePayment(userId, groupId, paymentId, decision) {
  const payment = await prisma.paymentConfirmation.findUnique({ where: { id: paymentId } });
  if (!payment || payment.groupId !== groupId) {
    throw new HttpError(404, "payment-not-found", "Pelunasan tidak ditemukan");
  }
  if (payment.receiverId !== userId) {
    throw new HttpError(403, "forbidden", "Hanya penerima yang boleh memutuskan");
  }
  if (payment.status !== PAYMENT_STATUS.PENDING) {
    throw new HttpError(409, "already-decided", "Pelunasan ini sudah diputuskan");
  }

  const result = await prisma.paymentConfirmation.updateMany({
    where: { id: paymentId, status: PAYMENT_STATUS.PENDING },
    data: { status: decision, decidedAt: new Date() },
  });
  if (result.count === 0) {
    throw new HttpError(409, "already-decided", "Pelunasan ini sudah diputuskan");
  }
  return prisma.paymentConfirmation.findUnique({ where: { id: paymentId } });
}

export async function listPayments(userId, groupId) {
  const memberIds = await getMemberIds(groupId);
  if (!memberIds.has(userId)) {
    throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");
  }
  return prisma.paymentConfirmation.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
  });
}
