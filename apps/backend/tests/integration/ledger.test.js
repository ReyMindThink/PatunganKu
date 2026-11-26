// Ledger di SQL Server nyata (T1.6): CHARGE dan REVERSAL lewat layanan, saldo per pasangan (K25),
// BigInt pulang-pergi (K7), penegakan "REVERSAL hanya membalik CHARGE" (celah K54), atomik
// dengan transaksi pemanggil, dan pembalikan serentak. LedgerEntry tambah-saja: tes tidak
// UPDATE atau DELETE.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatTransaksi, buatLedger } from "../helpers/factories.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { bagiMerata } from "../../src/utils/pembagian.js";

const layanan = buatLayananLedger({ db: prisma });

// Grup dengan n anggota ACTIVE (anggota pertama OWNER dan penalang) dan satu transaksi.
async function buatRuang(n = 3) {
  const user = [];
  for (let i = 0; i < n; i++) user.push(await buatUser());
  const grup = await buatGrup(user[0].id);
  for (let i = 0; i < n; i++) {
    await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: "ACTIVE" });
  }
  const transaksi = await buatTransaksi(grup.id, user[0].id, { amount: 70000 });
  return { user, grup, transaksi };
}

const dataCharge = (r, d, c, amount, ubah = {}) => ({
  type: "CHARGE",
  sign: 1,
  amount,
  debtorUserId: d.id,
  creditorUserId: c.id,
  category: "GROUP",
  transactionId: r.transaksi.id,
  createdBy: c.id,
  ...ubah,
});

async function buatSettlement(r, pengirim, penerima, jumlah) {
  const bayar = await prisma.paymentConfirmation.create({
    data: { groupId: r.grup.id, senderId: pengirim.id, receiverId: penerima.id, amount: jumlah, methodType: "CASH", status: "CONFIRMED" },
  });
  return buatLedger(r.grup.id, {
    type: "SETTLEMENT",
    sign: -1,
    amount: BigInt(jumlah),
    debtorUserId: pengirim.id,
    creditorUserId: penerima.id,
    paymentId: bayar.id,
    createdBy: penerima.id,
  });
}

const catat = (r, bagian, ubah = {}) =>
  prisma.$transaction((tx) =>
    layanan.catatTanggungan(tx, {
      groupId: r.grup.id,
      transactionId: r.transaksi.id,
      penalangId: r.user[0].id,
      bagian,
      kategori: "GROUP",
      createdBy: r.user[0].id,
      ...ubah,
    }),
  );

