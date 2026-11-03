import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananLedger } from "../../src/services/ledger.js";

// tx/db palsu di memori. BUKAN bukti SQL Server. findMany meniru filter yang dipakai layanan,
// termasuk reversedBy: { none: {} }, supaya pembalikan ganda terdeteksi oleh tes.
function buatTx(awal = {}) {
  const s = { transaksi: { 10: { groupId: 7 }, 11: { groupId: 7 }, 20: { groupId: 8 } }, anggota: [1, 2, 3], entri: [], ...awal };
  const log = [];
  let nomor = 100;
  const sudahDibalik = (e) => s.entri.some((x) => x.reversesEntryId === e.id);
  return {
    log,
    s,
    transaction: { findUnique: async ({ where }) => s.transaksi[where.id] ?? null },
    groupMember: {
      count: async ({ where }) => {
        log.push({ nama: "groupMember.count", where });
        return where.userId.in.filter((id) => s.anggota.includes(id)).length;
      },
    },
    ledgerEntry: {
      create: async ({ data }) => {
        log.push({ nama: "create", data });
        if (s.gagalCreate) throw s.gagalCreate;
        const baris = { id: nomor++, ...data };
        s.entri.push(baris);
        return { id: baris.id };
      },
      findUnique: async ({ where }) => s.entri.find((e) => e.id === where.id) ?? null,
      findFirst: async ({ where }) => s.entri.find((e) => e.reversesEntryId === where.reversesEntryId) ?? null,
      findMany: async (arg) => {
        log.push({ nama: "findMany", arg });
        const w = arg.where;
        return s.entri.filter((e) => {
          const cocok = (kunci) => w[kunci] === undefined || e[kunci] === w[kunci];
          if (cocok("groupId") === false || cocok("transactionId") === false || cocok("type") === false) return false;
          if (w.reversedBy && sudahDibalik(e)) return false;
          return true;
        });
      },
    },
  };
}
const dibuat = (tx) => tx.log.filter((l) => l.nama === "create");
const charge = (id, tambah = {}) => ({
  id, groupId: 7, type: "CHARGE", sign: 1, amount: 5000n, debtorUserId: 2, creditorUserId: 1, category: "GROUP", transactionId: 10, ...tambah,
});
const galat = (status, code) => (e) => e.status === status && e.code === code;
const dasar = { groupId: 7, transactionId: 10, penalangId: 2, kategori: "GROUP", createdBy: 2 };

