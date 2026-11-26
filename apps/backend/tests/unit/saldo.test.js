import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ringkasanSaldo, rincianSaldo, saldoPasangan } from "../../src/utils/saldo.js";

const charge = (d, c, amt, category = "GROUP") => ({ type: "CHARGE", sign: 1, amount: BigInt(amt), debtorUserId: d, creditorUserId: c, category });
const reversal = (d, c, amt, category = "GROUP") => ({ ...charge(d, c, amt, category), type: "REVERSAL", sign: -1 });
const settlement = (d, c, amt) => ({ type: "SETTLEMENT", sign: -1, amount: BigInt(amt), debtorUserId: d, creditorUserId: c, category: null });

function pengacak(benih) {
  let a = benih;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("saldoPasangan (K25)", () => {
  it("A menanggung Rp50.000 ke B, B menanggung Rp20.000 ke A: saldo Rp30.000; pelunasan Rp30.000 menjadi nol", () => {
    const entri = [charge(1, 2, 50000), charge(2, 1, 20000)];
    assert.equal(saldoPasangan(entri, 1, 2), 30000);
    assert.equal(saldoPasangan(entri, 2, 1), -30000);
    const lunas = [...entri, settlement(1, 2, 30000)];
    assert.equal(saldoPasangan(lunas, 1, 2), 0);
    assert.equal(saldoPasangan(lunas, 2, 1), 0);
  });

  it("takedown setelah lunas menjadi kredit, dan pembayaran balik B ke A mengembalikannya ke nol", () => {
    const entri = [charge(1, 2, 50000), settlement(1, 2, 50000), reversal(1, 2, 50000)];
    assert.equal(saldoPasangan(entri, 1, 2), -50000);
    const ringkas = ringkasanSaldo(entri);
    assert.deepEqual(ringkas.map((r) => [r.userId, r.balance]), [[1, 50000], [2, -50000]]);
    assert.equal(saldoPasangan([...entri, settlement(2, 1, 50000)], 1, 2), 0);
  });

  it("pasangan tanpa entri bernilai nol dan pasangan dengan diri sendiri ditolak", () => {
    assert.equal(saldoPasangan([], 1, 2), 0);
    assert.equal(saldoPasangan([charge(3, 4, 100)], 1, 2), 0);
    assert.throws(() => saldoPasangan([], 1, 1), /dua pengguna berbeda/);
  });
});

describe("ringkasanSaldo", () => {
  it("contoh api-contract 10.2: owes, owed, balance, urut userId, jumlah balance nol", () => {
    const entri = [charge(1, 2, 30000), charge(3, 1, 5000), charge(2, 3, 10000)];
    assert.deepEqual(ringkasanSaldo(entri), [
      { userId: 1, owes: 30000, owed: 5000, balance: -25000 },
      { userId: 2, owes: 10000, owed: 30000, balance: 20000 },
      { userId: 3, owes: 5000, owed: 10000, balance: 5000 },
    ]);
  });

  it("urut userId menaik walau entri pertama memuat id besar", () => {
    const ringkas = ringkasanSaldo([charge(5, 3, 1000), charge(2, 1, 500)]);
    assert.deepEqual(ringkas.map((r) => r.userId), [1, 2, 3, 5]);
  });

  it("tanpa entri: daftar kosong", () => {
    assert.deepEqual(ringkasanSaldo([]), []);
  });

  it("acak: jumlah balance grup nol, owes = owed, N(a,b) = minus N(b,a), rincian cocok dengan ringkasan", () => {
    const acak = pengacak(99);
    const antara = (a, b) => a + Math.floor(acak() * (b - a + 1));
    const entri = [];
    const belumDibalik = [];
    for (let i = 0; i < 300; i++) {
      const d = antara(1, 6);
      let c = antara(1, 6);
      if (c === d) c = (d % 6) + 1;
      const jenis = antara(1, 10);
      if (jenis <= 6) {
        const e = charge(d, c, antara(1, 100000), antara(0, 1) === 0 ? "GROUP" : "INDIVIDUAL");
        entri.push(e);
        belumDibalik.push(e);
      } else if (jenis <= 8 && belumDibalik.length > 0) {
        const e = belumDibalik.splice(antara(0, belumDibalik.length - 1), 1)[0];
        entri.push(reversal(e.debtorUserId, e.creditorUserId, e.amount, e.category));
      } else {
        entri.push(settlement(d, c, antara(1, 50000)));
      }
    }
    const ringkas = ringkasanSaldo(entri);
    assert.equal(ringkas.reduce((s, r) => s + r.balance, 0), 0);
    assert.equal(ringkas.reduce((s, r) => s + r.owes, 0), ringkas.reduce((s, r) => s + r.owed, 0));
    for (let a = 1; a <= 6; a++) {
      for (let b = a + 1; b <= 6; b++) assert.equal(saldoPasangan(entri, a, b), -saldoPasangan(entri, b, a));
      const r = rincianSaldo(entri, a);
      const dalam = ringkas.find((x) => x.userId === a);
      assert.equal(r.owes, dalam ? dalam.owes : 0);
      assert.equal(r.owed, dalam ? dalam.owed : 0);
    }
  });

  it("jumlah melebihi bilangan bulat aman ditolak, bukan dibulatkan diam-diam", () => {
    assert.throws(() => ringkasanSaldo([charge(1, 2, 2n ** 60n)]), /aman/);
  });
});

describe("rincianSaldo", () => {
  it("breakdown dari sudut pandang X: group, individual, settled; pihak nol dibuang; urut amount terbesar", () => {
    const entri = [
      charge(1, 2, 10000, "GROUP"),
      charge(1, 2, 40000, "INDIVIDUAL"),
      settlement(1, 2, 20000),
      charge(3, 1, 5000, "GROUP"),
      charge(1, 4, 8000, "GROUP"),
      settlement(4, 1, 3000),
      charge(1, 5, 1000, "GROUP"),
      settlement(1, 5, 1000),
    ];
    assert.deepEqual(rincianSaldo(entri, 1), {
      userId: 1,
      owes: 41000,
      owed: 5000,
      counterparties: [
        { userId: 2, amount: 30000, direction: "X_OWES", breakdown: { group: 10000, individual: 40000, settled: -20000 } },
        { userId: 4, amount: 11000, direction: "X_OWES", breakdown: { group: 8000, individual: 0, settled: 3000 } },
        { userId: 3, amount: 5000, direction: "X_IS_OWED", breakdown: { group: -5000, individual: 0, settled: 0 } },
      ],
    });
  });

  it("amount sama besar: pihak lawan dengan userId lebih kecil lebih dulu", () => {
    const r = rincianSaldo([charge(1, 9, 5000), charge(1, 4, 5000), charge(7, 1, 5000)], 1);
    assert.deepEqual(r.counterparties.map((c) => [c.userId, c.direction]), [[4, "X_OWES"], [9, "X_OWES"], [7, "X_IS_OWED"]].sort((a, b) => a[0] - b[0]));
  });

  it("dilihat dari pihak lawan, arah dan tanda breakdown berbalik", () => {
    const r = rincianSaldo([charge(1, 2, 10000, "GROUP"), settlement(1, 2, 4000)], 2);
    assert.deepEqual(r.counterparties, [
      { userId: 1, amount: 6000, direction: "X_IS_OWED", breakdown: { group: -10000, individual: 0, settled: 4000 } },
    ]);
    assert.equal(r.owed, 6000);
    assert.equal(r.owes, 0);
  });

  it("pengguna tanpa entri: nol dan tanpa pihak lawan", () => {
    assert.deepEqual(rincianSaldo([charge(1, 2, 100)], 9), { userId: 9, owes: 0, owed: 0, counterparties: [] });
  });
});

describe("entri tak sah", () => {
  it("ditolak sebagai kesalahan pemrogram", () => {
    assert.throws(() => ringkasanSaldo([{ ...charge(1, 2, 100), amount: 0n }]), /positif/);
    assert.throws(() => ringkasanSaldo([charge(1, 1, 100)]), /sama dengan kreditur/);
    assert.throws(() => ringkasanSaldo([{ ...charge(1, 2, 100), type: "REFUND" }]), /type atau sign/);
    assert.throws(() => ringkasanSaldo([{ ...charge(1, 2, 100), sign: 2 }]), /type atau sign/);
    assert.throws(() => ringkasanSaldo([{ ...charge(1, 2, 100), category: null }]), /category/);
    assert.throws(() => ringkasanSaldo([{ ...charge(1, 2, 100), debtorUserId: null }]), /pengguna/);
  });
});
