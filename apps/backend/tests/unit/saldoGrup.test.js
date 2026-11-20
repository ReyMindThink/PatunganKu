import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananSaldo } from "../../src/services/saldoGrup.js";

// db palsu di memori yang mencatat panggilan; ledger yang dipakai adalah layanan asli di atasnya.
// BUKAN bukti SQL Server.
const anggotaAwal = [
  { userId: 1, status: "ACTIVE", user: { name: "Aqi" } },
  { userId: 2, status: "ACTIVE", user: { name: "Bintang" } },
  { userId: 3, status: "LEFT", user: { name: "Citra" } },
  { userId: 4, status: "ACTIVE", user: { name: "Dewi" } },
  { userId: 5, status: "REMOVED", user: { name: "Eko" } },
];
const charge = (debtorUserId, creditorUserId, amount, ubah = {}) => ({ groupId: 7, type: "CHARGE", sign: 1, amount: BigInt(amount), debtorUserId, creditorUserId, category: "GROUP", ...ubah });
// K25: user 1 menanggung 50.000 untuk user 2, user 2 menanggung 20.000 untuk user 1 (user 2 berutang 30.000 kepada user 1).
const k25 = [charge(2, 1, 50000), charge(1, 2, 20000)];

function buatDb({ anggota = anggotaAwal, entri = [], pending = [], keanggotaan = [] } = {}) {
  const log = [];
  const catat = (nama, arg) => log.push({ nama, arg });
  const db = {
    log,
    groupMember: {
      findMany: async (arg) => {
        catat("groupMember.findMany", arg);
        return arg.where.userId === undefined ? anggota : keanggotaan;
      },
    },
    ledgerEntry: {
      findMany: async (arg) => {
        catat("ledgerEntry.findMany", arg);
        const g = arg.where.groupId;
        return entri.filter((e) => (typeof g === "number" ? e.groupId === g : g.in.includes(e.groupId)));
      },
    },
    paymentConfirmation: { findMany: async (arg) => { catat("paymentConfirmation.findMany", arg); return pending; } },
  };
  return db;
}
const layananDari = (db) => buatLayananSaldo({ db, ledger: buatLayananLedger({ db }) });
const nama = (db) => db.log.map((l) => l.nama);
const ambil = (db, n) => db.log.filter((l) => l.nama === n);
const galat = (status, code) => (e) => e.status === status && e.code === code;
const aktif = { userId: 1, groupId: 7, role: "OWNER", status: "ACTIVE" };
const pihak = (id, name, membership = "ACTIVE") => ({ kind: "USER", id, name, membership });

describe("saldo: ringkasan grup", () => {
  it("anggota ACTIVE: semua anggota ACTIVE (termasuk saldo nol) dan mantan anggota yang masih bersaldo; urut userId; berjumlah nol", async () => {
    const db = buatDb({ entri: [...k25, charge(3, 1, 10000)] });
    const hasil = await layananDari(db).ringkasanGrup(aktif);
    assert.deepEqual(hasil, {
      members: [
        { party: pihak(1, "Aqi"), owes: 0, owed: 40000, balance: 40000 },
        { party: pihak(2, "Bintang"), owes: 30000, owed: 0, balance: -30000 },
        { party: pihak(3, "Citra", "LEFT"), owes: 10000, owed: 0, balance: -10000 },
        { party: pihak(4, "Dewi"), owes: 0, owed: 0, balance: 0 },
      ],
    });
    assert.equal(hasil.members.reduce((t, m) => t + m.balance, 0), 0);
  });

  it("mantan anggota tanpa saldo (REMOVED) tidak muncul; kueri anggota urut userId dan hanya milik grup itu", async () => {
    const db = buatDb({ entri: k25 });
    const hasil = await layananDari(db).ringkasanGrup(aktif);
    assert.deepEqual(hasil.members.map((m) => m.party.id), [1, 2, 4]);
    assert.deepEqual(ambil(db, "groupMember.findMany")[0].arg.where, { groupId: 7 });
    assert.deepEqual(ambil(db, "groupMember.findMany")[0].arg.orderBy, { userId: "asc" });
    assert.deepEqual(ambil(db, "ledgerEntry.findMany")[0].arg.where, { groupId: 7 });
  });

  it("mantan anggota (LEFT atau REMOVED) hanya melihat barisnya sendiri, juga bila saldonya nol", async () => {
    const db = buatDb({ entri: [...k25, charge(3, 1, 10000)] });
    const kiri = await layananDari(db).ringkasanGrup({ userId: 3, groupId: 7, role: "MEMBER", status: "LEFT" });
    assert.deepEqual(kiri, { members: [{ party: pihak(3, "Citra", "LEFT"), owes: 10000, owed: 0, balance: -10000 }] });
    const dihapus = await layananDari(buatDb({ entri: k25 })).ringkasanGrup({ userId: 5, groupId: 7, role: "MEMBER", status: "REMOVED" });
    assert.deepEqual(dihapus, { members: [{ party: pihak(5, "Eko", "REMOVED"), owes: 0, owed: 0, balance: 0 }] });
  });

  it("grup tanpa ledger sama sekali: semua anggota ACTIVE bersaldo nol", async () => {
    const hasil = await layananDari(buatDb()).ringkasanGrup(aktif);
    assert.deepEqual(hasil.members.map((m) => [m.party.id, m.owes, m.owed, m.balance]), [[1, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0]]);
  });
});

