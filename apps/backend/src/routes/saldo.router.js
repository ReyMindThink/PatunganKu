// Router saldo (api-contract 10.2): /api/groups/:groupId/balances dan /api/me/balances.
// Pabrik murni: layanan, requireAuth, dan requireMember disuntik. Rute grup memakai
// requireMember dengan status ACTIVE, LEFT, dan REMOVED: mantan anggota tetap dapat membaca
// saldonya sendiri (keputusan 7); pembatasan baris dilakukan layanan.
import { Router } from "express";
import { GROUP_STATUS } from "../config/constants.js";
import { validate } from "../middlewares/validate.js";
import { kirim } from "../utils/respond.js";
import { idParam } from "../validators/common.js";
import { rincianParams } from "../validators/saldo.validator.js";

const ctxDari = (req) => ({ userId: req.user.id, groupId: req.membership.groupId, role: req.membership.role, status: req.membership.status });

export function buatRouterSaldoGrup({ layanan, requireAuth, requireMember }) {
  const r = Router();
  r.use(requireAuth);
  const semua = requireMember("groupId", { status: [GROUP_STATUS.ACTIVE, GROUP_STATUS.LEFT, GROUP_STATUS.REMOVED] });
  r.get("/:groupId/balances", semua, validate({ params: idParam("groupId") }), async (req, res) => {
    kirim(res, await layanan.ringkasanGrup(ctxDari(req)));
  });
  r.get("/:groupId/balances/:userId", semua, validate({ params: rincianParams }), async (req, res) => {
    kirim(res, await layanan.rincian(ctxDari(req), req.valid.params.userId));
  });
  return r;
}

export function buatRouterSaldoSaya({ layanan, requireAuth }) {
  const r = Router();
  r.use(requireAuth);
  r.get("/balances", async (req, res) => {
    kirim(res, await layanan.ringkasanSaya(req.user.id));
  });
  return r;
}
