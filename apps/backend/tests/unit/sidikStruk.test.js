import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fingerprintStruk, normalisasiMerchant, sha256Hex } from "../../src/utils/sidikStruk.js";

const waktu = new Date("2026-10-05T05:30:00.000Z");
const dasar = { merchant: "Alfamart Kaliurang", purchasedAt: waktu, total: 70000 };

describe("sha256Hex", () => {
  it("cocok dengan vektor uji baku dan membedakan isi", () => {
    assert.equal(sha256Hex(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.notEqual(sha256Hex(Buffer.from("abc")), sha256Hex(Buffer.from("abd")));
    assert.equal(sha256Hex(Buffer.from("abc")).length, 64);
  });
});

describe("normalisasiMerchant", () => {
  it("huruf kecil, tanpa aksen, simbol, dan spasi; kosong atau bukan teks menjadi null", () => {
    assert.equal(normalisasiMerchant("Alfamart  #123"), "alfamart123");
    assert.equal(normalisasiMerchant("ALFAMART 123"), "alfamart123");
    assert.equal(normalisasiMerchant("Café Ñandú"), "cafenandu");
    for (const buruk of ["", "   ", "###", null, undefined, 5]) assert.equal(normalisasiMerchant(buruk), null, String(buruk));
  });
});

describe("fingerprintStruk (K8)", () => {
  it("sama untuk merchant yang setara dan waktu dalam menit yang sama; berbeda bila menit, total, atau merchant berbeda", () => {
    const f = fingerprintStruk(dasar);
    assert.match(f, /^[0-9a-f]{64}$/);
    assert.equal(fingerprintStruk({ ...dasar, merchant: "ALFAMART  kaliurang" }), f);
    assert.equal(fingerprintStruk({ ...dasar, purchasedAt: new Date(waktu.getTime() + 59000) }), f);
    assert.notEqual(fingerprintStruk({ ...dasar, purchasedAt: new Date(waktu.getTime() + 60000) }), f);
    assert.notEqual(fingerprintStruk({ ...dasar, total: 70001 }), f);
    assert.notEqual(fingerprintStruk({ ...dasar, merchant: "Indomaret Kaliurang" }), f);
  });

  it("null bila merchant, waktu, atau total tidak terbaca atau tidak sah", () => {
    assert.equal(fingerprintStruk({ ...dasar, merchant: null }), null);
    assert.equal(fingerprintStruk({ ...dasar, merchant: "###" }), null);
    assert.equal(fingerprintStruk({ ...dasar, purchasedAt: null }), null);
    assert.equal(fingerprintStruk({ ...dasar, purchasedAt: new Date("tidak valid") }), null);
    assert.equal(fingerprintStruk({ ...dasar, purchasedAt: "2026-10-05T12:30" }), null);
    for (const total of [null, 0, -1, 1.5, "70000", undefined]) assert.equal(fingerprintStruk({ ...dasar, total }), null, String(total));
  });

  it("bidang dipisah: 'a1' + menit 29600000 + total 5 tidak bertabrakan dengan 'a' + menit 129600000 + total 5", () => {
    const a = { merchant: "a1", purchasedAt: new Date(29600000 * 60000), total: 5 };
    const b = { merchant: "a", purchasedAt: new Date(129600000 * 60000), total: 5 };
    assert.notEqual(fingerprintStruk(a), fingerprintStruk(b));
  });
});
