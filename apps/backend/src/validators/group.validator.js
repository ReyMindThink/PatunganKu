import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Nama grup wajib diisi").max(100),
});

export const joinGroupSchema = z.object({
  code: z.string().trim().toUpperCase().min(1, "Kode grup wajib diisi").max(20),
});
