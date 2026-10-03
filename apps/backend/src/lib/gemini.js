import "dotenv/config";
import { z } from "zod";

const PROMPT = [
  "Kamu memeriksa foto yang diunggah sebagai bukti pembayaran di aplikasi patungan.",
  "Tentukan apakah gambar ini struk atau nota belanja yang asli (bukan foto biasa, screenshot chat, atau dokumen lain).",
  "Jika ya, baca TOTAL AKHIR yang harus dibayar dalam rupiah sebagai bilangan bulat tanpa titik atau koma.",
  "Jika bukan struk atau total tidak terbaca jelas, isi total dengan null.",
  "confidence adalah keyakinanmu 0 sampai 1.",
].join(" ");

const resultSchema = z.object({
  isReceipt: z.boolean(),
  total: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
});

export async function verifyWithGemini(buffer, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY belum diisi di .env");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              isReceipt: { type: "BOOLEAN" },
              total: { type: "INTEGER", nullable: true },
              confidence: { type: "NUMBER" },
            },
            required: ["isReceipt", "total", "confidence"],
          },
        },
      }),
    },
  );

  if (res.ok === false) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Gemini HTTP ${res.status}: ${body.error?.message ?? "tanpa pesan"}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text).filter(Boolean).join("");
  return resultSchema.parse(JSON.parse(text));
}