describe("catatTanggungan", () => {
  it("satu CHARGE per anggota (urut userId), kreditur penalang, bagian penalang tidak menulis entri", async () => {
    const tx = buatTx();
    const hasil = await buatLayananLedger({ db: tx }).catatTanggungan(tx, {
      ...dasar,
      bagian: [{ userId: 3, amount: 23333 }, { userId: 1, amount: 23334 }, { userId: 2, amount: 23333 }],
    });
    assert.deepEqual(dibuat(tx).map((c) => c.data), [
      { groupId: 7, type: "CHARGE", sign: 1, amount: 23334n, debtorUserId: 1, creditorUserId: 2, category: "GROUP", transactionId: 10, createdBy: 2 },
      { groupId: 7, type: "CHARGE", sign: 1, amount: 23333n, debtorUserId: 3, creditorUserId: 2, category: "GROUP", transactionId: 10, createdBy: 2 },
    ]);
    assert.deepEqual(hasil, { entryIds: [100, 101] });
  });

  it("bagian bernilai nol dilewati, dan kategori INDIVIDUAL diteruskan", async () => {
    const tx = buatTx();
    await buatLayananLedger({ db: tx }).catatTanggungan(tx, { ...dasar, kategori: "INDIVIDUAL", bagian: [{ userId: 1, amount: 0 }, { userId: 3, amount: 1 }] });
    assert.equal(dibuat(tx).length, 1);
    assert.equal(dibuat(tx)[0].data.debtorUserId, 3);
    assert.equal(dibuat(tx)[0].data.category, "INDIVIDUAL");
    const kosong = buatTx();
    const hasil = await buatLayananLedger({ db: kosong }).catatTanggungan(kosong, { ...dasar, bagian: [{ userId: 2, amount: 70000 }] });
    assert.deepEqual(hasil, { entryIds: [] });
    assert.equal(dibuat(kosong).length, 0);
  });

  it("argumen tak sah ditolak sebelum menyentuh database", async () => {
    const buruk = [
      { bagian: [{ userId: 1, amount: 5 }, { userId: 1, amount: 6 }] },
      { bagian: [{ userId: 1, amount: -1 }] },
      { bagian: [{ userId: 1, amount: 1.5 }] },
      { bagian: [{ userId: 0, amount: 5 }] },
      { bagian: "x" },
      { bagian: [], kategori: "LAIN" },
      { bagian: [], penalangId: 0 },
      { bagian: [], transactionId: "10" },
    ];
    for (const b of buruk) {
      const tx = buatTx();
      await assert.rejects(() => buatLayananLedger({ db: tx }).catatTanggungan(tx, { ...dasar, ...b }), /ledger:/);
      assert.equal(tx.log.length, 0, "tidak boleh menyentuh database: " + JSON.stringify(b));
    }
  });

  it("transaksi tak ada, transaksi milik grup lain, atau pihak bukan anggota grup: ditolak tanpa menulis", async () => {
    const bagian = [{ userId: 1, amount: 100 }];
    const lain = buatTx();
    await assert.rejects(() => buatLayananLedger({ db: lain }).catatTanggungan(lain, { ...dasar, transactionId: 20, bagian }), /bukan milik grup/);
    const hilang = buatTx();
    await assert.rejects(() => buatLayananLedger({ db: hilang }).catatTanggungan(hilang, { ...dasar, transactionId: 99, bagian }), /bukan milik grup/);
    const asing = buatTx();
    await assert.rejects(() => buatLayananLedger({ db: asing }).catatTanggungan(asing, { ...dasar, bagian: [{ userId: 9, amount: 100 }] }), /bukan anggota/);
    const penalangAsing = buatTx({ anggota: [1, 3] });
    await assert.rejects(() => buatLayananLedger({ db: penalangAsing }).catatTanggungan(penalangAsing, { ...dasar, bagian }), /bukan anggota/);
    for (const tx of [lain, hilang, asing, penalangAsing]) assert.equal(dibuat(tx).length, 0);
  });
});

describe("balikEntri (celah K54)", () => {
  it("membalik CHARGE: salinan pihak, jumlah, kategori, dan transaksi; sign -1; menunjuk entri asal", async () => {
    const tx = buatTx({ entri: [charge(1, { category: "INDIVIDUAL" })] });
    const hasil = await buatLayananLedger({ db: tx }).balikEntri(tx, { groupId: 7, entryId: 1, createdBy: 5 });
    assert.deepEqual(hasil, { entryId: 100 });
    assert.deepEqual(dibuat(tx)[0].data, {
      groupId: 7, type: "REVERSAL", sign: -1, amount: 5000n, debtorUserId: 2, creditorUserId: 1,
      category: "INDIVIDUAL", transactionId: 10, reversesEntryId: 1, createdBy: 5,
    });
  });

  it("menolak membalik SETTLEMENT atau REVERSAL (409 invalid-state) tanpa menulis", async () => {
    const tx = buatTx({
      entri: [
        { id: 1, groupId: 7, type: "SETTLEMENT", sign: -1, amount: 5000n, debtorUserId: 2, creditorUserId: 1, category: null, transactionId: null },
        { ...charge(2), id: 2, type: "REVERSAL", sign: -1, reversesEntryId: 9 },
      ],
    });
    const layanan = buatLayananLedger({ db: tx });
    await assert.rejects(() => layanan.balikEntri(tx, { groupId: 7, entryId: 1, createdBy: 5 }), galat(409, "invalid-state"));
    await assert.rejects(() => layanan.balikEntri(tx, { groupId: 7, entryId: 2, createdBy: 5 }), galat(409, "invalid-state"));
    assert.equal(dibuat(tx).length, 0);
  });

  it("entri tak ada atau milik grup lain 404; entri yang sudah dibalik 409", async () => {
    const tx = buatTx({ entri: [charge(1), charge(2, { groupId: 8 }), { ...charge(3), type: "REVERSAL", sign: -1, reversesEntryId: 1 }] });
    const layanan = buatLayananLedger({ db: tx });
    await assert.rejects(() => layanan.balikEntri(tx, { groupId: 7, entryId: 99, createdBy: 5 }), galat(404, "not-found"));
    await assert.rejects(() => layanan.balikEntri(tx, { groupId: 7, entryId: 2, createdBy: 5 }), galat(404, "not-found"));
    await assert.rejects(() => layanan.balikEntri(tx, { groupId: 7, entryId: 1, createdBy: 5 }), galat(409, "invalid-state"));
    assert.equal(dibuat(tx).length, 0);
  });

  it("pembalikan serentak: pelanggaran indeks unik (lewat kode atau nama indeks) dipetakan ke 409, galat lain diteruskan", async () => {
    const lewatKode = buatTx({ entri: [charge(1)], gagalCreate: Object.assign(new Error("unique constraint"), { code: "P2002" }) });
    await assert.rejects(() => buatLayananLedger({ db: lewatKode }).balikEntri(lewatKode, { groupId: 7, entryId: 1, createdBy: 5 }), galat(409, "invalid-state"));
    const lewatNama = buatTx({ entri: [charge(1)], gagalCreate: new Error("Violation of UNIQUE INDEX UX_LedgerEntry_Reverses") });
    await assert.rejects(() => buatLayananLedger({ db: lewatNama }).balikEntri(lewatNama, { groupId: 7, entryId: 1, createdBy: 5 }), galat(409, "invalid-state"));
    const lain = buatTx({ entri: [charge(1)], gagalCreate: new Error("koneksi putus") });
    await assert.rejects(() => buatLayananLedger({ db: lain }).balikEntri(lain, { groupId: 7, entryId: 1, createdBy: 5 }), /koneksi putus/);
  });
});

