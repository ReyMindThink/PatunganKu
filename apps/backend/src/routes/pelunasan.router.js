// Router pelunasan (api-contract 10.4), dipasang di /api/groups. Semua rute memakai requireMember
// dengan ACTIVE, LEFT, REMOVED (mantan anggota boleh melunasi dan membaca pelunasannya sendiri).
// Idempotency-Key wajib untuk kirim dan konfirmasi (kontrak 2.7); tolak dan batal adalah klaim
// status yang aman diulang (balasan kedua 409). Pembuatan multipart: field teks lewat multer, dan
// berkas "proof" ditolak sampai 9b-2b (tunai tidak memakai bukti).
import { Router } from "express";
import multer from "multer";
import { GROUP_STATUS, STRUK } from "../config/constants.js";
import { validate } from "../middlewares/validate.js";
import { HttpError } from "../utils/httpError.js";
import { halaman, kirim } from "../utils/respond.js";
import { idParam } from "../validators/common.js";
import { daftarPelunasanQuery, kirimPelunasanSchema, pelunasanParams, tolakPelunasanSchema } from "../validators/pelunasan.validator.js";

const ctxDari = (req) => ({ userId: req.user.id, groupId: req.membership.groupId, role: req.membership.role });

export function buatUnggahPelunasan() {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: STRUK.UKURAN_MAKS, files: 1 } }).single("proof");
}

function tolakBerkas(req, res, next) {
  if (req.file === undefined) return next();
  return next(new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [{ field: "proof", message: "Pelunasan tunai tidak memakai bukti." }]));
}

export function buatRouterPelunasan({ layanan, requireAuth, requireMember, idempoten, unggah = buatUnggahPelunasan() }) {
  const r = Router();
  r.use(requireAuth);
  const anggota = requireMember("groupId", { status: [GROUP_STATUS.ACTIVE, GROUP_STATUS.LEFT, GROUP_STATUS.REMOVED] });
  const params = validate({ params: pelunasanParams });

  r.post("/:groupId/payments", anggota, unggah, tolakBerkas, validate({ body: kirimPelunasanSchema }), idempoten(async (req, tx) => ({
    status: 201,
    body: { data: await layanan.kirim(tx, ctxDari(req), req.body) },
  })));
  r.get("/:groupId/payments", anggota, validate({ query: daftarPelunasanQuery }), async (req, res) => {
    const hasil = await layanan.daftar(ctxDari(req), req.valid.query);
    halaman(res, hasil.data, { nextCursor: hasil.nextCursor, hasMore: hasil.hasMore });
  });
  r.get("/:groupId/payments/:paymentId", anggota, params, async (req, res) => {
    kirim(res, await layanan.detail(ctxDari(req), req.valid.params.paymentId));
  });
  r.post("/:groupId/payments/:paymentId/confirm", anggota, params, idempoten(async (req, tx) => ({
    status: 200,
    body: { data: await layanan.konfirmasi(tx, ctxDari(req), req.valid.params.paymentId) },
  })));
  r.post("/:groupId/payments/:paymentId/reject", anggota, params, validate({ body: tolakPelunasanSchema }), async (req, res) => {
    kirim(res, await layanan.tolak(ctxDari(req), req.valid.params.paymentId, req.body));
  });
  r.post("/:groupId/payments/:paymentId/cancel", anggota, params, async (req, res) => {
    kirim(res, await layanan.batal(ctxDari(req), req.valid.params.paymentId));
  });
  return r;
}
