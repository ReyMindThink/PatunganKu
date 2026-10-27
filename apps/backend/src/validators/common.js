import { z } from "zod";

const INT_MAKS = 2147483647; // batas tipe Int di SQL Server

// Id dari path atau query: bilangan bulat positif tanpa nol di depan, hasilnya number.
export const idSkema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/, "Harus bilangan bulat positif")
  .transform(Number)
  .refine((n) => n <= INT_MAKS, "Melebihi batas id");

// idParam("groupId") menghasilkan skema objek untuk validate({ params: ... }).
export const idParam = (...nama) => z.object(Object.fromEntries(nama.map((n) => [n, idSkema])));
