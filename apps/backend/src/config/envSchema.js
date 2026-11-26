// Pembacaan dan validasi konfigurasi lingkungan. Murni: sumber (process.env) disuntik,
// jadi dapat diuji tanpa memanggil process.exit. config/env.js adalah penyambung tipis.
import { z } from "zod";
import { bacaKunci } from "../utils/enkripsi.js";

const BOOL = z.enum(["true", "false"], { error: "harus true atau false" });
const FORMAT_ORIGIN = /^https?:\/\/[^\s/]+$/;

const skema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().default("*"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET minimal 32 karakter"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  DB_ENCRYPT: BOOL.default("false"),
  DB_TRUST_SERVER_CERT: BOOL.default("true"),
  // Kunci enkripsi nomor rekening. Kosong sama dengan tidak diisi; bentuknya diperiksa di bacaEnv.
  PAYMENT_ENC_KEY: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
});

// "*" atau daftar origin http(s) dipisah koma tanpa garis miring di akhir; null bila tidak sah.
function bacaOrigin(teks) {
  if (teks.trim() === "*") return "*";
  const daftar = teks.split(",").map((o) => o.trim()).filter((o) => o.length > 0);
  if (daftar.length === 0) return null;
  for (const origin of daftar) {
    if (FORMAT_ORIGIN.test(origin) === false) return null;
  }
  return daftar;
}

export function bacaEnv(source) {
  const hasil = skema.safeParse(source);
  if (hasil.success === false) {
    return { ok: false, errors: hasil.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) };
  }
  const d = hasil.data;
  const galat = [];
  const corsOrigin = bacaOrigin(d.CORS_ORIGIN);
  if (corsOrigin === null) {
    galat.push({ field: "CORS_ORIGIN", message: "harus * atau daftar origin http(s) dipisah koma, tanpa garis miring di akhir" });
  }
  const kunciBayar = d.PAYMENT_ENC_KEY;
  const adaKunciBayar = (kunciBayar === undefined) === false;
  if (adaKunciBayar && bacaKunci(kunciBayar) === null) {
    galat.push({ field: "PAYMENT_ENC_KEY", message: "harus base64 dari 32 byte (buat dengan: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")" });
  }
  if (d.NODE_ENV === "production") {
    if (adaKunciBayar === false) galat.push({ field: "PAYMENT_ENC_KEY", message: "wajib di production" });
    if (corsOrigin === "*") galat.push({ field: "CORS_ORIGIN", message: "tidak boleh * di production: sebut origin frontend" });
    if ((d.DB_ENCRYPT === "true") === false) galat.push({ field: "DB_ENCRYPT", message: "harus true di production" });
    if ((d.DB_TRUST_SERVER_CERT === "false") === false) galat.push({ field: "DB_TRUST_SERVER_CERT", message: "harus false di production" });
  }
  if (galat.length > 0) return { ok: false, errors: galat };
  return {
    ok: true,
    env: {
      nodeEnv: d.NODE_ENV,
      port: d.PORT,
      corsOrigin,
      jwtSecret: d.JWT_SECRET,
      jwtExpiresIn: d.JWT_EXPIRES_IN,
      trustProxy: d.TRUST_PROXY,
      dbEncrypt: d.DB_ENCRYPT === "true",
      dbTrustServerCert: d.DB_TRUST_SERVER_CERT === "true",
      paymentEncKey: kunciBayar ?? null,
    },
  };
}

// Opsi koneksi SQL Server untuk adapter Prisma. Tidak melempar saat env lain kosong:
// dipakai lib/prisma.js yang juga dimuat oleh tes integrasi (bawaan lokal: tanpa enkripsi).
const skemaDb = z.object({ DB_ENCRYPT: BOOL.default("false"), DB_TRUST_SERVER_CERT: BOOL.default("true") });

export function opsiDatabase(source) {
  const hasil = skemaDb.safeParse(source);
  if (hasil.success === false) throw new Error("DB_ENCRYPT dan DB_TRUST_SERVER_CERT harus true atau false");
  return {
    encrypt: hasil.data.DB_ENCRYPT === "true",
    trustServerCertificate: hasil.data.DB_TRUST_SERVER_CERT === "true",
  };
}
