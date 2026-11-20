import { z } from "zod";
import { HttpError } from "../utils/httpError.js";

// Pesan galat zod berbahasa Indonesia (api-contract 2.3).
z.config(z.locales.id());

const BAGIAN = ["params", "query", "body"];

// validate(skema)                      : memeriksa body (bentuk lama)
// validate({ params, query, body })    : memeriksa tiap bagian yang diberi skema
// Hasil yang sudah bersih ada di req.valid. req.body ikut diganti. req.params dan
// req.query tidak ditimpa karena req.query hanya-baca di Express 5.
export function validate(skema) {
  const peta = typeof skema?.safeParse === "function" ? { body: skema } : (skema ?? {});

  return (req, res, next) => {
    const errors = [];
    const valid = {};

    for (const bagian of BAGIAN) {
      const s = peta[bagian];
      if (s === undefined) continue;
      const hasil = s.safeParse(req[bagian] ?? {});
      if (hasil.success) {
        valid[bagian] = hasil.data;
      } else {
        for (const i of hasil.error.issues) {
          errors.push({ field: i.path.join(".") || bagian, message: i.message });
        }
      }
    }

    if (errors.length > 0) {
      return next(new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", errors));
    }

    req.valid = { ...req.valid, ...valid };
    if ("body" in valid) req.body = valid.body;
    next();
  };
}
