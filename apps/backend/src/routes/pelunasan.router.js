// Router pelunasan (api-contract 10.4), dipasang di /api/groups. Semua rute memakai requireMember
// dengan ACTIVE, LEFT, REMOVED (mantan anggota boleh melunasi dan membaca pelunasannya sendiri).
// Idempotency-Key wajib untuk kirim dan konfirmasi (kontrak 2.7); tolak dan batal adalah klaim
// status yang aman diulang (balasan kedua 409). Pembuatan multipart: field teks lewat multer; berkas
// "proof" wajib untuk BANK dan EWALLET, dilarang untuk CASH, dan hash-nya masuk sidik idempotensi.
import { Router } from "express";
import multer from "multer";
import { GROUP_STATUS, STRUK } from "../config/constants.js";
import { validate } from "../middlewares/validate.js";
import { HttpError } from "../utils/httpError.js";
import { halaman, kirim } from "../utils/respond.js";
import { sha256Hex } from "../utils/sidikStruk.js";
import { daftarPelunasanQuery, kirimPelunasanSchema, pelunasanParams, tolakPelunasanSchema } from "../validators/pelunasan.validator.js";

const ada = (req) => (req.file === undefined) === false;
const ctxDari = (req) => ({ userId: req.user.id, groupId: req.membership.groupId, role: req.membership.role });

export function buatUnggahPelunasan() {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: STRUK.UKURAN_MAKS, files: 1 } }).single("proof");
}

function periksaBerkas(req, res, next) {
  const tunai = req.body.methodType === "CASH";
  const adaBerkas = ada(req);
  const salah = (pesan) => next(new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [{ field: "proof", message: pesan }]));
  if (tunai && adaBerkas) return salah("Pelunasan tunai tidak memakai bukti.");
  if (tunai === false && adaBerkas === false) return salah("Bukti pembayaran wajib dikirim di field 'proof' untuk BANK dan EWALLET.");
  // Isi multipart tidak ada di req.body: hash berkas ikut sidik supaya kunci yang sama dengan berkas lain ditolak.
  if (adaBerkas) req.body = { ...req.body, proofSha256: sha256Hex(req.file.buffer) };
  return next();
}

export function buatRouterPelunasan({ layanan, requireAuth, requireMember, idempoten, unggah = buatUnggahPelunasan() }) {
  const r = Router();
  r.use(requireAuth);
  const anggota = requireMember("groupId", { status: [GROUP_STATUS.ACTIVE, GROUP_STATUS.LEFT, GROUP_STATUS.REMOVED] });
  const params = validate({ params: pelunasanParams });

  r.post("/:groupId/payments", anggota, unggah, validate({ body: kirimPelunasanSchema }), periksaBerkas, idempoten(async (req, tx) => ({
    status: 201,
    body: { data: await layanan.kirim(tx, ctxDari(req), req.body, ada(req) ? { buffer: req.file.buffer } : undefined) },
  })));
  r.get("/:groupId/payments", anggota, validate({ query: daftarPelunasanQuery }), async (req, res) => {
    const hasil = await layanan.daftar(ctxDari(req), req.valid.query);
    halaman(res, hasil.data, { nextCursor: hasil.nextCursor, hasMore: hasil.hasMore });
  });
  r.get("/:groupId/payments/:paymentId", anggota, params, async (req, res) => {
    kirim(res, await layanan.detail(ctxDari(req), req.valid.params.paymentId));
  });
  r.get("/:groupId/payments/:paymentId/proof", anggota, params, async (req, res) => {
    const { buffer, tipe } = await layanan.bukti(ctxDari(req), req.valid.params.paymentId);
    res.set({ "Content-Type": tipe, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.send(buffer);
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
