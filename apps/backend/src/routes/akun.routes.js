// Penyambung: layanan akun dengan database dan konfigurasi asli, dipasang di app.js.
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import { buatLayananAkun } from "../services/akun.js";
import { buatRouterAkun } from "./akun.router.js";

const layanan = buatLayananAkun({ db: prisma, jwtSecret: env.jwtSecret, jwtExpiresIn: env.jwtExpiresIn });
export const { auth: authRouter, me: meRouter } = buatRouterAkun({ layanan, requireAuth });
