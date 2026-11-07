// Rentang satu bulan menurut zona Asia/Jakarta (WIB, UTC+7 tanpa DST) untuk filter riwayat (K24).
// Murni. "2026-10" menjadi [2026-09-30T17:00Z, 2026-10-31T17:00Z).
const WIB_MS = 7 * 60 * 60 * 1000;

export function rentangBulanWib(teks) {
  const m = /^(20[0-9]{2})-(0[1-9]|1[0-2])$/.exec(teks);
  if (m === null) throw new Error("bulanWib: format harus YYYY-MM antara 2000 dan 2099");
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  return {
    dari: new Date(Date.UTC(tahun, bulan - 1, 1) - WIB_MS),
    sampai: new Date(Date.UTC(tahun, bulan, 1) - WIB_MS),
  };
}
