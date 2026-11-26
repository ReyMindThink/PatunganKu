// Router metode pembayaran (api-contract 10.3): /api/me/payment-methods (milik sendiri) dan
// /api/groups/:groupId/members/:userId/payment-methods (metode pihak lain). Pabrik murni.
// Tanpa Idempotency-Key (bukan daftar wajib di kontrak 2.7). Rute grup memakai requireMember
// dengan ACTIVE, LEFT, REMOVED: mantan anggota yang berutang tetap perlu melunasi.
import { Router } from "express";
import { GROUP_STATUS } from "../config/constants.js";
import { validate } from "../middlewares/validate.js";
import { dibuat, kirim, kosong } from "../utils/respond.js";
import { anggotaParams, metodeParams, tambahMetodeSchema, ubahMetodeSchema } from "../validators/metodeBayar.validator.js";

export function buatRouterMetodeSaya({ layanan, requireAuth }) {
  const r = Router();
  r.use(requireAuth);
  r.get("/payment-methods", async (req, res) => {
    kirim(res, await layanan.daftarSaya(req.user.id));
  });
  r.post("/payment-methods", validate(tambahMetodeSchema), async (req, res) => {
    dibuat(res, await layanan.tambah(req.user.id, req.body));
  });
  r.patch("/payment-methods/:methodId", validate({ params: metodeParams, body: ubahMetodeSchema }), async (req, res) => {
    kirim(res, await layanan.ubah(req.user.id, req.valid.params.methodId, req.body));
  });
  r.delete("/payment-methods/:methodId", validate({ params: metodeParams }), async (req, res) => {
    await layanan.nonaktifkan(req.user.id, req.valid.params.methodId);
    kosong(res);
  });
  return r;
}

export function buatRouterMetodeAnggota({ layanan, requireAuth, requireMember }) {
  const r = Router();
  r.use(requireAuth);
  const semua = requireMember("groupId", { status: [GROUP_STATUS.ACTIVE, GROUP_STATUS.LEFT, GROUP_STATUS.REMOVED] });
  r.get("/:groupId/members/:userId/payment-methods", semua, validate({ params: anggotaParams }), async (req, res) => {
    kirim(res, await layanan.metodeAnggota({ userId: req.user.id, groupId: req.membership.groupId }, req.valid.params.userId));
  });
  return r;
}
