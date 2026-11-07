// Penyambung: layanan transaksi dengan database, ledger, dan pemeriksa akses asli.
import { prisma } from "../lib/prisma.js";
import { requireActiveMember, requireAuth } from "../middlewares/auth.js";
import { idempoten } from "../middlewares/idempoten.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatLayananTransaksi } from "../services/transaksi.js";
import { buatRouterTransaksi } from "./transaksi.router.js";

const ledger = buatLayananLedger({ db: prisma });
export default buatRouterTransaksi({ layanan: buatLayananTransaksi({ db: prisma, ledger }), requireAuth, requireActiveMember, idempoten });
