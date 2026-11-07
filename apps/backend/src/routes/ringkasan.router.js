// Ringkasan tugas saya (api-contract 6.5): GET /api/me/summary. Jalur minimum T1.8: hanya
// approvalsToVote yang nyata; field lain bernilai 0 sampai modulnya ada (notifikasi, consent
// peserta, konfirmasi pelunasan, penawaran item). Pabrik murni: hitung dan requireAuth disuntik.
import { Router } from "express";
import { kirim } from "../utils/respond.js";

export function buatRouterRingkasan({ jumlahPerluSuara, requireAuth }) {
  const r = Router();
  r.use(requireAuth);
  r.get("/summary", async (req, res) => {
    kirim(res, {
      unreadNotifications: 0,
      approvalsToVote: await jumlahPerluSuara(req.user.id),
      sharesToConsent: 0,
      paymentsToConfirm: 0,
      itemsOffered: 0,
    });
  });
  return r;
}
