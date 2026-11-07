import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatGrupSchema, gabungSchema } from "../../src/validators/grup.validator.js";

describe("buatGrupSchema", () => {
  it("name dipangkas; kosong, spasi, dan bukan teks ditolak; 100 diterima, 101 ditolak; field lain dibuang", () => {
    assert.deepEqual(buatGrupSchema.parse({ name: "  Kos Putra  ", role: "OWNER" }), { name: "Kos Putra" });
    for (const buruk of ["", "   ", 5, null, undefined]) {
      assert.equal(buatGrupSchema.safeParse({ name: buruk }).success, false, "harus ditolak: " + String(buruk));
    }
    assert.equal(buatGrupSchema.safeParse({ name: "a".repeat(100) }).success, true);
    assert.equal(buatGrupSchema.safeParse({ name: "a".repeat(101) }).success, false);
  });
});

describe("gabungSchema", () => {
  it("code dipangkas dan huruf besar; kosong dan bukan teks ditolak; 20 diterima, 21 ditolak", () => {
    assert.deepEqual(gabungSchema.parse({ code: "  ab12cd " }), { code: "AB12CD" });
    for (const buruk of ["", "   ", 5, null, undefined]) {
      assert.equal(gabungSchema.safeParse({ code: buruk }).success, false, "harus ditolak: " + String(buruk));
    }
    assert.equal(gabungSchema.safeParse({ code: "A".repeat(20) }).success, true);
    assert.equal(gabungSchema.safeParse({ code: "A".repeat(21) }).success, false);
  });
});
