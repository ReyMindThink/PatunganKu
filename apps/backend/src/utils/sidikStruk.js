// Sidik struk (K8): SHA-256 gambar untuk duplikat identik, dan fingerprint isi (merchant, jam
// sampai menit, total) untuk duplikat mirip. Murni.
import { createHash } from "node:crypto";

export const sha256Hex = (buffer) => createHash("sha256").update(buffer).digest("hex");

// Huruf kecil, tanpa aksen, hanya a-z dan 0-9: "Alfamart  #123" dan "ALFAMART 123" sama.
export function normalisasiMerchant(teks) {
  if (typeof teks === "string" === false) return null;
  const bersih = teks.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
  return bersih.length === 0 ? null : bersih;
}

// null bila salah satu dari merchant, waktu, atau total tidak terbaca: tanpa ketiganya
// kemiripan tidak dapat dinilai.
export function fingerprintStruk({ merchant, purchasedAt, total }) {
  const nama = normalisasiMerchant(merchant);
  const waktuValid = purchasedAt instanceof Date && Number.isNaN(purchasedAt.getTime()) === false;
  if (nama === null || waktuValid === false || Number.isSafeInteger(total) === false || total <= 0) return null;
  const menit = Math.floor(purchasedAt.getTime() / 60000);
  return createHash("sha256").update(nama + "|" + menit + "|" + total).digest("hex");
}
