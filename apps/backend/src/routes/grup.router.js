// Router grup (api-contract 11): /api/groups. Pabrik murni: layanan, requireAuth,
// requireActiveMember, idempoten, dan pembatas disuntik. Semua rute berparameter groupId
// wajib memakai requireActiveMember, dan diuji otomatis lewat introspeksi rute.
import { Router } from "express";
import { GRUP } from "../config/constants.js";
import { buatPembatas } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";
import { kirim } from "../utils/respond.js";
import { buatGrupSchema, gabungSchema } from "../validators/grup.validator.js";

// K32: percobaan memasukkan kode dibatasi per pengguna agar kode tidak dapat ditebak.
export function buatPembatasGrup({ sekarang = Date.now } = {}) {
  return {
    gabung: buatPembatas({
      sekarang,
      batas: GRUP.GABUNG_BATAS,
      jendelaMs: GRUP.GABUNG_JENDELA_MS,
      kunci: (req) => "user:" + req.user.id,
      pesan: "Terlalu banyak percobaan bergabung. Coba lagi nanti.",
    }),
  };
}

export function buatRouterGrup({ layanan, requireAuth, requireActiveMember, idempoten, pembatas = buatPembatasGrup() }) {
  const r = Router();
  r.use(requireAuth);

  r.post("/", validate(buatGrupSchema), idempoten(async (req, tx) => ({
    status: 201,
    body: { data: await layanan.buat(tx, req.user.id, req.body) },
  })));
  r.get("/", async (req, res) => {
    kirim(res, await layanan.daftarSaya(req.user.id));
  });
  r.post("/join", validate(gabungSchema), pembatas.gabung, idempoten(async (req, tx) => ({
    status: 200,
    body: { data: await layanan.gabung(tx, req.user.id, req.body) },
  })));

  r.get("/:groupId", requireActiveMember("groupId"), async (req, res) => {
    kirim(res, await layanan.detail(req.membership.groupId, req.membership));
  });
  r.get("/:groupId/members", requireActiveMember("groupId"), async (req, res) => {
    kirim(res, await layanan.anggota(req.membership.groupId));
  });

  return r;
}
