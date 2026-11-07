import { z } from "zod";

export const buatGrupSchema = z.object({
  name: z.string().trim().min(1, "Nama grup wajib diisi").max(100, "Nama grup maksimal 100 karakter"),
});

// K33: kode dinormalisasi (pangkas spasi, huruf besar) sebelum dicari.
export const gabungSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, "Kode grup wajib diisi").max(20, "Kode grup tidak valid"),
});
