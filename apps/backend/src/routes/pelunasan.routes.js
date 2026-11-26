// Penyambung: layanan pelunasan dengan database, ledger, idempotensi, dan pemeriksa akses asli.
import { penyimpananBukti } from "../lib/blob.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireMember } from "../middlewares/auth.js";
import { idempoten } from "../middlewares/idempoten.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatLayananPelunasan } from "../services/pelunasan.js";
import { buatRouterPelunasan } from "./pelunasan.router.js";

export default buatRouterPelunasan({
  layanan: buatLayananPelunasan({ db: prisma, ledger: buatLayananLedger({ db: prisma }), penyimpanan: penyimpananBukti }),
  requireAuth,
  requireMember,
  idempoten,
});
