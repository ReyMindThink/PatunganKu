// Klien Gemini untuk verifikasi struk. Pabrik murni: kunci, model, fetch, dan batas waktu
// disuntik, sehingga dapat dites tanpa jaringan. Semua kegagalan layanan luar (jaringan, batas
// waktu, status bukan 2xx, JSON atau skema tidak sah) menjadi 502 upstream-error dengan pesan
// generik; rinciannya hanya ke log dan tidak pernah memuat kunci. Kunci yang kosong adalah
// kesalahan konfigurasi (Error biasa, menjadi 500), bukan kesalahan layanan luar.
import { z } from "zod";
import { STRUK } from "../config/constants.js";
import { HttpError } from "../utils/httpError.js";

const PROMPT = [
  "Kamu memeriksa foto yang diunggah sebagai bukti pembayaran di aplikasi patungan.",
  "Tentukan apakah gambar ini struk atau nota belanja yang asli (bukan foto biasa, screenshot chat, atau dokumen lain).",
  "Jika ya, baca TOTAL AKHIR yang harus dibayar dalam rupiah sebagai bilangan bulat tanpa titik atau koma.",
  "Jika bukan struk atau total tidak terbaca jelas, isi total dengan null.",
  "Isi merchant dengan nama toko atau restoran di struk, atau null bila tidak terbaca.",
  "Isi purchasedAt dengan tanggal dan jam transaksi di struk berformat YYYY-MM-DDTHH:mm (waktu setempat di struk), atau null bila tanggal atau jam tidak terbaca jelas.",
  "confidence adalah keyakinanmu 0 sampai 1.",
].join(" ");

const hasilSkema = z.object({
  isReceipt: z.boolean(),
  total: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  merchant: z.string().nullable(),
  purchasedAt: z.string().nullable(),
});

const POLA_WAKTU = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:?[0-9]{2})?$/;
const POLA_ZONA = /(Z|[+-][0-9]{2}:?[0-9]{2})$/;

// Hanya tanggal DAN jam yang diterima; tanpa zona dianggap WIB (+07:00). Selain itu null.
export function bacaWaktuStruk(teks) {
  const bentukSah = typeof teks === "string" && POLA_WAKTU.test(teks.trim());
  if (bentukSah === false) return null;
  const bersih = teks.trim();
  const d = new Date(POLA_ZONA.test(bersih) ? bersih : bersih + "+07:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buatPemverifGemini({ apiKey, model, fetchFn = fetch, timeoutMs = STRUK.GEMINI_TIMEOUT_MS, versiPrompt = STRUK.PROMPT_VERSION, catat = (pesan) => console.error(pesan) }) {
  const gagal = (pesan, rincian) => {
    catat("Gemini: " + rincian);
    return new HttpError(502, "upstream-error", pesan);
  };

  return async function verifikasi(buffer, mimeType) {
    if (Boolean(apiKey) === false) throw new Error("GEMINI_API_KEY belum diisi");
    let res;
    try {
      res = await fetchFn("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                isReceipt: { type: "BOOLEAN" },
                total: { type: "INTEGER", nullable: true },
                confidence: { type: "NUMBER" },
                merchant: { type: "STRING", nullable: true },
                purchasedAt: { type: "STRING", nullable: true },
              },
              required: ["isReceipt", "total", "confidence", "merchant", "purchasedAt"],
            },
          },
        }),
      });
    } catch (e) {
      const habisWaktu = e?.name === "TimeoutError" || e?.name === "AbortError";
      throw gagal(
        habisWaktu ? "Layanan verifikasi struk tidak merespons tepat waktu." : "Layanan verifikasi struk tidak dapat dihubungi.",
        habisWaktu ? "batas waktu " + timeoutMs + " ms terlewati" : "gagal terhubung (" + (e?.name ?? "galat") + ")",
      );
    }
    if (res.ok === false) throw gagal("Layanan verifikasi struk menolak permintaan.", "HTTP " + res.status);

    let hasil;
    try {
      const data = await res.json();
      const bagian = data.candidates?.[0]?.content?.parts ?? [];
      hasil = hasilSkema.parse(JSON.parse(bagian.map((p) => p.text).filter(Boolean).join("")));
    } catch (e) {
      throw gagal("Hasil verifikasi struk tidak dapat dibaca.", "respons tidak sah (" + (e?.name ?? "galat") + ")");
    }

    const total = Number.isInteger(hasil.total) && hasil.total > 0 && hasil.total <= STRUK.TOTAL_MAKS ? hasil.total : null;
    const merchant = typeof hasil.merchant === "string" && hasil.merchant.trim().length > 0 ? hasil.merchant.trim().slice(0, 200) : null;
    return { isReceipt: hasil.isReceipt, total, confidence: hasil.confidence, merchant, purchasedAt: bacaWaktuStruk(hasil.purchasedAt), aiModel: model, promptVersion: versiPrompt };
  };
}
