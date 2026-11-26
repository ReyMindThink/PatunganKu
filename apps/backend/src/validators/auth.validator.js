import { z } from "zod";

// K44: bcrypt hanya memakai 72 byte pertama (bcryptjs 3.0.3 memotong diam-diam, terbukti),
// jadi batasnya dihitung dalam byte UTF-8, bukan karakter. Password tidak dipangkas.
const PASSWORD_MAKS_BYTE = 72;
const PASSWORD_MIN_KARAKTER = 8;
const byte = (s) => Buffer.byteLength(s, "utf8");
const karakter = (s) => [...s].length;

const email = z.string().trim().toLowerCase().max(254, "Email maksimal 254 karakter").pipe(z.email("Email tidak valid"));
const nama = z.string().trim().min(1, "Nama wajib diisi").max(100, "Nama maksimal 100 karakter");
const batasByte = (s) => byte(s) <= PASSWORD_MAKS_BYTE;
const PESAN_BYTE = "Password maksimal 72 byte (huruf beraksen dan emoji memakai lebih dari 1 byte)";

const passwordBaru = z
  .string()
  .refine((s) => karakter(s) >= PASSWORD_MIN_KARAKTER, "Password minimal 8 karakter")
  .refine(batasByte, PESAN_BYTE);
const passwordLama = (pesanKosong) => z.string().min(1, pesanKosong).refine(batasByte, PESAN_BYTE);

export const registerSchema = z.object({ email, password: passwordBaru, name: nama });
export const loginSchema = z.object({ email, password: passwordLama("Password wajib diisi") });
export const ubahProfilSchema = z.object({ name: nama });
export const gantiPasswordSchema = z.object({
  currentPassword: passwordLama("Password saat ini wajib diisi"),
  newPassword: passwordBaru,
});
