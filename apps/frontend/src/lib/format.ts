/** 30000 -> "Rp30.000" (tanda minus diabaikan). */
export function formatRupiah(amount: number): string {
  return `Rp${Math.abs(amount).toLocaleString("id-ID")}`;
}

/** 125000 -> "+Rp125.000", -48000 -> "−Rp48.000", 0 -> "Lunas". */
export function formatBalance(amount: number): string {
  if (amount === 0) return "Lunas";
  return `${amount > 0 ? "+" : "−"}${formatRupiah(amount)}`;
}

/** "Trip Jogja - Solo" -> "TJ". */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
}

/** Ringkas daftar anggota: "A, B, C +2 lainnya". */
export function summarizeMembers(members: string[], max = 3): string {
  const shown = members.slice(0, max).join(", ");
  const rest = members.length - max;
  return rest > 0 ? `${shown} +${rest} lainnya` : shown;
}
