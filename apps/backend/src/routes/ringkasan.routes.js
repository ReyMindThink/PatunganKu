// Penyambung: ringkasan tugas dengan database dan autentikasi asli.
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middlewares/auth.js";
import { buatLayananApproval } from "../services/approval.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatRouterRingkasan } from "./ringkasan.router.js";

const approval = buatLayananApproval({ db: prisma, ledger: buatLayananLedger({ db: prisma }) });
export default buatRouterRingkasan({ jumlahPerluSuara: approval.jumlahPerluSuara, requireAuth });
