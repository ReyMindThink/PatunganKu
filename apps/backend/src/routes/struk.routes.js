// Penyambung: layanan struk dengan database, penyimpanan blob, Gemini, dan pemeriksa akses asli.
import "dotenv/config";
import { STRUK } from "../config/constants.js";
import { prisma } from "../lib/prisma.js";
import { deleteReceipt, readReceiptBuffer, uploadReceipt } from "../lib/blob.js";
import { buatPemverifGemini } from "../lib/pemverifGemini.js";
import { requireActiveMember, requireAuth } from "../middlewares/auth.js";
import { idempoten } from "../middlewares/idempoten.js";
import { buatLayananLedger } from "../services/ledger.js";
import { buatLayananStruk } from "../services/struk.js";
import { buatLayananTransaksi } from "../services/transaksi.js";
import { buatIdempotensi } from "../utils/idempotency.js";
import { buatRouterStruk } from "./struk.router.js";

const transaksi = buatLayananTransaksi({ db: prisma, ledger: buatLayananLedger({ db: prisma }) });
const layanan = buatLayananStruk({
  penyimpanan: { simpan: uploadReceipt, baca: readReceiptBuffer, hapus: deleteReceipt },
  pemverif: buatPemverifGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || "gemini-2.5-flash" }),
  bacaTransaksi: transaksi.bacaDetail,
});
// Verifikasi memanggil Gemini (maks STRUK.GEMINI_TIMEOUT_MS): batas transaksinya lebih panjang dari bawaan.
const idempotenVerifikasi = buatIdempotensi({ db: prisma, opsiTransaksi: { timeout: STRUK.TX_VERIFIKASI_TIMEOUT_MS, maxWait: 5000 } }).idempoten;

export default buatRouterStruk({ layanan, requireAuth, requireActiveMember, idempoten, idempotenVerifikasi });
