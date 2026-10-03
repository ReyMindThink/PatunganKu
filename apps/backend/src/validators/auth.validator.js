import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Email tidak valid"));

export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(8, "Password minimal 8 karakter")
    .max(72, "Password maksimal 72 karakter"),
  name: z.string().trim().min(1, "Nama wajib diisi").max(100),
  phone: z.string().trim().max(20).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password wajib diisi"),
});
