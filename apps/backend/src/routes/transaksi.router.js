// Router transaksi (api-contract 9.1-9.2): /api/groups/:groupId/transactions. Pabrik murni:
// layanan, requireAuth, requireActiveMember, dan idempoten disuntik. Semua rute memakai
// requireActiveMember (diuji otomatis lewat introspeksi rute) dan semua tulis memakai
// Idempotency-Key. Router dipasang di /api/groups supaya :groupId terbaca di path rute.
import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { halaman, kirim } from "../utils/respond.js";
import { idParam } from "../validators/common.js";
import { buatTransaksiSchema, daftarTransaksiQuery, ubahTransaksiSchema } from "../validators/transaksi.validator.js";

const ctxDari = (req) => ({ userId: req.user.id, groupId: req.membership.groupId, role: req.membership.role });

export function buatRouterTransaksi({ layanan, requireAuth, requireActiveMember, idempoten }) {
  const r = Router();
  r.use(requireAuth);
  const anggota = requireActiveMember("groupId");
  const params = validate({ params: idParam("groupId", "transactionId") });

  r.post("/:groupId/transactions", anggota, validate({ body: buatTransaksiSchema }), idempoten(async (req, tx) => ({
    status: 201,
    body: { data: await layanan.buat(tx, ctxDari(req), req.body) },
  })));
  r.get("/:groupId/transactions", anggota, validate({ query: daftarTransaksiQuery }), async (req, res) => {
    const hasil = await layanan.daftar(ctxDari(req), req.valid.query);
    halaman(res, hasil.data, { nextCursor: hasil.nextCursor, hasMore: hasil.hasMore });
  });
  r.get("/:groupId/transactions/:transactionId", anggota, params, async (req, res) => {
    kirim(res, await layanan.detail(ctxDari(req), req.valid.params.transactionId));
  });
  r.patch("/:groupId/transactions/:transactionId", anggota, params, validate({ body: ubahTransaksiSchema }), idempoten(async (req, tx) => ({
    status: 200,
    body: { data: await layanan.ubah(tx, ctxDari(req), req.valid.params.transactionId, req.body) },
  })));
  r.delete("/:groupId/transactions/:transactionId", anggota, params, idempoten(async (req, tx) => {
    await layanan.hapus(tx, ctxDari(req), req.valid.params.transactionId);
    return { status: 204 };
  }));
  r.post("/:groupId/transactions/:transactionId/submit", anggota, params, idempoten(async (req, tx) => ({
    status: 200,
    body: { data: await layanan.submit(tx, ctxDari(req), req.valid.params.transactionId) },
  })));

  return r;
}
