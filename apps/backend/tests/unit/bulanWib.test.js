import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rentangBulanWib } from "../../src/utils/bulanWib.js";

describe("rentangBulanWib (K24)", () => {
  it("Oktober 2026 menurut WIB dimulai 30 September 17:00 UTC dan berakhir 31 Oktober 17:00 UTC", () => {
    const { dari, sampai } = rentangBulanWib("2026-10");
    assert.equal(dari.toISOString(), "2026-09-30T17:00:00.000Z");
    assert.equal(sampai.toISOString(), "2026-10-31T17:00:00.000Z");
  });

  it("Desember berakhir di awal Januari tahun berikutnya; Januari dimulai di akhir Desember tahun sebelumnya", () => {
    assert.equal(rentangBulanWib("2026-12").sampai.toISOString(), "2026-12-31T17:00:00.000Z");
    assert.equal(rentangBulanWib("2027-01").dari.toISOString(), "2026-12-31T17:00:00.000Z");
  });

  it("bulan berurutan saling menyambung tanpa celah atau tumpang tindih", () => {
    for (let b = 1; b < 12; b++) {
      const a = String(b).padStart(2, "0");
      const c = String(b + 1).padStart(2, "0");
      assert.equal(rentangBulanWib("2026-" + a).sampai.getTime(), rentangBulanWib("2026-" + c).dari.getTime());
    }
  });

  it("format tak sah ditolak sebagai kesalahan pemrogram", () => {
    for (const buruk of ["2026-13", "2026-00", "2026-1", "26-10", "1999-10", "2026/10", "", null, undefined, 202610]) {
      assert.throws(() => rentangBulanWib(buruk), /format/);
    }
  });
});
