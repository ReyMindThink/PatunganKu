// Penyambung: layanan saldo dengan database, ledger, dan pemeriksa akses asli.
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireMember } from "../middlewares/auth.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatLayananSaldo } from "../services/saldoGrup.js";
import { buatRouterSaldoGrup, buatRouterSaldoSaya } from "./saldo.router.js";

const layanan = buatLayananSaldo({ db: prisma, ledger: buatLayananLedger({ db: prisma }) });
export const saldoGrup = buatRouterSaldoGrup({ layanan, requireAuth, requireMember });
export const saldoSaya = buatRouterSaldoSaya({ layanan, requireAuth });
