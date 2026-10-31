import { STATUS_CODES } from "node:http";
import { HttpError } from "../utils/httpError.js";

// Semua respons galat berbentuk application/problem+json (RFC 9457, api-contract 2.3).
function problem(res, status, code, detail, errors) {
  const body = {
    type: "about:blank",
    title: STATUS_CODES[status] ?? "Error",
    status,
    code,
    detail,
  };
  if (errors) body.errors = errors;
  res.status(status).type("application/problem+json").json(body);
}

export function rutTidakDitemukan(req, res, next) {
  next(new HttpError(404, "not-found", "Rute tidak ditemukan."));
}

export function errorHandler(err, req, res, next) {
  // Respons sudah mulai dikirim: serahkan ke penangan bawaan Express (menutup koneksi).
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return problem(res, err.status, err.code, err.message, err.errors);
  }

  if (err?.type === "entity.parse.failed") {
    return problem(res, 400, "invalid-json", "Body permintaan bukan JSON yang valid.");
  }

  if (err?.type === "entity.too.large") {
    return problem(res, 413, "payload-too-large", "Body permintaan terlalu besar.");
  }

  if (err?.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return problem(res, 413, "payload-too-large", "Ukuran berkas maksimal 5 MB.");
    }
    return problem(res, 400, "validation-failed", "Unggahan tidak valid.", [
      { field: err.field ?? "berkas", message: "Unggahan tidak sesuai aturan." },
    ]);
  }

  // Galat tak dikenal: detail hanya ke log server, tidak pernah ke klien.
  console.error(err);
  problem(res, 500, "internal-error", "Terjadi kesalahan pada server.");
}