describe("ledger di SQL Server", () => {
  after(() => prisma.$disconnect());

  it("Rp70.000 untuk tiga peserta: dua CHARGE Rp23.333 ke penalang, penalang menanggung 23.334 sendiri; saldo grup berjumlah nol", async () => {
    const r = await buatRuang(3);
    const bagian = bagiMerata(70000, r.user.map((u) => u.id));
    assert.deepEqual(bagian.map((b) => b.amount), [23334, 23333, 23333]);
    await catat(r, bagian);
    const baris = await prisma.ledgerEntry.findMany({ where: { transactionId: r.transaksi.id }, orderBy: { id: "asc" } });
    assert.equal(baris.length, 2);
    assert.deepEqual(baris.map((b) => b.debtorUserId), [r.user[1].id, r.user[2].id]);
    for (const b of baris) {
      assert.equal(b.type, "CHARGE");
      assert.equal(b.sign, 1);
      assert.equal(b.amount, 23333n);
      assert.equal(b.creditorUserId, r.user[0].id);
      assert.equal(b.category, "GROUP");
      assert.equal(b.createdBy, r.user[0].id);
    }
    const ringkas = await layanan.ringkasan(r.grup.id);
    assert.deepEqual(ringkas, [
      { userId: r.user[0].id, owes: 0, owed: 46666, balance: 46666 },
      { userId: r.user[1].id, owes: 23333, owed: 0, balance: -23333 },
      { userId: r.user[2].id, owes: 23333, owed: 0, balance: -23333 },
    ]);
    assert.equal(ringkas.reduce((s, x) => s + x.balance, 0), 0);
  });

  it("balikTanggungan menulis REVERSAL berkategori sama dan saldo kembali nol; pemanggilan ulang tidak menambah baris", async () => {
    const r = await buatRuang(3);
    await catat(r, bagiMerata(70000, r.user.map((u) => u.id)));
    const hasil = await prisma.$transaction((tx) => layanan.balikTanggungan(tx, { groupId: r.grup.id, transactionId: r.transaksi.id, createdBy: r.user[0].id }));
    assert.equal(hasil.entryIds.length, 2);
    const balik = await prisma.ledgerEntry.findMany({ where: { transactionId: r.transaksi.id, type: "REVERSAL" } });
    assert.equal(balik.length, 2);
    for (const b of balik) {
      assert.equal(b.sign, -1);
      assert.equal(b.category, "GROUP");
      assert.equal(b.amount, 23333n);
      assert.notEqual(b.reversesEntryId, null);
    }
    const ringkas = await layanan.ringkasan(r.grup.id);
    assert.deepEqual(ringkas.map((x) => x.balance), [0, 0, 0]);
    const lagi = await prisma.$transaction((tx) => layanan.balikTanggungan(tx, { groupId: r.grup.id, transactionId: r.transaksi.id, createdBy: r.user[0].id }));
    assert.deepEqual(lagi, { entryIds: [] });
    assert.equal(await prisma.ledgerEntry.count({ where: { transactionId: r.transaksi.id } }), 4);
  });

  it("REVERSAL atas SETTLEMENT ditolak layanan (celah K54) dan tidak ada baris yang ditulis", async () => {
    const r = await buatRuang(2);
    const settle = await buatSettlement(r, r.user[1], r.user[0], 5000);
    await assert.rejects(
      () => prisma.$transaction((tx) => layanan.balikEntri(tx, { groupId: r.grup.id, entryId: settle.id, createdBy: r.user[0].id })),
      (e) => e.status === 409 && e.code === "invalid-state",
    );
    assert.equal(await prisma.ledgerEntry.count({ where: { reversesEntryId: settle.id } }), 0);
    await assert.rejects(
      () => prisma.$transaction((tx) => layanan.balikEntri(tx, { groupId: r.grup.id + 999999, entryId: settle.id, createdBy: r.user[0].id })),
      (e) => e.status === 404 && e.code === "not-found",
    );
  });

  it("K25: A menanggung Rp50.000 ke B, B menanggung Rp20.000 ke A: saldo Rp30.000; pelunasan Rp30.000 menjadi nol", async () => {
    const r = await buatRuang(2);
    const [a, b] = r.user;
    await buatLedger(r.grup.id, dataCharge(r, a, b, 50000n));
    await buatLedger(r.grup.id, dataCharge(r, b, a, 20000n));
    assert.equal(await layanan.saldoPasangan(r.grup.id, a.id, b.id), 30000);
    assert.equal(await layanan.saldoPasangan(r.grup.id, b.id, a.id), -30000);
    await buatSettlement(r, a, b, 30000);
    assert.equal(await layanan.saldoPasangan(r.grup.id, a.id, b.id), 0);
    const rincian = await layanan.rincian(r.grup.id, a.id);
    assert.deepEqual(rincian.counterparties, []);
  });

  it("BigInt pulang-pergi: jumlah Rp5.000.000.000.000 tersimpan, terbaca BigInt, dan keluar sebagai Number tepat", async () => {
    const r = await buatRuang(2);
    const [a, b] = r.user;
    const simpan = await buatLedger(r.grup.id, dataCharge(r, a, b, 5_000_000_000_000n));
    const baca = await prisma.ledgerEntry.findUnique({ where: { id: simpan.id } });
    assert.equal(typeof baca.amount, "bigint");
    assert.equal(baca.amount, 5_000_000_000_000n);
    const ringkas = await layanan.ringkasan(r.grup.id);
    assert.deepEqual(ringkas.map((x) => x.balance), [-5_000_000_000_000, 5_000_000_000_000]);
  });

  it("atomik dengan transaksi pemanggil: galat setelah catatTanggungan membatalkan semua CHARGE", async () => {
    const r = await buatRuang(3);
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await layanan.catatTanggungan(tx, {
            groupId: r.grup.id,
            transactionId: r.transaksi.id,
            penalangId: r.user[0].id,
            bagian: bagiMerata(70000, r.user.map((u) => u.id)),
            kategori: "GROUP",
            createdBy: r.user[0].id,
          });
          throw new Error("batal sengaja");
        }),
      /batal sengaja/,
    );
    assert.equal(await prisma.ledgerEntry.count({ where: { groupId: r.grup.id } }), 0);
  });

  it("pembalikan serentak atas satu CHARGE: tepat satu REVERSAL tersimpan, yang lain 409 invalid-state", async () => {
    const r = await buatRuang(2);
    const charge = await buatLedger(r.grup.id, dataCharge(r, r.user[1], r.user[0], 10000n));
    const balik = () => prisma.$transaction((tx) => layanan.balikEntri(tx, { groupId: r.grup.id, entryId: charge.id, createdBy: r.user[0].id }));
    const hasil = await Promise.allSettled([balik(), balik()]);
    assert.equal(hasil.filter((h) => h.status === "fulfilled").length, 1);
    const ditolak = hasil.filter((h) => h.status === "rejected");
    assert.equal(ditolak.length, 1);
    assert.equal(ditolak[0].reason.status, 409);
    assert.equal(ditolak[0].reason.code, "invalid-state");
    assert.equal(await prisma.ledgerEntry.count({ where: { reversesEntryId: charge.id } }), 1);
  });

  it("keutuhan grup: transaksi grup lain atau pihak bukan anggota ditolak tanpa menulis", async () => {
    const r = await buatRuang(2);
    const lain = await buatRuang(2);
    await assert.rejects(
      () => catat(r, [{ userId: r.user[1].id, amount: 100 }], { transactionId: lain.transaksi.id }),
      /bukan milik grup/,
    );
    const orangAsing = await buatUser();
    await assert.rejects(() => catat(r, [{ userId: orangAsing.id, amount: 100 }]), /bukan anggota/);
    assert.equal(await prisma.ledgerEntry.count({ where: { groupId: r.grup.id } }), 0);
    assert.equal(await prisma.ledgerEntry.count({ where: { groupId: lain.grup.id } }), 0);
  });
});
