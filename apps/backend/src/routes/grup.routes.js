// Penyambung: layanan grup dengan database dan pemeriksa akses asli, dipasang di app.js.
import { prisma } from "../lib/prisma.js";
import { requireActiveMember, requireAuth } from "../middlewares/auth.js";
import { idempoten } from "../middlewares/idempoten.js";
import { buatLayananGrup } from "../services/grup.js";
import { buatRouterGrup } from "./grup.router.js";

export default buatRouterGrup({ layanan: buatLayananGrup({ db: prisma }), requireAuth, requireActiveMember, idempoten });
