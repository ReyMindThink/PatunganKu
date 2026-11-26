import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananLedger } from "../../src/services/ledger.js";

// Klien palsu di memori. BUKAN bukti SQL Server (itu dibuktikan tes integrasi pelunasan).
function buatKlien({ bayar = {}, entri = [] } = {}) {
  const s = { bayar: { 801: { groupId: 7, senderId: 2, receiverId: 1, amount: 30000 }, ...bayar }, entri: [...entri] };
  const log = [];
  let nomor = 500;
  return {
    s,
    log,
    paymentConfirmation: { findUnique: async ({ where }) => { log.push("bayar.findUnique"); return s.bayar[where.id] ?? null; } },
    ledgerEntry: {
      findFirst: async ({ where }) => { log.push("entri.findFirst"); return s.entri.find((e) => e.type === where.type && e.paymentId === where.paymentId) ?? null; },
      create: async ({ data }) => { log.push("entri.create"); const baris = { id: nomor++, ...data }; s.entri.push(baris); return { id: baris.id }; },
      findMany: async () => { log.push("entri.findMany"); return s.entri; },
    },
  };
}
const dasar = { groupId: 7, paymentId: 801, pengirimId: 2, penerimaId: 1, jumlah: 30000, createdBy: 1 };
const galatLedger = /ledger: .*harus bilangan bulat positif/;

describe("ledger.catatPelunasan", () => {
  it("menulis satu SETTLEMENT dengan bentuk yang diminta CHECK database dan mengembalikan id-nya", async () => {
    const tx = buatKlien();
    const { catatPelunasan } = buatLayananLedger({ db: {} });
    const hasil = await catatPelunasan(tx, dasar);
    assert.deepEqual(hasil, { entryId: 500 });
    assert.deepEqual(tx.s.entri, [{ id: 500, groupId: 7, type: "SETTLEMENT", sign: -1, amount: 30000n, debtorUserId: 2, creditorUserId: 1, paymentId: 801, createdBy: 1 }]);
    assert.equal(Object.hasOwn(tx.s.entri[0], "transactionId"), false);
    assert.equal(Object.hasOwn(tx.s.entri[0], "category"), false);
    assert.deepEqual(tx.log, ["bayar.findUnique", "entri.findFirst", "entri.create"]);
  });

  it("setiap id wajib bilangan bulat positif", async () => {
    const { catatPelunasan } = buatLayananLedger({ db: {} });
    for (const nama of ["groupId", "paymentId", "pengirimId", "penerimaId", "createdBy"]) {
      for (const buruk of [0, -1, 1.5, "1", null, undefined, NaN]) {
        const tx = buatKlien();
        await assert.rejects(catatPelunasan(tx, { ...dasar, [nama]: buruk }), galatLedger, nama + "=" + String(buruk));
        assert.equal(tx.s.entri.length, 0);
      }
    }
  });

  it("pengirim sama dengan penerima ditolak", async () => {
    const tx = buatKlien({ bayar: { 801: { groupId: 7, senderId: 2, receiverId: 2, amount: 30000 } } });
    await assert.rejects(buatLayananLedger({ db: {} }).catatPelunasan(tx, { ...dasar, penerimaId: 2 }), /tidak boleh sama/);
    assert.equal(tx.s.entri.length, 0);
  });

  it("jumlah harus bilangan bulat aman positif", async () => {
    const { catatPelunasan } = buatLayananLedger({ db: {} });
    for (const buruk of [0, -5, 1.5, "30000", NaN, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
      const tx = buatKlien();
      await assert.rejects(catatPelunasan(tx, { ...dasar, jumlah: buruk }), /jumlah harus/, String(buruk));
      assert.equal(tx.s.entri.length, 0);
    }
  });

  it("pelunasan harus cocok dengan grup, pengirim, penerima, dan nominalnya", async () => {
    const { catatPelunasan } = buatLayananLedger({ db: {} });
    const kasus = [
      { groupId: 8 },
      { pengirimId: 3 },
      { penerimaId: 3 },
      { jumlah: 29999 },
      { jumlah: 30001 },
      { paymentId: 999 },
    ];
    for (const ubah of kasus) {
      const tx = buatKlien();
      await assert.rejects(catatPelunasan(tx, { ...dasar, ...ubah }), /tidak cocok/, JSON.stringify(ubah));
      assert.equal(tx.s.entri.length, 0, JSON.stringify(ubah));
    }
  });

  it("pelunasan yang sudah punya SETTLEMENT tidak dicatat dua kali", async () => {
    const tx = buatKlien();
    const { catatPelunasan } = buatLayananLedger({ db: {} });
    await catatPelunasan(tx, dasar);
    await assert.rejects(catatPelunasan(tx, dasar), /sudah dicatat/);
    assert.equal(tx.s.entri.length, 1);
  });

  it("SETTLEMENT untuk pelunasan lain tidak menghalangi", async () => {
    const tx = buatKlien({ entri: [{ id: 1, groupId: 7, type: "SETTLEMENT", sign: -1, amount: 1n, debtorUserId: 2, creditorUserId: 1, paymentId: 802 }] });
    await buatLayananLedger({ db: {} }).catatPelunasan(tx, dasar);
    assert.equal(tx.s.entri.length, 2);
  });

  it("galat dari database meneruskan galat (tidak ditelan)", async () => {
    const tx = buatKlien();
    tx.ledgerEntry.create = async () => { throw new Error("db gagal"); };
    await assert.rejects(buatLayananLedger({ db: {} }).catatPelunasan(tx, dasar), /db gagal/);
  });
});

describe("ledger.saldoPasangan dengan klien", () => {
  const charge = { id: 1, groupId: 7, type: "CHARGE", sign: 1, amount: 30000n, debtorUserId: 2, creditorUserId: 1, category: "GROUP", transactionId: 10 };
  const dbTerlarang = { ledgerEntry: { findMany: async () => { throw new Error("klien utama tidak boleh dipakai"); } } };

  it("memakai klien yang diberikan, bukan klien utama", async () => {
    const tx = buatKlien({ entri: [charge] });
    const ledger = buatLayananLedger({ db: dbTerlarang });
    assert.equal(await ledger.saldoPasangan(7, 2, 1, tx), 30000);
    assert.equal(await ledger.saldoPasangan(7, 1, 2, tx), -30000);
    assert.deepEqual(tx.log, ["entri.findMany", "entri.findMany"]);
  });

  it("tanpa klien tetap memakai klien utama (perilaku lama)", async () => {
    const db = buatKlien({ entri: [charge] });
    assert.equal(await buatLayananLedger({ db }).saldoPasangan(7, 2, 1), 30000);
    assert.deepEqual(db.log, ["entri.findMany"]);
  });

  it("SETTLEMENT dari catatPelunasan mengurangi saldo pasangan, sebagian maupun seluruhnya", async () => {
    const tx = buatKlien({ entri: [charge], bayar: { 802: { groupId: 7, senderId: 2, receiverId: 1, amount: 10000 } } });
    const ledger = buatLayananLedger({ db: dbTerlarang });
    await ledger.catatPelunasan(tx, { ...dasar, paymentId: 802, jumlah: 10000 });
    assert.equal(await ledger.saldoPasangan(7, 2, 1, tx), 20000);
    // Ledger sendiri tidak membatasi nominal (itu tugas layanan pelunasan): 20000 - 30000 = -10000.
    await ledger.catatPelunasan(tx, dasar);
    assert.equal(await ledger.saldoPasangan(7, 2, 1, tx), -10000);
  });
});
