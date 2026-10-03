import multer from "multer";
import { HttpError } from "../utils/httpError.js";

const MAX_BYTES = 5 * 1024 * 1024;

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
}).single("receipt");

export function uploadReceiptFile(req, res, next) {
  uploader(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new HttpError(413, "file-too-large", "Ukuran file maksimal 5 MB"));
      }
      return next(new HttpError(400, "invalid-upload", "Upload tidak valid, kirim 1 file di field 'receipt'"));
    }
    next(err);
  });
}
