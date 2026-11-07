// Layanan ledger (K1, K7, K25, K54). Pabrik murni: db disuntik. Fungsi tulis menerima tx
// (klien transaksi) supaya entri ledger ter-commit atau batal bersama aksi pemanggilnya.
// Pemanggil (T1.7 dan seterusnya) tetap wajib memeriksa bahwa peserta adalah anggota
// ACTIVE; di sini yang dijaga adalah keutuhan: transaksi dan pengguna harus milik grup itu.
import { HttpError } from "../utils/httpError.js";
import { ringkasanSaldo, rincianSaldo, saldoPasangan } from "../utils/saldo.js";

const KATEGORI = ["GROUP", "INDIVIDUAL"];
const idSah = (n) => Number.isSafeInteger(n) && n > 0;
const galat = (pesan) => new Error("ledger: " + pesan);

const SELECT_ASAL = { id: true, groupId: true, type: true, amount: true, debtorUserId: true, creditorUserId: true, category: true, transactionId: true };

export function buatLayananLedger({ db }) {
  // Satu CHARGE per bagian: debitur = anggota, kreditur = penalang. Bagian penalang sendiri
  // dan bagian bernilai nol tidak menulis entri (CHECK database menolak amount nol).
  async function catatTanggungan(tx, { groupId, transactionId, penalangId, bagian, kategori, createdBy }) {
    for (const [nama, nilai] of [["groupId", groupId], ["transactionId", transactionId], ["penalangId", penalangId], ["createdBy", createdBy]]) {
      if (idSah(nilai) === false) throw galat(nama + " harus bilangan bulat positif");
    }
    if (KATEGORI.includes(kategori) === false) throw galat("kategori tidak dikenal");
    if (Array.isArray(bagian) === false) throw galat("bagian harus berupa daftar");
    const dilihat = new Set();
    for (const b of bagian) {
      if (idSah(b?.userId) === false) throw galat("userId bagian tidak sah");
      if (dilihat.has(b.userId)) throw galat("userId kembar di bagian: " + b.userId);
      dilihat.add(b.userId);
      if (Number.isSafeInteger(b.amount) === false || b.amount < 0) throw galat("amount bagian harus bilangan bulat tak negatif");
    }

    const trx = await tx.transaction.findUnique({ where: { id: transactionId }, select: { groupId: true } });
    const milikGrup = trx && trx.groupId === groupId;
    if (Boolean(milikGrup) === false) throw galat("transaksi bukan milik grup ini");
    const pihak = [...new Set([penalangId, ...bagian.map((b) => b.userId)])];
    const anggota = await tx.groupMember.count({ where: { groupId, userId: { in: pihak } } });
    const lengkap = anggota === pihak.length;
    if (lengkap === false) throw galat("ada pihak yang bukan anggota grup ini");

    const ids = [];
    const urut = [...bagian].sort((x, y) => x.userId - y.userId);
    for (const b of urut) {
      if (b.userId === penalangId || b.amount === 0) continue;
      const baris = await tx.ledgerEntry.create({
        data: {
          groupId,
          type: "CHARGE",
          sign: 1,
          amount: BigInt(b.amount),
          debtorUserId: b.userId,
          creditorUserId: penalangId,
          category: kategori,
          transactionId,
          createdBy,
        },
        select: { id: true },
      });
      ids.push(baris.id);
    }
    return { entryIds: ids };
  }

  // REVERSAL hanya membalik CHARGE (celah K54: database menerima REVERSAL atas SETTLEMENT).
  async function balikEntri(tx, { groupId, entryId, createdBy }) {
    if (idSah(groupId) === false || idSah(entryId) === false || idSah(createdBy) === false) throw galat("argumen balikEntri tidak sah");
    const asal = await tx.ledgerEntry.findUnique({ where: { id: entryId }, select: SELECT_ASAL });
    const milik = asal && asal.groupId === groupId;
    if (Boolean(milik) === false) throw new HttpError(404, "not-found", "Entri ledger tidak ditemukan.");
    const charge = asal.type === "CHARGE";
    if (charge === false) throw new HttpError(409, "invalid-state", "Hanya tanggungan (CHARGE) yang dapat dibalik.");
    const sudah = await tx.ledgerEntry.findFirst({ where: { reversesEntryId: asal.id }, select: { id: true } });
    if (sudah) throw new HttpError(409, "invalid-state", "Entri ini sudah dibalik.");
    try {
      const baris = await tx.ledgerEntry.create({
        data: {
          groupId,
          type: "REVERSAL",
          sign: -1,
          amount: asal.amount,
          debtorUserId: asal.debtorUserId,
          creditorUserId: asal.creditorUserId,
          category: asal.category,
          transactionId: asal.transactionId,
          reversesEntryId: asal.id,
          createdBy,
        },
        select: { id: true },
      });
      return { entryId: baris.id };
    } catch (e) {
      // Pembalikan serentak: indeks unik terfilter UX_LedgerEntry_Reverses menolak yang kedua.
      const teks = [e?.code, e?.message, e?.cause?.message].filter(Boolean).join(" ");
      if (teks.includes("UX_LedgerEntry_Reverses") || e?.code === "P2002") {
        throw new HttpError(409, "invalid-state", "Entri ini sudah dibalik.");
      }
      throw e;
    }
  }

  // Membalik semua CHARGE sebuah transaksi yang belum dibalik. Dipanggil ulang aman: yang
  // sudah dibalik dilewati.
  async function balikTanggungan(tx, { groupId, transactionId, createdBy }) {
    if (idSah(groupId) === false || idSah(transactionId) === false) throw galat("argumen balikTanggungan tidak sah");
    const sisa = await tx.ledgerEntry.findMany({
      where: { groupId, transactionId, type: "CHARGE", reversedBy: { none: {} } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const ids = [];
    for (const s of sisa) ids.push((await balikEntri(tx, { groupId, entryId: s.id, createdBy })).entryId);
    return { entryIds: ids };
  }

  const bacaEntri = (groupId) =>
    db.ledgerEntry.findMany({
      where: { groupId },
      select: { type: true, sign: true, amount: true, debtorUserId: true, creditorUserId: true, category: true },
    });

  return {
    catatTanggungan,
    balikEntri,
    balikTanggungan,
    ringkasan: async (groupId) => ringkasanSaldo(await bacaEntri(groupId)),
    rincian: async (groupId, userId) => rincianSaldo(await bacaEntri(groupId), userId),
    saldoPasangan: async (groupId, a, b) => saldoPasangan(await bacaEntri(groupId), a, b),
  };
}