describe("saldo: rincian satu anggota", () => {
  const dua = { userId: 2, groupId: 7, role: "MEMBER", status: "ACTIVE" };

  it("pemanggil sendiri: arah, breakdown, pelunasan PENDING dijumlah per penerima, payable = amount dikurangi pending; urut amount terbesar", async () => {
    const db = buatDb({ entri: [...k25, charge(4, 2, 5000)], pending: [{ receiverId: 1, amount: 4000 }, { receiverId: 1, amount: 6000 }] });
    const hasil = await layananDari(db).rincian(dua, 2);
    assert.deepEqual(hasil, {
      party: pihak(2, "Bintang"),
      owes: 30000,
      owed: 5000,
      counterparties: [
        { party: pihak(1, "Aqi"), amount: 30000, direction: "X_OWES", breakdown: { group: 30000, individual: 0, settled: 0 }, pendingPayments: 10000, payable: 20000 },
        { party: pihak(4, "Dewi"), amount: 5000, direction: "X_IS_OWED", breakdown: { group: -5000, individual: 0, settled: 0 }, pendingPayments: 0, payable: 0 },
      ],
    });
    assert.deepEqual(ambil(db, "paymentConfirmation.findMany")[0].arg.where, { groupId: 7, senderId: 2, status: "PENDING" });
  });

  it("pelunasan PENDING melebihi utang: payable tidak pernah negatif", async () => {
    const db = buatDb({ entri: k25, pending: [{ receiverId: 1, amount: 40000 }] });
    const hasil = await layananDari(db).rincian(dua, 2);
    assert.deepEqual([hasil.counterparties[0].pendingPayments, hasil.counterparties[0].payable], [40000, 0]);
  });

  it("pelunasan PENDING ke pihak lain tidak mengurangi payable pihak ini", async () => {
    const db = buatDb({ entri: k25, pending: [{ receiverId: 4, amount: 9000 }] });
    const hasil = await layananDari(db).rincian(dua, 2);
    assert.deepEqual([hasil.counterparties[0].pendingPayments, hasil.counterparties[0].payable], [0, 30000]);
  });

  it("melihat anggota lain: pendingPayments dan payable null dan tabel pelunasan tidak dibaca", async () => {
    const db = buatDb({ entri: k25, pending: [{ receiverId: 1, amount: 10000 }] });
    const hasil = await layananDari(db).rincian(aktif, 2);
    assert.equal(hasil.party.id, 2);
    assert.deepEqual([hasil.counterparties[0].pendingPayments, hasil.counterparties[0].payable], [null, null]);
    assert.equal(ambil(db, "paymentConfirmation.findMany").length, 0);
  });

  it("sudut pandang pihak lawan: arah dan tanda breakdown terbalik; jumlah group, individual, dan settled menghasilkan amount", async () => {
    const hasil = await layananDari(buatDb({ entri: k25 })).rincian(aktif, 1);
    assert.deepEqual(hasil.counterparties, [
      { party: pihak(2, "Bintang"), amount: 30000, direction: "X_IS_OWED", breakdown: { group: -30000, individual: 0, settled: 0 }, pendingPayments: 0, payable: 0 },
    ]);
    assert.deepEqual([hasil.owes, hasil.owed], [0, 30000]);
  });

  it("anggota tanpa catatan ledger: owes dan owed nol, tanpa counterparties", async () => {
    const hasil = await layananDari(buatDb({ entri: k25 })).rincian(aktif, 4);
    assert.deepEqual(hasil, { party: pihak(4, "Dewi"), owes: 0, owed: 0, counterparties: [] });
  });

  it("mantan anggota melihat rincian dirinya sendiri; untuk orang lain 403 tanpa membaca apa pun", async () => {
    const kiri = { userId: 3, groupId: 7, role: "MEMBER", status: "LEFT" };
    const db = buatDb({ entri: [charge(3, 1, 10000)] });
    const sendiri = await layananDari(db).rincian(kiri, 3);
    assert.deepEqual([sendiri.party.membership, sendiri.owes, sendiri.counterparties[0].payable], ["LEFT", 10000, 10000]);
    const lain = buatDb({ entri: k25 });
    await assert.rejects(() => layananDari(lain).rincian(kiri, 1), galat(403, "forbidden"));
    assert.deepEqual(lain.log, []);
  });

  it("target bukan anggota grup: 404", async () => {
    await assert.rejects(() => layananDari(buatDb({ entri: k25 })).rincian(aktif, 99), galat(404, "not-found"));
  });

  it("fund: 400 validation-failed dengan field userId, tanpa membaca apa pun", async () => {
    const db = buatDb({ entri: k25 });
    await assert.rejects(() => layananDari(db).rincian(aktif, "fund"), (e) => e.status === 400 && e.code === "validation-failed" && e.errors[0].field === "userId" && /belum didukung/.test(e.errors[0].message));
    assert.deepEqual(db.log, []);
  });

  it("pihak lawan di ledger yang bukan anggota grup adalah galat pemrogram (bukan 500 senyap)", async () => {
    const db = buatDb({ entri: [charge(99, 1, 10000)] });
    await assert.rejects(() => layananDari(db).rincian(aktif, 1), /pihak lawan bukan anggota grup/);
  });
});

