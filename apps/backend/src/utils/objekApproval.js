// Bentuk objek Approval untuk respons (api-contract 6.3). Murni. canVote dihitung server:
// Approval OPEN dan belum kedaluwarsa, pemanggil bukan pengaju, memenuhi rule, dan belum memilih.
import { bolehMemilih } from "./aturanPersetujuan.js";

// a: baris Approval dengan requester { id, name } dan votes [{ userId, vote }].
// subject: baris transaksi terkait atau null. pemanggil: { userId, role }. sekarang: ms.
export function objekApproval(a, subject, pemanggil, sekarang) {
  const votes = a.votes ?? [];
  const saya = votes.find((v) => v.userId === pemanggil.userId) ?? null;
  const terbuka = a.status === "OPEN" && a.expiresAt.getTime() > sekarang;
  const bolehMilih = bolehMemilih({ rule: a.rule, role: pemanggil.role });
  const canVote = terbuka && (a.requestedBy === pemanggil.userId) === false && bolehMilih && saya === null;
  return {
    id: a.id,
    groupId: a.groupId,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    rule: a.rule,
    status: a.status,
    required: a.required,
    eligibleCount: a.eligibleCount,
    approveCount: votes.filter((v) => v.vote === "APPROVE").length,
    rejectCount: votes.filter((v) => v.vote === "REJECT").length,
    myVote: saya === null ? null : saya.vote,
    canVote,
    requestedBy: { id: a.requester.id, name: a.requester.name },
    subject:
      subject === null || subject === undefined
        ? null
        : { transactionId: subject.id, description: subject.description, amount: subject.amount, mode: subject.mode, receiptStatus: subject.receiptStatus },
    expiresAt: a.expiresAt,
    decidedAt: a.decidedAt ?? null,
    createdAt: a.createdAt,
  };
}
