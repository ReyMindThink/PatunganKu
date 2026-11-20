// Pembatas laju generik berbasis memori proses (K47, satu instance). Jendela geser:
// paling banyak "batas" permintaan dalam setiap rentang "jendelaMs". Murni: jam disuntik
// lewat "sekarang" supaya tes tidak perlu menunggu. Permintaan yang ditolak tidak dihitung,
// jadi menunggu selalu cukup untuk lolos kembali.
import { HttpError } from "../utils/httpError.js";

export function buatPembatas({
  batas,
  jendelaMs,
  kunci = (req) => req.ip ?? "tanpa-ip",
  sekarang = Date.now,
  maksKunci = 10000,
  pesan = "Terlalu banyak permintaan. Coba lagi nanti.",
}) {
  if (Number.isInteger(batas) === false || batas < 1) throw new Error("batas harus bilangan bulat positif");
  if (Number.isFinite(jendelaMs) === false || jendelaMs <= 0) throw new Error("jendelaMs harus lebih dari nol");
  if (Number.isInteger(maksKunci) === false || maksKunci < 1) throw new Error("maksKunci harus bilangan bulat positif");

  const peta = new Map(); // kunci -> waktu permintaan yang lolos, naik; urutan peta = aktivitas terakhir

  const buangKedaluwarsa = (waktu, t) => {
    let i = 0;
    while (i < waktu.length && waktu[i] <= t - jendelaMs) i++;
    if (i > 0) waktu.splice(0, i);
  };

  // Dipanggil saat jumlah kunci melewati batas: buang kunci dengan aktivitas paling lama.
  // Urutan peta adalah urutan aktivitas terakhir, jadi kunci yang sudah kedaluwarsa pasti
  // terbuang lebih dulu daripada yang masih aktif. Penyerang dengan lebih dari maksKunci
  // kunci berbeda dapat menyingkirkan hitungan kunci lain (risiko diterima, K47).
  const kurangiKunci = () => {
    for (const k of peta.keys()) {
      if (peta.size <= maksKunci) break;
      peta.delete(k);
    }
  };

  return function pembatas(req, res, next) {
    const t = sekarang();
    const k = String(kunci(req));
    const waktu = peta.get(k) ?? [];
    buangKedaluwarsa(waktu, t);

    if (waktu.length >= batas) {
      const detik = Math.max(1, Math.ceil((waktu[0] + jendelaMs - t) / 1000));
      res.set("Retry-After", String(detik));
      return next(new HttpError(429, "rate-limited", pesan));
    }

    waktu.push(t);
    peta.delete(k);
    peta.set(k, waktu);
    if (peta.size > maksKunci) kurangiKunci();
    next();
  };
}
