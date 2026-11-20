import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GRUP } from "../../src/config/constants.js";
import { buatKodeGrup } from "../../src/utils/kodeGrup.js";

describe("buatKodeGrup", () => {
  it("alfabet 32 karakter unik tanpa I, O, 0, 1", () => {
    assert.equal(GRUP.ALFABET_KODE.length, 32);
    assert.equal(new Set(GRUP.ALFABET_KODE).size, 32);
    assert.match(GRUP.ALFABET_KODE, /^[A-HJ-NP-Z2-9]{32}$/);
  });

  it("memanggil pengacak 6 kali dengan argumen 32 dan memetakan indeks ke alfabet", () => {
    const argumen = [];
    const indeks = [0, 1, 2, 3, 4, 31];
    const kode = buatKodeGrup((n) => {
      argumen.push(n);
      return indeks[argumen.length - 1];
    });
    assert.deepEqual(argumen, [32, 32, 32, 32, 32, 32]);
    assert.equal(kode, "ABCDE9");
  });

  it("2000 kode asli selalu 6 karakter sah dan hampir semuanya unik", () => {
    const semua = new Set();
    for (let i = 0; i < 2000; i++) {
      const kode = buatKodeGrup();
      assert.match(kode, /^[A-HJ-NP-Z2-9]{6}$/);
      semua.add(kode);
    }
    assert.ok(semua.size > 1990, "terlalu banyak kode kembar: " + semua.size);
  });
});
