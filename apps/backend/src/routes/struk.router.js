// Router struk (api-contract 9.3): unggah dan verifikasi, dipasang di /api/groups. Semua rute
// memakai requireActiveMember (diuji lewat introspeksi) dan Idempotency-Key. Idempotensi
// membandingkan sidik isi permintaan, dan isi multipart tidak ikut ke req.body, jadi sidik berkas
// dimasukkan ke req.body supaya kunci yang sama dengan berkas lain ditolak (idempotency-key-reuse).
// Verifikasi memakai instance idempotensi sendiri dengan batas transaksi lebih panjang karena
// memanggil Gemini, dan dibatasi lajunya per pengguna (biaya layanan luar).
import { Router } from "express";
import multer from "multer";
import { STRUK } from "../config/constants.js";
import { buatPembatas } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";
import { HttpError } from "../utils/httpError.js";
import { sha256Hex } from "../utils/sidikStruk.js";
import { idParam } from "../validators/common.js";

const ctxDari = (req) => ({ userId: req.user.id, groupId: req.membership.groupId, role: req.membership.role });

export function buatUnggahStruk() {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: STRUK.UKURAN_MAKS, files: 1 } }).single("receipt");
}

export function buatPembatasStruk({ sekarang = Date.now } = {}) {
  return {
    verifikasi: buatPembatas({
      sekarang,
      batas: STRUK.VERIFIKASI_BATAS,
      jendelaMs: STRUK.VERIFIKASI_JENDELA_MS,
      kunci: (req) => "user:" + req.user.id,
      pesan: "Terlalu banyak permintaan verifikasi struk. Coba lagi nanti.",
    }),
  };
}

function wajibBerkas(req, res, next) {
  if (req.file === undefined) {
    return next(new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [{ field: "receipt", message: "Kirim satu berkas gambar di field 'receipt'." }]));
  }
  req.body = { receiptSha256: sha256Hex(req.file.buffer) };
  return next();
}

export function buatRouterStruk({ layanan, requireAuth, requireActiveMember, idempoten, idempotenVerifikasi, unggah = buatUnggahStruk(), pembatas = buatPembatasStruk() }) {
  const r = Router();
  r.use(requireAuth);
  const anggota = requireActiveMember("groupId");
  const params = validate({ params: idParam("groupId", "transactionId") });

  r.post("/:groupId/transactions/:transactionId/receipt", anggota, params, unggah, wajibBerkas, idempoten(async (req, tx) => ({
    status: 200,
    body: { data: await layanan.unggah(tx, ctxDari(req), req.valid.params.transactionId, { buffer: req.file.buffer }) },
  })));
  r.post("/:groupId/transactions/:transactionId/receipt/verify", anggota, params, pembatas.verifikasi, idempotenVerifikasi(async (req, tx) => ({
    status: 200,
    body: { data: await layanan.verifikasi(tx, ctxDari(req), req.valid.params.transactionId) },
  })));

  return r;
}
