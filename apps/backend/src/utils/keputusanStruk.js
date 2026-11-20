// Keputusan hasil verifikasi struk (api-contract 5.4). Murni. Urutan penting: kegagalan (FAILED)
// didahulukan; isi mirip struk lain (K8) baru dipertimbangkan bila struk lolos semua pemeriksaan.
// Alasan tax-mode-unknown dan arithmetic-mismatch menyusul setelah kontrak AI disepakati.
import { STRUK } from "../config/constants.js";

// hasil: { isReceipt, total, confidence }; nominal: nominal transaksi; duplikatId: id transaksi
// lain di grup yang sidik isinya sama, atau null.
export function putuskanStruk({ hasil, nominal, duplikatId = null }) {
  if (hasil.isReceipt === false) return { status: "FAILED", reason: "not-a-receipt" };
  if (hasil.confidence < STRUK.MIN_CONFIDENCE) return { status: "FAILED", reason: "low-confidence" };
  if (hasil.total === null) return { status: "FAILED", reason: "total-unreadable" };
  if (hasil.total === nominal === false) return { status: "FAILED", reason: "total-mismatch" };
  if (duplikatId === null) return { status: "VERIFIED", reason: "ok" };
  return { status: "NEEDS_REVIEW", reason: "possible-duplicate", warnings: [{ code: "possible-duplicate", existingTransactionId: duplikatId }] };
}
