// Router akun (api-contract 14): /api/auth (daftar, masuk) dan /api/me (profil, password).
// Pabrik murni: layanan, requireAuth, dan pembatas disuntik. Endpoint ini tidak memakai
// Idempotency-Key (14.1). Pembatas laju: K47 dan api-contract 14.5.
import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { buatPembatas } from "../middlewares/rateLimit.js";
import { dibuat, kirim } from "../utils/respond.js";
import { registerSchema, loginSchema, ubahProfilSchema, gantiPasswordSchema } from "../validators/auth.validator.js";

const MENIT = 60 * 1000;

// passwordAkun adalah pembatas bersama untuk aksi akun sensitif (ganti password; ganti
// email dan hapus akun menyusul memakai instans yang sama).
export function buatPembatasAkun({ sekarang = Date.now } = {}) {
  const dasar = { sekarang, pesan: "Terlalu banyak percobaan. Coba lagi nanti." };
  return {
    daftar: buatPembatas({ ...dasar, batas: 10, jendelaMs: 60 * MENIT }),
    loginIp: buatPembatas({ ...dasar, batas: 50, jendelaMs: 15 * MENIT }),
    loginPasangan: buatPembatas({ ...dasar, batas: 10, jendelaMs: 15 * MENIT, kunci: (req) => req.ip + "|" + req.body.email }),
    passwordAkun: buatPembatas({ ...dasar, batas: 5, jendelaMs: 15 * MENIT, kunci: (req) => "user:" + req.user.id }),
  };
}

export function buatRouterAkun({ layanan, requireAuth, pembatas = buatPembatasAkun() }) {
  const auth = Router();
  auth.post("/register", pembatas.daftar, validate(registerSchema), async (req, res) => {
    dibuat(res, await layanan.daftar(req.body, { ip: req.ip }));
  });
  auth.post("/login", pembatas.loginIp, validate(loginSchema), pembatas.loginPasangan, async (req, res) => {
    kirim(res, await layanan.masuk(req.body));
  });

  const me = Router();
  me.use(requireAuth);
  me.get("/", async (req, res) => {
    kirim(res, await layanan.profil(req.user.id));
  });
  me.patch("/", validate(ubahProfilSchema), async (req, res) => {
    kirim(res, await layanan.ubahProfil(req.user.id, req.body, { ip: req.ip }));
  });
  me.post("/password", validate(gantiPasswordSchema), pembatas.passwordAkun, async (req, res) => {
    kirim(res, await layanan.gantiPassword(req.user.id, req.body, { ip: req.ip }));
  });

  return { auth, me };
}
