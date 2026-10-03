import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { splitEqual } from "../utils/splitMoney.js";

async function getMemberIds(groupId) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return new Set(members.map((m) => m.userId));
}

export async function createTransaction(userId, groupId, input) {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) throw new HttpError(404, "group-not-found", "Grup tidak ditemukan");

  const memberIds = await getMemberIds(groupId);
  if (!memberIds.has(userId)) {
    throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");
  }

  const payerId = input.payerId ?? userId;
  if (!memberIds.has(payerId)) {
    throw new HttpError(400, "invalid-payer", "Pembayar bukan anggota grup");
  }

  const splits =
    input.mode === "EQUAL" ? splitEqual(input.amount, input.participantIds) : input.splits;

  if (splits.some((s) => !memberIds.has(s.userId))) {
    throw new HttpError(400, "invalid-participant", "Ada peserta yang bukan anggota grup");
  }

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: { groupId, payerId, description: input.description, amount: input.amount },
    });
    await tx.transactionSplit.createMany({
      data: splits.map((s) => ({ transactionId: transaction.id, userId: s.userId, amount: s.amount })),
    });
    return tx.transaction.findUnique({
      where: { id: transaction.id },
      include: { splits: true },
    });
  });
}

export async function listTransactions(userId, groupId) {
  const memberIds = await getMemberIds(groupId);
  if (!memberIds.has(userId)) {
    throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");
  }
  return prisma.transaction.findMany({
    where: { groupId },
    include: { splits: true },
    orderBy: { createdAt: "desc" },
  });
}
