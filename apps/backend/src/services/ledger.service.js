import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { computeBalances, suggestSettlements } from "../utils/ledger.js";
import { PAYMENT_STATUS } from "../config/constants.js";

export async function getBalances(userId, groupId) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!members.some((m) => m.userId === userId)) {
    throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");
  }

  const [transactions, payments] = await Promise.all([
    prisma.transaction.findMany({ where: { groupId }, include: { splits: true } }),
    prisma.paymentConfirmation.findMany({
      where: { groupId, status: PAYMENT_STATUS.CONFIRMED },
    }),
  ]);

  const memberIds = members.map((m) => m.userId);
  const balances = computeBalances(memberIds, transactions, payments);

  const total = [...balances.values()].reduce((s, x) => s + x, 0);
  if (total !== 0) {
    console.error(`Ledger tidak seimbang di grup ${groupId}: total ${total}`);
  }

  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  return {
    balances: memberIds.map((id) => ({ userId: id, name: names.get(id), balance: balances.get(id) })),
    settlements: suggestSettlements(balances).map((s) => ({
      ...s,
      fromName: names.get(s.from),
      toName: names.get(s.to),
    })),
  };
}
