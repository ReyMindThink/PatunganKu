import { z } from "zod";
import { PELUNASAN } from "../config/constants.js";
import { idParam, idSkema, kursorSkema, limitSkema } from "./common.js";

// Field multipart datang sebagai teks dan JSON sebagai angka: keduanya diterima, hasilnya number.
const angka = z.union([z.number(), z.string()]).transform(String).pipe(idSkema);
const kosongJadiTiada = (v) => (v === "" ? undefined : v);

const catatan = z.string().trim().max(PELUNASAN.CATATAN_MAKS, "Catatan maksimal " + PELUNASAN.CATATAN_MAKS + " karakter").optional().transform(kosongJadiTiada);
const alasan = z.string().trim().max(PELUNASAN.ALASAN_MAKS, "Alasan maksimal " + PELUNASAN.ALASAN_MAKS + " karakter").optional().transform(kosongJadiTiada);

// Sampai 9b-2b hanya CASH yang didukung; jenis lain dijawab 400 dengan pesan yang jelas.
const jenis = z
  .enum(["BANK", "EWALLET", "CASH"], { error: "methodType harus BANK, EWALLET, atau CASH" })
  .refine((v) => PELUNASAN.METODE_DIDUKUNG.includes(v), "Jenis pembayaran ini belum didukung. Gunakan CASH.");

export const kirimPelunasanSchema = z.strictObject({ receiverId: angka, amount: angka, methodType: jenis, note: catatan });
export const tolakPelunasanSchema = z.strictObject({ reason: alasan });
export const daftarPelunasanQuery = z.object({
  limit: limitSkema,
  cursor: kursorSkema,
  role: z.enum(["sent", "received"]).optional(),
  status: z.enum(PELUNASAN.STATUS).optional(),
});
export const kursorPelunasanSkema = z.object({
  t: z.string().refine((s) => Number.isNaN(Date.parse(s)) === false),
  id: z.number().int().positive(),
});
export const pelunasanParams = idParam("groupId", "paymentId");
