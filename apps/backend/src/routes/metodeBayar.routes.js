// Penyambung: layanan metode pembayaran dengan database, kunci enkripsi, dan ledger asli.
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireMember } from "../middlewares/auth.js";
import { buatEnkripsi } from "../utils/enkripsi.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatLayananMetodeBayar } from "../services/metodeBayar.js";
import { buatRouterMetodeAnggota, buatRouterMetodeSaya } from "./metodeBayar.router.js";

const layanan = buatLayananMetodeBayar({
  db: prisma,
  enkripsi: buatEnkripsi({ kunci: env.paymentEncKey }),
  ledger: buatLayananLedger({ db: prisma }),
});
export const metodeSaya = buatRouterMetodeSaya({ layanan, requireAuth });
export const metodeAnggota = buatRouterMetodeAnggota({ layanan, requireAuth, requireMember });
