// Pemeriksa token akses. Murni: tidak mengimpor env.js maupun database, supaya dapat
// diuji tanpa .env. Berkas penyambung (auth.js) yang menyuntikkan rahasia aslinya.
import jwt from "jsonwebtoken";
import { HttpError } from "../utils/httpError.js";
import { idSkema } from "../validators/common.js";

// Algoritma dipaku (K45): token dengan algoritma lain, termasuk "none", ditolak.
const ALGORITMA = ["HS256"];
const POLA_BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/i;

const tidakSah = (detail) => new HttpError(401, "unauthorized", detail);

// secret: string, atau fungsi yang mengembalikan string (dibaca tiap permintaan).
// requireAuth tidak membaca database (K45). Hasilnya req.user = { id }.
export function buatRequireAuth({ secret }) {
  if (typeof secret === "string" && secret.length === 0) {
    throw new Error("buatRequireAuth: secret tidak boleh kosong");
  }
  const ambilSecret = typeof secret === "function" ? secret : () => secret;

  return function requireAuth(req, res, next) {
    const header = req.headers.authorization ?? "";
    if (header === "") return next(tidakSah("Token tidak ditemukan."));

    const cocok = POLA_BEARER.exec(header);
    if (cocok === null) return next(tidakSah("Format header Authorization tidak valid."));

    const kunci = ambilSecret();
    let isi;
    try {
      isi = jwt.verify(cocok[1], kunci, { algorithms: ALGORITMA });
    } catch {
      return next(tidakSah("Token tidak valid atau kedaluwarsa."));
    }

    const id = idSkema.safeParse(isi?.sub);
    if (id.success === false) return next(tidakSah("Token tidak valid atau kedaluwarsa."));

    req.user = { id: id.data };
    next();
  };
}
