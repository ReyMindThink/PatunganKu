import { z } from "zod";
import { PELUNASAN } from "../config/constants.js";
import { idParam, idSkema, kursorSkema, limitSkema } from "./common.js";

// Field multipart datang sebagai teks dan JSON sebagai angka: keduanya diterima, hasilnya number.
const angka = z.union([z.number(), z.string()]).transform(String).pipe(idSkema);
const kosongJadiTiada = (v) => (v === "" ? undefined : v);

const catatan = z.string().trim().max(PELUNASAN.CATATAN_MAKS, "Catatan maksimal " + PELUNASAN.CATATAN_MAKS + " karakter").optional().transform(kosongJadiTiada);
const alasan = z.string().trim().max(PELUNASAN.ALASAN_MAKS, "Alasan maksimal " + PELUNASAN.ALASAN_MAKS + " karakter").optional().transform(kosongJadiTiada);

// CASH hanya membawa nominal dan penerima; BANK dan EWALLET wajib methodId (metode aktif milik
// penerima). Berkas bukti dicek di router karena bukan bagian dari field teks.
const dasar = { receiverId: angka, amount: angka, note: catatan };
export const kirimPelunasanSchema = z.discriminatedUnion(
  "methodType",
  [
    z.strictObject({ ...dasar, methodType: z.literal("CASH") }),
    z.strictObject({ ...dasar, methodType: z.enum(["BANK", "EWALLET"]), methodId: angka }),
  ],
  { error: "methodType harus BANK, EWALLET, atau CASH" },
);
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
