import { z } from "zod";
import { METODE_BAYAR } from "../config/constants.js";
import { idParam } from "./common.js";

const provider = z.string().trim().min(1, "Penyedia wajib diisi").max(METODE_BAYAR.PROVIDER_MAKS, "Penyedia maksimal " + METODE_BAYAR.PROVIDER_MAKS + " karakter");
const nama = z.string().trim().min(1, "Nama pemilik wajib diisi").max(METODE_BAYAR.NAMA_MAKS, "Nama pemilik maksimal " + METODE_BAYAR.NAMA_MAKS + " karakter");
const nomor = z
  .string()
  .trim()
  .regex(new RegExp("^[0-9]{" + METODE_BAYAR.NOMOR_MIN + "," + METODE_BAYAR.NOMOR_MAKS + "}$"), "Nomor harus " + METODE_BAYAR.NOMOR_MIN + " sampai " + METODE_BAYAR.NOMOR_MAKS + " angka");

// api-contract 10.3: CASH hanya mengirim kind; BANK dan EWALLET wajib lengkap. Kunci lain ditolak.
export const tambahMetodeSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("CASH") }),
    z.strictObject({ kind: z.enum(["BANK", "EWALLET"]), provider, accountNo: nomor, accountName: nama }),
  ],
  { error: "kind harus BANK, EWALLET, atau CASH" },
);

export const ubahMetodeSchema = z
  .strictObject({ provider: provider.optional(), accountNo: nomor.optional(), accountName: nama.optional() })
  .refine((o) => Object.values(o).some((v) => (v === undefined) === false), "Minimal satu field harus diubah");

export const metodeParams = idParam("methodId");
export const anggotaParams = idParam("groupId", "userId");
