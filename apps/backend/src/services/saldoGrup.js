// Layanan membaca saldo (api-contract 10.2). Pabrik murni: db dan ledger disuntik. Saldo
// selalu dihitung dari entri ledger (K25) dan tidak disimpan. Pihak Dana Kelompok (kind FUND)
// belum ada sampai Tahap 3, jadi party.kind selalu USER.
import { HttpError } from "../utils/httpError.js";

const PILIH_ANGGOTA = { userId: true, status: true, user: { select: { name: true } } };
const NOL = { owes: 0, owed: 0, balance: 0 };
const pihak = (m) => ({ kind: "USER", id: m.userId, name: m.user.name, membership: m.status });
const adaSaldo = (s) => (s.owes === 0 && s.owed === 0) === false;

export function buatLayananSaldo({ db, ledger }) {
  async function anggotaGrup(groupId) {
    const baris = await db.groupMember.findMany({ where: { groupId }, select: PILIH_ANGGOTA, orderBy: { userId: "asc" } });
    return new Map(baris.map((m) => [m.userId, m]));
  }

  // Anggota ACTIVE melihat semua anggota ACTIVE (termasuk saldo nol) ditambah mantan anggota
  // yang masih punya saldo. Mantan anggota hanya melihat barisnya sendiri.
  async function ringkasanGrup(ctx) {
    const anggota = await anggotaGrup(ctx.groupId);
    const saldo = new Map((await ledger.ringkasan(ctx.groupId)).map((r) => [r.userId, r]));
    const baris = (m) => {
      const s = saldo.get(m.userId) ?? NOL;
      return { party: pihak(m), owes: s.owes, owed: s.owed, balance: s.balance };
    };
    if (ctx.status === "ACTIVE") {
      const tampil = [...anggota.values()].filter((m) => m.status === "ACTIVE" || adaSaldo(saldo.get(m.userId) ?? NOL));
      return { members: tampil.map(baris) };
    }
    return { members: [baris(anggota.get(ctx.userId))] };
  }

  async function rincian(ctx, targetId) {
    if (targetId === "fund") {
      const pesan = "Dana Kelompok belum didukung.";
      throw new HttpError(400, "validation-failed", pesan, [{ field: "userId", message: pesan }]);
    }
    if ((ctx.status === "ACTIVE") === false && (targetId === ctx.userId) === false) {
      throw new HttpError(403, "forbidden", "Anda hanya dapat melihat saldo milik Anda sendiri.");
    }
    const anggota = await anggotaGrup(ctx.groupId);
    const target = anggota.get(targetId);
    if (target === undefined) throw new HttpError(404, "not-found", "Anggota tidak ditemukan.");
    const r = await ledger.rincian(ctx.groupId, targetId);

    // Pelunasan PENDING hanya relevan bagi pemanggil sendiri (kontrak 10.2).
    const milikSendiri = targetId === ctx.userId;
    const tertunda = new Map();
    if (milikSendiri) {
      const baris = await db.paymentConfirmation.findMany({ where: { groupId: ctx.groupId, senderId: ctx.userId, status: "PENDING" }, select: { receiverId: true, amount: true } });
      for (const b of baris) tertunda.set(b.receiverId, (tertunda.get(b.receiverId) ?? 0) + b.amount);
    }
    const counterparties = r.counterparties.map((c) => {
      const lawan = anggota.get(c.userId);
      if (lawan === undefined) throw new Error("saldo: pihak lawan bukan anggota grup");
      const pending = tertunda.get(c.userId) ?? 0;
      return {
        party: pihak(lawan),
        amount: c.amount,
        direction: c.direction,
        breakdown: c.breakdown,
        pendingPayments: milikSendiri ? pending : null,
        payable: milikSendiri ? (c.direction === "X_OWES" ? Math.max(0, c.amount - pending) : 0) : null,
      };
    });
    return { party: pihak(target), owes: r.owes, owed: r.owed, counterparties };
  }

  // Ringkasan saya lintas grup: grup ACTIVE selalu tampil, grup mantan hanya bila masih bersaldo.
  async function ringkasanSaya(userId) {
    const keanggotaan = await db.groupMember.findMany({
      where: { userId },
      orderBy: { groupId: "desc" },
      select: { groupId: true, status: true, group: { select: { id: true, name: true } } },
    });
    const peta = await ledger.ringkasanPerGrup(keanggotaan.map((k) => k.groupId));
    const groups = [];
    for (const k of keanggotaan) {
      const s = (peta.get(k.groupId) ?? []).find((r) => r.userId === userId) ?? NOL;
      if (k.status === "ACTIVE" || adaSaldo(s)) groups.push({ group: { id: k.group.id, name: k.group.name }, owes: s.owes, owed: s.owed, balance: s.balance });
    }
    const totals = { owes: 0, owed: 0, balance: 0 };
    for (const g of groups) {
      totals.owes += g.owes;
      totals.owed += g.owed;
      totals.balance += g.balance;
    }
    return { totals, groups };
  }

  return { ringkasanGrup, rincian, ringkasanSaya };
}
