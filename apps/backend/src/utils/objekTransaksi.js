// Bentuk objek transaksi untuk respons (api-contract 9.1) dan aturan siapa melihat daftar
// peserta (9.5, K23). Murni. Server yang mengisi participants dan myShare, klien tidak
// menurunkannya sendiri. Daftar lengkap hanya untuk: semua anggota bila ACTIVE, atau
// penalang dan admin pada status lain. Peserta lain hanya melihat bagian sendiri dan jumlah.
import { GROUP_ROLE } from "../config/constants.js";

// t: baris transaksi dengan payer { id, name } dan shares ({ userId, amount, consent, user? });
// jumlahShare opsional (daftar membawa hitungan, bukan semua share).
// pemanggil: { userId, role }. rinci: true hanya untuk detail (shares lengkap tersedia).
export function objekTransaksi(t, pemanggil, { rinci = false } = {}) {
  const shares = t.shares ?? [];
  const penalang = t.payer.id === pemanggil.userId;
  const admin = pemanggil.role === GROUP_ROLE.OWNER || pemanggil.role === GROUP_ROLE.ADMIN;
  const lengkap = t.status === "ACTIVE" || penalang || admin;
  const milikku = shares.find((s) => s.userId === pemanggil.userId) ?? null;
  return {
    id: t.id,
    groupId: t.groupId,
    description: t.description,
    amount: t.amount,
    mode: t.mode,
    status: t.status,
    receiptStatus: t.receiptStatus,
    itemsPhase: null,
    version: t.version,
    payer: { id: t.payer.id, name: t.payer.name },
    paidFromFund: false,
    hasReceipt: Boolean(t.receiptUrl),
    participantCount: t.jumlahShare ?? shares.length,
    participants:
      rinci && lengkap
        ? shares.map((s) => ({ user: { id: s.user.id, name: s.user.name }, amount: s.amount, consent: s.consent }))
        : null,
    myShare: milikku === null ? null : { amount: milikku.amount, consent: milikku.consent },
    approval: null,
    expiresAt: t.expiresAt ?? null,
    createdAt: t.createdAt,
  };
}