describe("saldo: ringkasan saya lintas grup", () => {
  const grup = (id, status) => ({ groupId: id, status, group: { id, name: "Grup " + id } });

  it("grup ACTIVE selalu tampil (juga saldo nol), mantan hanya bila masih bersaldo; totals menjumlahkan; satu kueri ledger", async () => {
    const db = buatDb({
      keanggotaan: [grup(9, "ACTIVE"), grup(8, "LEFT"), grup(7, "REMOVED"), grup(6, "ACTIVE")],
      entri: [
        charge(1, 2, 12000, { groupId: 8 }),
        charge(2, 1, 5000, { groupId: 6 }),
        charge(3, 4, 100, { groupId: 7 }),
      ],
    });
    const hasil = await layananDari(db).ringkasanSaya(1);
    assert.deepEqual(hasil, {
      totals: { owes: 12000, owed: 5000, balance: -7000 },
      groups: [
        { group: { id: 9, name: "Grup 9" }, owes: 0, owed: 0, balance: 0 },
        { group: { id: 8, name: "Grup 8" }, owes: 12000, owed: 0, balance: -12000 },
        { group: { id: 6, name: "Grup 6" }, owes: 0, owed: 5000, balance: 5000 },
      ],
    });
    assert.deepEqual(ambil(db, "groupMember.findMany")[0].arg.where, { userId: 1 });
    assert.deepEqual(ambil(db, "groupMember.findMany")[0].arg.orderBy, { groupId: "desc" });
    assert.equal(ambil(db, "ledgerEntry.findMany").length, 1);
    assert.deepEqual(ambil(db, "ledgerEntry.findMany")[0].arg.where, { groupId: { in: [9, 8, 7, 6] } });
  });

  it("tanpa keanggotaan: nol dan tanpa kueri ledger", async () => {
    const db = buatDb();
    assert.deepEqual(await layananDari(db).ringkasanSaya(1), { totals: { owes: 0, owed: 0, balance: 0 }, groups: [] });
    assert.equal(ambil(db, "ledgerEntry.findMany").length, 0);
  });
});

describe("ledger.ringkasanPerGrup", () => {
  it("memisahkan entri per grup dalam satu kueri; grup tanpa entri memberi daftar kosong", async () => {
    const db = buatDb({ entri: [charge(2, 1, 5000, { groupId: 3 }), charge(1, 2, 700, { groupId: 4 })] });
    const hasil = await buatLayananLedger({ db }).ringkasanPerGrup([3, 4, 5]);
    assert.deepEqual([...hasil.keys()], [3, 4, 5]);
    assert.deepEqual(hasil.get(3), [{ userId: 1, owes: 0, owed: 5000, balance: 5000 }, { userId: 2, owes: 5000, owed: 0, balance: -5000 }]);
    assert.deepEqual(hasil.get(4), [{ userId: 1, owes: 700, owed: 0, balance: -700 }, { userId: 2, owes: 0, owed: 700, balance: 700 }]);
    assert.deepEqual(hasil.get(5), []);
    assert.equal(ambil(db, "ledgerEntry.findMany").length, 1);
  });

  it("daftar kosong: Map kosong tanpa kueri; id tidak sah ditolak sebelum kueri", async () => {
    const db = buatDb();
    assert.equal((await buatLayananLedger({ db }).ringkasanPerGrup([])).size, 0);
    for (const id of [0, -1, 1.5, "7", NaN, null]) await assert.rejects(() => buatLayananLedger({ db }).ringkasanPerGrup([3, id]), /groupId tidak sah/);
    assert.equal(ambil(db, "ledgerEntry.findMany").length, 0);
  });
});
