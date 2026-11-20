import "dotenv/config";
import { bacaEnv } from "./envSchema.js";

const hasil = bacaEnv(process.env);

if (hasil.ok === false) {
  console.error("Konfigurasi .env tidak valid:");
  for (const galat of hasil.errors) {
    console.error(`- ${galat.field}: ${galat.message}`);
  }
  process.exit(1);
}

export const env = hasil.env;
