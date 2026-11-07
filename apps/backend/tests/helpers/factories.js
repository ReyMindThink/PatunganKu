// Pabrik data uji. Semua data unik (UUID) supaya tes tidak saling bergantung dan
// tidak perlu membersihkan tabel tambah-saja.
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";

const kodeAcak = (panjang) => randomUUID().replace(/-/g, "").slice(0, panjang).toUpperCase();

export function buatUser(data = {}) {
  return prisma.user.create({
    data: {
      email: "tes-" + randomUUID() + "@tes.local",
      passwordHash: "x",
      name: "Pengguna Tes",
      ...data,
    },
  });
}

export function buatGrup(createdBy, data = {}) {
  return prisma.group.create({
    data: { name: "Grup Tes", code: kodeAcak(10), createdBy, ...data },
  });
}

export function buatAnggota(groupId, userId, data = {}) {
  return prisma.groupMember.create({ data: { groupId, userId, ...data } });
}

export function buatTransaksi(groupId, payerId, data = {}) {
  return prisma.transaction.create({
    data: { groupId, payerId, description: "Transaksi tes", amount: 1000, ...data },
  });
}

export function buatLedger(groupId, data) {
  return prisma.ledgerEntry.create({ data: { groupId, ...data } });
}

// Satu grup dengan pemilik dan satu anggota, plus satu transaksi ACTIVE.
export async function buatSkenario() {
  const pemilik = await buatUser();
  const anggota = await buatUser();
  const grup = await buatGrup(pemilik.id);
  await buatAnggota(grup.id, pemilik.id, { role: "OWNER" });
  await buatAnggota(grup.id, anggota.id);
  const transaksi = await buatTransaksi(grup.id, pemilik.id, { status: "ACTIVE", amount: 70000 });
  return { pemilik, anggota, grup, transaksi };
}
