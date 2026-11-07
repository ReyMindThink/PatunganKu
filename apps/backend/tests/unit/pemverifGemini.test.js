import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bacaWaktuStruk, buatPemverifGemini } from "../../src/lib/pemverifGemini.js";

const KUNCI = "kunci-rahasia-gemini-uji-123456";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const hasilBaik = { isReceipt: true, total: 70000, confidence: 0.93, merchant: "  Warung Makan Sedap  ", purchasedAt: "2026-10-05T12:30" };
const balasan = (isi, ubah = {}) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof isi === "string" ? isi : JSON.stringify(isi) }] } }] }), ...ubah });
const galat = (status, code) => (e) => e.status === status && e.code === code;

function buat(fetchFn, ubah = {}) {
  const log = [];
  const pemverif = buatPemverifGemini({ apiKey: KUNCI, model: "gemini-uji", fetchFn, timeoutMs: 40, versiPrompt: "v-uji", catat: (m) => log.push(m), ...ubah });
  return { pemverif, log };
}

describe("buatPemverifGemini", () => {
  it("mengirim permintaan yang benar dan menormalkan hasil", async () => {
    let diterima;
    const { pemverif } = buat(async (url, opsi) => {
      diterima = { url, opsi };
      return balasan(hasilBaik);
    });
    const hasil = await pemverif(JPEG, "image/jpeg");
    assert.equal(diterima.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-uji:generateContent");
    assert.equal(diterima.opsi.method, "POST");
    assert.equal(diterima.opsi.headers["x-goog-api-key"], KUNCI);
    assert.ok(diterima.opsi.signal instanceof AbortSignal);
    const badan = JSON.parse(diterima.opsi.body);
    assert.deepEqual(badan.contents[0].parts[1], { inline_data: { mime_type: "image/jpeg", data: JPEG.toString("base64") } });
    assert.equal(badan.generationConfig.temperature, 0);
    assert.deepEqual(badan.generationConfig.responseSchema.required, ["isReceipt", "total", "confidence", "merchant", "purchasedAt"]);
    assert.equal(diterima.opsi.body.includes(KUNCI), false, "kunci tidak boleh ada di badan");
    assert.deepEqual(hasil, { isReceipt: true, total: 70000, confidence: 0.93, merchant: "Warung Makan Sedap", purchasedAt: new Date("2026-10-05T05:30:00.000Z"), aiModel: "gemini-uji", promptVersion: "v-uji" });
  });

  it("total yang tidak masuk akal (nol, negatif, di atas batas) menjadi null; merchant kosong menjadi null dan dipotong 200", async () => {
    for (const total of [0, -5, 2000000001, null]) {
      const { pemverif } = buat(async () => balasan({ ...hasilBaik, total }));
      assert.equal((await pemverif(JPEG, "image/jpeg")).total, null, String(total));
    }
    const { pemverif: batas } = buat(async () => balasan({ ...hasilBaik, total: 2000000000 }));
    assert.equal((await batas(JPEG, "image/jpeg")).total, 2000000000);
    for (const merchant of ["", "   ", null]) {
      const { pemverif } = buat(async () => balasan({ ...hasilBaik, merchant }));
      assert.equal((await pemverif(JPEG, "image/jpeg")).merchant, null);
    }
    const { pemverif: panjang } = buat(async () => balasan({ ...hasilBaik, merchant: "x".repeat(300) }));
    assert.equal((await panjang(JPEG, "image/jpeg")).merchant.length, 200);
  });

  it("batas waktu terlewati menjadi 502 upstream-error dan fetch menerima sinyal pembatal", async () => {
    // AbortSignal.timeout tidak menahan event loop; penjaga ini meniru soket jaringan yang menahannya.
    const { pemverif, log } = buat((url, { signal }) => new Promise((_, tolak) => {
      const penjaga = setTimeout(() => {}, 5000);
      signal.addEventListener("abort", () => {
        clearTimeout(penjaga);
        tolak(signal.reason);
      });
    }));
    const mulai = Date.now();
    await assert.rejects(() => pemverif(JPEG, "image/jpeg"), (e) => e.status === 502 && e.code === "upstream-error" && /tepat waktu/.test(e.message));
    assert.ok(Date.now() - mulai < 2000, "harus berhenti di sekitar batas waktu");
    assert.match(log[0], /batas waktu 40 ms/);
  });

  it("jaringan gagal, status bukan 2xx, dan JSON atau skema tidak sah semuanya 502 dengan pesan generik", async () => {
    const kasus = [
      ["jaringan putus", async () => { throw new TypeError("fetch failed " + KUNCI); }],
      ["HTTP 429", async () => balasan({}, { ok: false, status: 429 })],
      ["HTTP 500", async () => balasan({}, { ok: false, status: 500 })],
      ["HTTP 503 walau badan tampak sah", async () => balasan(hasilBaik, { ok: false, status: 503 })],
      ["JSON rusak", async () => balasan("{bukan json")],
      ["teks kosong", async () => balasan("")],
      ["tanpa kandidat", async () => ({ ok: true, status: 200, json: async () => ({}) })],
      ["respons bukan JSON", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } })],
      ["confidence di luar rentang", async () => balasan({ ...hasilBaik, confidence: 2 })],
      ["isReceipt bukan boolean", async () => balasan({ ...hasilBaik, isReceipt: "ya" })],
      ["total pecahan", async () => balasan({ ...hasilBaik, total: 10.5 })],
      ["field wajib hilang", async () => balasan({ isReceipt: true, total: 5, confidence: 0.9 })],
    ];
    for (const [nama, fn] of kasus) {
      const { pemverif, log } = buat(fn);
      await assert.rejects(() => pemverif(JPEG, "image/jpeg"), (e) => {
        assert.equal(e.status, 502, nama);
        assert.equal(e.code, "upstream-error", nama);
        assert.equal(e.message.includes(KUNCI), false, "kunci bocor di pesan: " + nama);
        return true;
      });
      assert.equal(log.length, 1, nama);
      assert.equal(log[0].includes(KUNCI), false, "kunci bocor di log: " + nama);
    }
  });

  it("tanpa kunci adalah kesalahan konfigurasi (bukan 502) dan tidak memanggil jaringan", async () => {
    let dipanggil = 0;
    const { pemverif } = buat(async () => { dipanggil++; return balasan(hasilBaik); }, { apiKey: "" });
    await assert.rejects(() => pemverif(JPEG, "image/jpeg"), (e) => e.status === undefined && /GEMINI_API_KEY/.test(e.message));
    assert.equal(dipanggil, 0);
  });

  it("teks respons yang terpecah di beberapa bagian digabung sebelum diurai", async () => {
    const teks = JSON.stringify(hasilBaik);
    const { pemverif } = buat(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: teks.slice(0, 20) }, { text: teks.slice(20) }] } }] }) }));
    assert.equal((await pemverif(JPEG, "image/jpeg")).total, 70000);
  });
});

describe("bacaWaktuStruk", () => {
  it("jam tanpa zona dibaca sebagai WIB; zona eksplisit dihormati; tanggal saja atau teks lain null", () => {
    assert.equal(bacaWaktuStruk("2026-10-05T12:30").toISOString(), "2026-10-05T05:30:00.000Z");
    assert.equal(bacaWaktuStruk("2026-10-05T12:30:45").toISOString(), "2026-10-05T05:30:45.000Z");
    assert.equal(bacaWaktuStruk("2026-10-05T12:30Z").toISOString(), "2026-10-05T12:30:00.000Z");
    assert.equal(bacaWaktuStruk("2026-10-05T12:30+09:00").toISOString(), "2026-10-05T03:30:00.000Z");
    assert.equal(bacaWaktuStruk("  2026-10-05T12:30  ").toISOString(), "2026-10-05T05:30:00.000Z");
    for (const buruk of ["2026-10-05", "2026-10-05Z", "5 Oktober 2026 12:30", "2026-13-45T99:99", "", null, undefined, 5]) {
      assert.equal(bacaWaktuStruk(buruk), null, String(buruk));
    }
  });
});
