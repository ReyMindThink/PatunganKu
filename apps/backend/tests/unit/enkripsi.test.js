import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { bacaKunci, buatEnkripsi } from "../../src/utils/enkripsi.js";

const KUNCI = Buffer.alloc(32, 7).toString("base64");
const KUNCI_LAIN = Buffer.alloc(32, 9).toString("base64");

describe("bacaKunci", () => {
  it("menerima base64 baku dari tepat 32 byte dan mengembalikan Buffer-nya", () => {
    const b = bacaKunci(KUNCI);
    assert.equal(Buffer.isBuffer(b), true);
    assert.equal(b.length, 32);
    assert.equal(b.toString("base64"), KUNCI);
  });

  it("menolak panjang salah, karakter di luar abjad, spasi, dan bukan string", () => {
    const salah = [
      Buffer.alloc(31, 1).toString("base64"),
      Buffer.alloc(33, 1).toString("base64"),
      Buffer.alloc(16, 1).toString("base64"),
      "",
      " " + KUNCI,
      KUNCI + " ",
      KUNCI.replace("=", ""),
      KUNCI.slice(0, 10) + "-" + KUNCI.slice(11),
      KUNCI.slice(0, 43) + "A",
      undefined,
      null,
      42,
      {},
    ];
    for (const s of salah) assert.equal(bacaKunci(s), null, String(s));
  });

  it("menolak base64 yang tidak baku (bit sisa tidak nol) walau panjangnya 32 byte", () => {
    // Karakter ke-43 pada base64 baku punya dua bit akhir bernilai nol; "B" bernilai satu sehingga tidak baku.
    const tidakBaku = KUNCI.slice(0, 42) + "B=";
    assert.equal(Buffer.from(tidakBaku, "base64").length, 32);
    assert.equal(bacaKunci(tidakBaku), null);
  });
});

describe("buatEnkripsi: pembuatan", () => {
  it("kunci yang diberi tetapi tidak sah melempar, kunci kosong tidak", () => {
    assert.throws(() => buatEnkripsi({ kunci: "pendek" }), /32 byte/);
    assert.throws(() => buatEnkripsi({ kunci: 123 }), /32 byte/);
    assert.throws(() => buatEnkripsi({ kunci: "" }), /32 byte/);
    for (const arg of [undefined, {}, { kunci: undefined }, { kunci: null }]) {
      assert.equal(typeof buatEnkripsi(arg).enkripsi, "function");
    }
  });

  it("tanpa kunci semua aksi melempar galat konfigurasi tanpa membocorkan apa pun", () => {
    const e = buatEnkripsi({});
    assert.throws(() => e.pastikan(), /PAYMENT_ENC_KEY belum diisi/);
    assert.throws(() => e.enkripsi("081234567890"), /PAYMENT_ENC_KEY belum diisi/);
    assert.throws(() => e.dekripsi("v1.a.b.c"), /PAYMENT_ENC_KEY belum diisi/);
  });

  it("dengan kunci, pastikan tidak melempar", () => {
    assert.doesNotThrow(() => buatEnkripsi({ kunci: KUNCI }).pastikan());
  });
});

describe("enkripsi dan dekripsi", () => {
  const e = buatEnkripsi({ kunci: KUNCI });

  it("bolak-balik mengembalikan teks asli, termasuk Unicode dan teks kosong", () => {
    for (const t of ["081234567890", "1234567890123456", "", "rekening Dana ðŸ˜€ é"]) {
      assert.equal(e.dekripsi(e.enkripsi(t, "PaymentMethod:5"), "PaymentMethod:5"), t);
    }
  });

  it("format v1 dengan empat bagian dan tidak memuat teks asli", () => {
    const s = e.enkripsi("081234567890", "x");
    const bagian = s.split(".");
    assert.equal(bagian.length, 4);
    assert.equal(bagian[0], "v1");
    assert.equal(Buffer.from(bagian[1], "base64").length, 12);
    assert.equal(Buffer.from(bagian[2], "base64").length, 16);
    assert.equal(s.includes("081234567890"), false);
    assert.equal(s.length < 500, true);
  });

  it("dua enkripsi teks yang sama menghasilkan teks sandi berbeda (iv acak)", () => {
    assert.notEqual(e.enkripsi("081234567890", "x"), e.enkripsi("081234567890", "x"));
  });

  it("memakai pembangkit acak yang disuntik untuk iv", () => {
    const panggilan = [];
    const tetap = buatEnkripsi({ kunci: KUNCI, acak: (n) => { panggilan.push(n); return Buffer.alloc(n, 3); } });
    const s = tetap.enkripsi("abc", "x");
    assert.deepEqual(panggilan, [12]);
    assert.equal(s.split(".")[1], Buffer.alloc(12, 3).toString("base64"));
    assert.equal(s, tetap.enkripsi("abc", "x"));
  });

  it("data terikat berbeda ditolak (tidak dapat dipindah ke pengguna lain)", () => {
    const s = e.enkripsi("081234567890", "PaymentMethod:1");
    assert.throws(() => e.dekripsi(s, "PaymentMethod:2"), /data tidak sah/);
    assert.throws(() => e.dekripsi(s), /data tidak sah/);
  });

  it("kunci lain ditolak", () => {
    const s = e.enkripsi("081234567890", "x");
    assert.throws(() => buatEnkripsi({ kunci: KUNCI_LAIN }).dekripsi(s, "x"), /data tidak sah/);
  });

  it("mengubah satu karakter pada bagian mana pun ditolak", () => {
    const s = e.enkripsi("081234567890", "x");
    const bagian = s.split(".");
    for (const i of [1, 2, 3]) {
      const b = Buffer.from(bagian[i], "base64");
      b[0] = b[0] ^ 1;
      const rusak = bagian.map((p, j) => (j === i ? b.toString("base64") : p)).join(".");
      assert.throws(() => e.dekripsi(rusak, "x"), /(data tidak sah|format tidak dikenal)/, "bagian " + i);
    }
  });

  it("format tidak dikenal ditolak dengan pesan yang tidak memuat isi", () => {
    const s = e.enkripsi("081234567890", "x");
    const [, iv, tag, isi] = s.split(".");
    const buruk = [
      undefined,
      null,
      42,
      "",
      "polos",
      "v2." + [iv, tag, isi].join("."),
      ["v1", iv, tag].join("."),
      ["v1", iv, tag, isi, "ekstra"].join("."),
      ["v1", Buffer.alloc(11).toString("base64"), tag, isi].join("."),
      ["v1", iv, Buffer.alloc(15).toString("base64"), isi].join("."),
    ];
    for (const b of buruk) {
      assert.throws(() => e.dekripsi(b, "x"), (err) => /format tidak dikenal/.test(err.message) && err.message.includes(isi) === false, String(b));
    }
  });

  it("teks bukan string ditolak saat enkripsi", () => {
    for (const t of [undefined, null, 123, {}]) assert.throws(() => e.enkripsi(t, "x"), /teks harus string/);
  });

  it("pesan galat tidak pernah memuat teks asli atau kunci", () => {
    const s = e.enkripsi("081234567890", "x");
    try {
      buatEnkripsi({ kunci: KUNCI_LAIN }).dekripsi(s, "x");
    } catch (err) {
      assert.equal(err.message.includes("081234567890"), false);
      assert.equal(err.message.includes(KUNCI_LAIN), false);
    }
    assert.doesNotThrow(() => randomBytes(1));
  });
});
