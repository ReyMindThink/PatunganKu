import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatTransaksiSchema, daftarTransaksiQuery, kursorTransaksiSkema, ubahTransaksiSchema } from "../../src/validators/transaksi.validator.js";

const ok = (skema, x) => skema.safeParse(x).success;

describe("buatTransaksiSchema", () => {
  it("deskripsi dipangkas dan mode bawaan EQUAL_ALL; field lain dibuang", () => {
    assert.deepEqual(buatTransaksiSchema.parse({ description: "  Makan  ", amount: 70000, payerId: 9 }), { description: "Makan", amount: 70000, mode: "EQUAL_ALL" });
  });

  it("nominal: bilangan bulat 1 sampai Rp100.000.000; pecahan, nol, negatif, teks, dan di atas batas ditolak", () => {
    assert.equal(ok(buatTransaksiSchema, { description: "x", amount: 1 }), true);
    assert.equal(ok(buatTransaksiSchema, { description: "x", amount: 100000000 }), true);
    for (const buruk of [0, -1, 1.5, 100000001, "70000", null, undefined]) {
      assert.equal(ok(buatTransaksiSchema, { description: "x", amount: buruk }), false, "harus ditolak: " + String(buruk));
    }
  });

  it("deskripsi: 1 sampai 500 karakter setelah dipangkas", () => {
    assert.equal(ok(buatTransaksiSchema, { description: "a".repeat(500), amount: 5 }), true);
    for (const buruk of ["", "   ", "a".repeat(501), 5, null, undefined]) {
      assert.equal(ok(buatTransaksiSchema, { description: buruk, amount: 5 }), false, "harus ditolak: " + String(buruk));
    }
  });

  it("mode selain EQUAL_ALL belum didukung; mode tak dikenal dan participants ditolak", () => {
    for (const m of ["EQUAL_SUBSET", "CUSTOM", "ITEMIZED", "XYZ", ""]) {
      assert.equal(ok(buatTransaksiSchema, { description: "x", amount: 5, mode: m }), false, m);
    }
    const hasil = buatTransaksiSchema.safeParse({ description: "x", amount: 5, mode: "ITEMIZED" });
    assert.ok(hasil.error.issues.some((i) => i.path[0] === "mode" && /belum didukung/.test(i.message)));
    for (const p of [[], [1, 2], null, {}, 0]) {
      assert.equal(ok(buatTransaksiSchema, { description: "x", amount: 5, participants: p }), false, JSON.stringify(p));
    }
  });
});

describe("ubahTransaksiSchema", () => {
  it("minimal satu field; field yang diberi diperiksa dengan aturan yang sama", () => {
    assert.equal(ok(ubahTransaksiSchema, {}), false);
    assert.equal(ok(ubahTransaksiSchema, { status: "ACTIVE" }), false);
    assert.deepEqual(ubahTransaksiSchema.parse({ amount: 5 }), { amount: 5 });
    assert.deepEqual(ubahTransaksiSchema.parse({ description: " a ", mode: "EQUAL_ALL" }), { description: "a", mode: "EQUAL_ALL" });
    assert.equal(ok(ubahTransaksiSchema, { amount: 0 }), false);
    assert.equal(ok(ubahTransaksiSchema, { description: "  " }), false);
    assert.equal(ok(ubahTransaksiSchema, { mode: "CUSTOM" }), false);
    assert.equal(ok(ubahTransaksiSchema, { amount: 5, participants: [] }), false);
  });
});

describe("daftarTransaksiQuery dan kursor", () => {
  it("limit bawaan 20; month YYYY-MM; status dan mode dari daftar tetap; payerId bilangan bulat positif", () => {
    assert.deepEqual(daftarTransaksiQuery.parse({}), { limit: 20 });
    assert.deepEqual(daftarTransaksiQuery.parse({ month: "2026-10", status: "ACTIVE", mode: "CUSTOM", payerId: "3", limit: "5" }), { limit: 5, month: "2026-10", status: "ACTIVE", mode: "CUSTOM", payerId: 3 });
    for (const buruk of [{ month: "2026-13" }, { month: "2026-1" }, { status: "ACTIV" }, { mode: "X" }, { payerId: "0" }, { payerId: "abc" }, { limit: "101" }, { limit: "0" }]) {
      assert.equal(ok(daftarTransaksiQuery, buruk), false, JSON.stringify(buruk));
    }
  });

  it("isi kursor: waktu ISO sah dan id bilangan bulat positif", () => {
    assert.equal(ok(kursorTransaksiSkema, { t: "2026-10-01T00:00:00.000Z", id: 5 }), true);
    for (const buruk of [{ t: "bukan tanggal", id: 5 }, { t: "2026-10-01T00:00:00.000Z", id: 0 }, { t: "2026-10-01T00:00:00.000Z", id: 1.5 }, { t: 5, id: 5 }, {}]) {
      assert.equal(ok(kursorTransaksiSkema, buruk), false, JSON.stringify(buruk));
    }
  });
});
