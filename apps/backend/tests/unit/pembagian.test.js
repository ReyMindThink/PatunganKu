import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bagiMerata, bagiProporsional } from "../../src/utils/pembagian.js";

// Pengacak berbenih (mulberry32) supaya tes acak dapat diulang persis.
function pengacak(benih) {
  let a = benih;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const antara = (acak, a, b) => a + Math.floor(acak() * (b - a + 1));
const jumlah = (daftar) => daftar.reduce((s, x) => s + x.amount, 0);

describe("bagiMerata", () => {
  it("contoh Rp70.000 untuk tiga peserta: 23.334, 23.333, 23.333 dan urut userId menaik", () => {
    assert.deepEqual(bagiMerata(70000, [3, 1, 2]), [
      { userId: 1, amount: 23334 },
      { userId: 2, amount: 23333 },
      { userId: 3, amount: 23333 },
    ]);
  });

  it("sisa rupiah diberikan ke userId terkecil lebih dulu", () => {
    assert.deepEqual(bagiMerata(10, [5, 9, 7, 2]).map((b) => [b.userId, b.amount]), [[2, 3], [5, 3], [7, 2], [9, 2]]);
  });

  it("total lebih kecil dari jumlah peserta: sebagian mendapat nol", () => {
    assert.deepEqual(bagiMerata(2, [1, 2, 3]).map((b) => b.amount), [1, 1, 0]);
    assert.deepEqual(bagiMerata(0, [1, 2]).map((b) => b.amount), [0, 0]);
  });

  it("total Number dan BigInt menghasilkan bagian yang sama", () => {
    assert.deepEqual(bagiMerata(70000n, [1, 2, 3]), bagiMerata(70000, [1, 2, 3]));
  });

  it("acak 500 kali: jumlah bagian = total, selisih antar orang maksimal Rp1, bagian lebih besar di userId kecil", () => {
    const acak = pengacak(20261103);
    for (let putaran = 0; putaran < 500; putaran++) {
      const total = antara(acak, 0, 100_000_000);
      const n = antara(acak, 1, 50);
      const ids = new Set();
      while (ids.size < n) ids.add(antara(acak, 1, 5000));
      const hasil = bagiMerata(total, [...ids]);
      assert.equal(hasil.length, n);
      assert.equal(jumlah(hasil), total, "jumlah total putaran " + putaran);
      const nilai = hasil.map((b) => b.amount);
      assert.ok(Math.max(...nilai) - Math.min(...nilai) <= 1, "selisih lebih dari 1 pada putaran " + putaran);
      for (let i = 1; i < hasil.length; i++) {
        assert.ok(hasil[i - 1].userId < hasil[i].userId, "urutan userId");
        assert.ok(hasil[i - 1].amount >= hasil[i].amount, "sisa harus ke userId yang lebih kecil");
      }
    }
  });
});

describe("bagiProporsional", () => {
  it("bobot 1:2:3 dari 100: sisa ke pecahan terbesar", () => {
    assert.deepEqual(bagiProporsional(100, [{ id: 1, bobot: 1 }, { id: 2, bobot: 2 }, { id: 3, bobot: 3 }]), [
      { id: 1, amount: 17 },
      { id: 2, amount: 33 },
      { id: 3, amount: 50 },
    ]);
  });

  it("pecahan sama besar: id terkecil mendapat sisa, apa pun urutan masukan", () => {
    assert.deepEqual(bagiProporsional(3, [{ id: 2, bobot: 1 }, { id: 1, bobot: 1 }]), [{ id: 1, amount: 2 }, { id: 2, amount: 1 }]);
  });

  it("bobot nol tidak mendapat bagian", () => {
    assert.deepEqual(bagiProporsional(100, [{ id: 1, bobot: 0 }, { id: 2, bobot: 3 }]), [{ id: 1, amount: 0 }, { id: 2, amount: 100 }]);
  });

  it("hasil kali melewati bilangan bulat aman tetap tepat (BigInt) dan acak 300 kali", () => {
    const uji = (total, bobot) => {
      const hasil = bagiProporsional(total, bobot.map((w, i) => ({ id: i + 1, bobot: w })));
      assert.equal(jumlah(hasil), total);
      const S = bobot.reduce((s, w) => s + BigInt(w), 0n);
      hasil.forEach((b, i) => {
        const dasar = Number((BigInt(total) * BigInt(bobot[i])) / S);
        assert.ok(b.amount === dasar || b.amount === dasar + 1, "di luar floor atau floor+1");
      });
    };
    uji(100_000_000, [99_999_999, 99_999_999, 2]);
    const acak = pengacak(7);
    for (let i = 0; i < 300; i++) {
      const n = antara(acak, 1, 12);
      const bobot = Array.from({ length: n }, () => antara(acak, 0, 100_000_000));
      if (bobot.every((w) => w === 0)) bobot[0] = 1;
      uji(antara(acak, 0, 100_000_000), bobot);
    }
  });

  it("input tak sah dianggap kesalahan pemrogram", () => {
    const b = [{ id: 1, bobot: 1 }];
    assert.throws(() => bagiProporsional(100, []), /kosong/);
    assert.throws(() => bagiProporsional(100, [{ id: 1, bobot: 1 }, { id: 1, bobot: 2 }]), /kembar/);
    assert.throws(() => bagiProporsional(100, [{ id: 0, bobot: 1 }]), /id/);
    assert.throws(() => bagiProporsional(100, [{ id: 1, bobot: -1 }]), /bobot/);
    assert.throws(() => bagiProporsional(100, [{ id: 1, bobot: 1.5 }]), /bobot/);
    assert.throws(() => bagiProporsional(100, [{ id: 1, bobot: 0 }]), /lebih dari nol/);
    assert.throws(() => bagiProporsional(-1, b), /total/);
    assert.throws(() => bagiProporsional(-1n, b), /total/);
    assert.throws(() => bagiProporsional(100, [{ id: 1, bobot: -5n }]), /bobot/);
    assert.throws(() => bagiProporsional(10.5, b), /total/);
    assert.throws(() => bagiProporsional(2n ** 60n, b), /terlalu besar/);
    assert.throws(() => bagiMerata(100, "abc"), /daftar/);
    assert.throws(() => bagiMerata(100, [1, 1]), /kembar/);
  });
});
