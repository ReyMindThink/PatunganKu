import { z } from "zod";
import { PAGINASI } from "../config/constants.js";

const INT_MAKS = 2147483647; // batas tipe Int di SQL Server

// Id dari path atau query: bilangan bulat positif tanpa nol di depan, hasilnya number.
export const idSkema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/, "Harus bilangan bulat positif")
  .transform(Number)
  .refine((n) => n <= INT_MAKS, "Melebihi batas id");

// idParam("groupId") menghasilkan skema objek untuk validate({ params: ... }).
export const idParam = (...nama) => z.object(Object.fromEntries(nama.map((n) => [n, idSkema])));

// Query limit: bilangan bulat 1 sampai LIMIT_MAKS. Di atas batas ditolak 400, tidak dipotong.
export const limitSkema = z
  .string()
  .regex(/^[1-9][0-9]{0,2}$/, "Harus bilangan bulat positif")
  .transform(Number)
  .refine((n) => n <= PAGINASI.LIMIT_MAKS, "Maksimal " + PAGINASI.LIMIT_MAKS)
  .default(PAGINASI.LIMIT_BAWAAN);

// Query cursor: string buram dari respons sebelumnya. Isinya diperiksa oleh bacaKursor.
export const kursorSkema = z.string().min(1).max(300).optional();

// Untuk validate({ query: paginasiQuery }): hasilnya req.valid.query = { limit, cursor }.
export const paginasiQuery = z.object({ limit: limitSkema, cursor: kursorSkema });
