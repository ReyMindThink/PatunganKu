import { z } from "zod";
import { TRANSAKSI } from "../config/constants.js";
import { idSkema, limitSkema, kursorSkema } from "./common.js";

const deskripsi = z.string().trim().min(1, "Deskripsi wajib diisi").max(TRANSAKSI.DESKRIPSI_MAKS);
const nominal = z.number().int().min(1, "Nominal minimal Rp1").max(TRANSAKSI.NOMINAL_MAKS, "Nominal maksimal Rp100.000.000");
const mode = z.enum(TRANSAKSI.MODE).refine((m) => TRANSAKSI.MODE_DIDUKUNG.includes(m), "Mode ini belum didukung.");
// EQUAL_ALL memakai semua anggota ACTIVE saat submit: participants tidak boleh dikirim.
const tanpaPeserta = z.any().refine((v) => v === undefined, "Tidak boleh diisi untuk mode EQUAL_ALL.").optional();

export const buatTransaksiSchema = z.object({
  description: deskripsi,
  amount: nominal,
  mode: mode.default("EQUAL_ALL"),
  participants: tanpaPeserta,
});

const kosong = (v) => v === undefined;
export const ubahTransaksiSchema = z
  .object({ description: deskripsi.optional(), amount: nominal.optional(), mode: mode.optional(), participants: tanpaPeserta })
  .refine((d) => [d.description, d.amount, d.mode].every(kosong) === false, "Minimal satu field harus diubah.");

// Isi kursor daftar transaksi: posisi baris terakhir (createdAt ISO dan id), terbaru lebih dulu.
export const kursorTransaksiSkema = z.object({
  t: z.string().refine((s) => Number.isNaN(Date.parse(s)) === false),
  id: z.number().int().positive(),
});

export const daftarTransaksiQuery = z.object({
  limit: limitSkema,
  cursor: kursorSkema,
  month: z.string().regex(/^20[0-9]{2}-(0[1-9]|1[0-2])$/, "Format YYYY-MM").optional(),
  status: z.enum(TRANSAKSI.STATUS).optional(),
  mode: z.enum(TRANSAKSI.MODE).optional(),
  payerId: idSkema.optional(),
});
