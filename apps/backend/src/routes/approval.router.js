// Router persetujuan (api-contract 6.3): /api/groups/:groupId/approvals. Pabrik murni: layanan,
// requireAuth, requireActiveMember, dan idempoten disuntik. Semua anggota ACTIVE dapat membaca;
// hak memberi suara dihitung layanan (canVote). Pemberian suara memakai Idempotency-Key.
import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { halaman, kirim } from "../utils/respond.js";
import { idParam } from "../validators/common.js";
import { daftarApprovalQuery, suaraSchema } from "../validators/approval.validator.js";

const ctxDari = (req) => ({ userId: req.user.id, groupId: req.membership.groupId, role: req.membership.role });

export function buatRouterApproval({ layanan, requireAuth, requireActiveMember, idempoten }) {
  const r = Router();
  r.use(requireAuth);
  const anggota = requireActiveMember("groupId");
  const params = validate({ params: idParam("groupId", "approvalId") });

  r.get("/:groupId/approvals", anggota, validate({ query: daftarApprovalQuery }), async (req, res) => {
    const hasil = await layanan.daftar(ctxDari(req), req.valid.query);
    halaman(res, hasil.data, { nextCursor: hasil.nextCursor, hasMore: hasil.hasMore });
  });
  r.get("/:groupId/approvals/:approvalId", anggota, params, async (req, res) => {
    kirim(res, await layanan.detail(ctxDari(req), req.valid.params.approvalId));
  });
  r.post("/:groupId/approvals/:approvalId/votes", anggota, params, validate({ body: suaraSchema }), idempoten(async (req, tx) => ({
    status: 201,
    body: { data: await layanan.beriSuara(tx, ctxDari(req), req.valid.params.approvalId, req.body.vote) },
  })));

  return r;
}
