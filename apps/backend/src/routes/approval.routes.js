// Penyambung: layanan persetujuan dengan database, ledger, dan pemeriksa akses asli.
import { prisma } from "../lib/prisma.js";
import { requireActiveMember, requireAuth } from "../middlewares/auth.js";
import { idempoten } from "../middlewares/idempoten.js";
import { buatLayananApproval } from "../services/approval.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatRouterApproval } from "./approval.router.js";

const ledger = buatLayananLedger({ db: prisma });
export default buatRouterApproval({ layanan: buatLayananApproval({ db: prisma, ledger }), requireAuth, requireActiveMember, idempoten });
