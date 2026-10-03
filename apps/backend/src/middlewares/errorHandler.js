import { HttpError } from "../utils/httpError.js";

export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid-json", message: "Body request bukan JSON yang valid" });
  }

  console.error(err);
  res.status(500).json({ error: "internal-error", message: "Terjadi kesalahan pada server" });
}