describe("balikTanggungan", () => {
  it("membalik hanya CHARGE transaksi itu yang belum dibalik; dipanggil ulang tidak membalik lagi", async () => {
    const tx = buatTx({
      entri: [
        charge(1),
        charge(2, { debtorUserId: 3 }),
        charge(3, { transactionId: 11 }),
        charge(4),
        { ...charge(5), type: "REVERSAL", sign: -1, reversesEntryId: 4 },
      ],
    });
    const layanan = buatLayananLedger({ db: tx });
    const hasil = await layanan.balikTanggungan(tx, { groupId: 7, transactionId: 10, createdBy: 5 });
    assert.equal(hasil.entryIds.length, 2);
    assert.deepEqual(dibuat(tx).map((c) => c.data.reversesEntryId), [1, 2]);
    const cari = tx.log.find((l) => l.nama === "findMany");
    assert.equal(cari.arg.where.type, "CHARGE");
    assert.deepEqual(cari.arg.where.reversedBy, { none: {} });
    const lagi = await layanan.balikTanggungan(tx, { groupId: 7, transactionId: 10, createdBy: 5 });
    assert.deepEqual(lagi, { entryIds: [] });
    assert.equal(dibuat(tx).length, 2);
  });

  it("argumen tak sah ditolak", async () => {
    const tx = buatTx();
    await assert.rejects(() => buatLayananLedger({ db: tx }).balikTanggungan(tx, { groupId: 0, transactionId: 10, createdBy: 5 }), /ledger:/);
  });
});

describe("pembacaan saldo", () => {
  const entri = [
    { id: 1, groupId: 7, type: "CHARGE", sign: 1, amount: 50000n, debtorUserId: 1, creditorUserId: 2, category: "GROUP", transactionId: 10 },
    { id: 2, groupId: 7, type: "CHARGE", sign: 1, amount: 20000n, debtorUserId: 2, creditorUserId: 1, category: "GROUP", transactionId: 11 },
    { id: 3, groupId: 8, type: "CHARGE", sign: 1, amount: 99999n, debtorUserId: 1, creditorUserId: 3, category: "GROUP", transactionId: 20 },
  ];

  it("ringkasan, rincian, dan saldoPasangan hanya membaca entri grup yang diminta", async () => {
    const tx = buatTx({ entri });
    const layanan = buatLayananLedger({ db: tx });
    assert.deepEqual(await layanan.ringkasan(7), [
      { userId: 1, owes: 30000, owed: 0, balance: -30000 },
      { userId: 2, owes: 0, owed: 30000, balance: 30000 },
    ]);
    assert.equal((await layanan.rincian(7, 1)).counterparties[0].amount, 30000);
    assert.equal(await layanan.saldoPasangan(7, 1, 2), 30000);
    assert.equal(await layanan.saldoPasangan(7, 2, 1), -30000);
    assert.equal(await layanan.saldoPasangan(7, 1, 3), 0);
    for (const l of tx.log.filter((x) => x.nama === "findMany")) assert.deepEqual(l.arg.where, { groupId: 7 });
  });
});
