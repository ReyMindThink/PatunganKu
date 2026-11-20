// Penilaian jalur verifikasi struk pada sampel berlabel. Murni: tanpa jaringan dan tanpa berkas.
// Hasil bukan "akurasi model tim": hanya ukuran jalur yang dipakai backend pada sampel kecil.
import { STRUK } from "../config/constants.js";
import { putuskanStruk } from "./keputusanStruk.js";

const HEADER = "berkas,struk,total";
const EKSTENSI_GAMBAR = /\.(jpe?g|png|webp)$/i;

// CSV sederhana tanpa tanda kutip: berkas,struk,total. struk = ya atau tidak.
// Struk "ya" wajib total bilangan bulat rupiah positif tanpa pemisah; "tidak" wajib total kosong.
export function bacaLabel(teks) {
  const baris = teks.replace(/\r/g, "").split("\n").map((b) => b.trim()).filter((b) => b.length > 0);
  if (baris.length === 0 || (baris[0].toLowerCase() === HEADER) === false) {
    return { ok: false, labels: [], errors: ["baris pertama harus: " + HEADER] };
  }
  const errors = [];
  const labels = [];
  const terlihat = new Set();
  for (let i = 1; i < baris.length; i++) {
    const nomor = i + 1;
    const bagian = baris[i].split(",").map((b) => b.trim());
    if ((bagian.length === 3) === false) {
      errors.push("baris " + nomor + ": harus 3 kolom");
      continue;
    }
    const [berkas, struk, total] = bagian;
    if (berkas.length === 0 || berkas.includes("/") || berkas.includes("\\")) {
      errors.push("baris " + nomor + ": nama berkas kosong atau memuat garis miring");
      continue;
    }
    const kunci = berkas.toLowerCase();
    if (terlihat.has(kunci)) {
      errors.push("baris " + nomor + ": berkas ganda " + berkas);
      continue;
    }
    terlihat.add(kunci);
    const nilai = struk.toLowerCase();
    if (nilai === "ya") {
      if (/^[1-9][0-9]*$/.test(total) === false || Number(total) > STRUK.TOTAL_MAKS) {
        errors.push("baris " + nomor + ": total struk harus bilangan bulat rupiah positif tanpa pemisah");
        continue;
      }
      labels.push({ berkas, isReceipt: true, total: Number(total) });
    } else if (nilai === "tidak") {
      if (total.length > 0) {
        errors.push("baris " + nomor + ": total harus kosong bila bukan struk");
        continue;
      }
      labels.push({ berkas, isReceipt: false, total: null });
    } else {
      errors.push("baris " + nomor + ": kolom struk harus ya atau tidak");
    }
  }
  if (labels.length === 0 && errors.length === 0) errors.push("tidak ada baris data");
  return { ok: errors.length === 0, labels, errors };
}

// Mencocokkan label dengan isi folder (nama berkas saja). Foto tanpa label hanya dilaporkan.
export function rencanaEvaluasi({ labels, berkasDiFolder, maks }) {
  const ada = new Set(berkasDiFolder.map((b) => b.toLowerCase()));
  const hilang = labels.filter((l) => ada.has(l.berkas.toLowerCase()) === false).map((l) => l.berkas);
  const berlabel = new Set(labels.map((l) => l.berkas.toLowerCase()));
  const tanpaLabel = berkasDiFolder.filter((b) => EKSTENSI_GAMBAR.test(b) && berlabel.has(b.toLowerCase()) === false);
  const terlaluBanyak = labels.length > maks;
  return {
    ok: labels.length > 0 && hilang.length === 0 && terlaluBanyak === false,
    jumlah: labels.length,
    hilang,
    tanpaLabel,
    terlaluBanyak,
  };
}

// Selang kepercayaan Wilson 95% untuk proporsi k dari n; null bila n = 0.
export function selangWilson(k, n, z = 1.96) {
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const pusat = (p + z2 / (2 * n)) / (1 + z2 / n);
  const setengah = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, pusat - setengah), Math.min(1, pusat + setengah)];
}

function rasio(k, n) {
  return n === 0 ? null : k / n;
}

function median(angka) {
  if (angka.length === 0) return null;
  const urut = [...angka].sort((a, b) => a - b);
  const tengah = Math.floor(urut.length / 2);
  return urut.length % 2 === 1 ? urut[tengah] : Math.round((urut[tengah - 1] + urut[tengah]) / 2);
}

// baris: [{ berkas, label: { isReceipt, total }, hasil: { isReceipt, total, confidence } atau null,
// galat: string atau null, ms: bilangan atau null }]. Baris bergalat tidak ikut dinilai.
export function hitungMetrik(baris) {
  const dinilai = baris.filter((b) => b.galat === null && (b.hasil === null) === false);
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  let totalTepat = 0;
  let totalKosong = 0;
  let totalSalah = 0;
  let jumlahStruk = 0;
  let lolos = 0;
  const alasan = {};
  for (const b of dinilai) {
    if (b.label.isReceipt) {
      jumlahStruk += 1;
      if (b.hasil.isReceipt) tp += 1;
      else fn += 1;
      if (b.hasil.total === null) totalKosong += 1;
      else if (b.hasil.total === b.label.total) totalTepat += 1;
      else totalSalah += 1;
      const keputusan = putuskanStruk({ hasil: b.hasil, nominal: b.label.total });
      if (keputusan.status === "VERIFIED") lolos += 1;
      alasan[keputusan.reason] = (alasan[keputusan.reason] ?? 0) + 1;
    } else if (b.hasil.isReceipt) {
      fp += 1;
    } else {
      tn += 1;
    }
  }
  const benar = tp + tn;
  const ms = dinilai.filter((b) => typeof b.ms === "number").map((b) => b.ms);
  const keyakinan = dinilai.map((b) => b.hasil.confidence);
  return {
    jumlah: baris.length,
    galat: baris.length - dinilai.length,
    dinilai: dinilai.length,
    isReceipt: {
      tp,
      fn,
      fp,
      tn,
      akurasi: rasio(benar, dinilai.length),
      selangAkurasi: selangWilson(benar, dinilai.length),
      presisi: rasio(tp, tp + fp),
      recall: rasio(tp, tp + fn),
    },
    total: {
      jumlahStruk,
      tepat: totalTepat,
      kosong: totalKosong,
      salah: totalSalah,
      rasioTepat: rasio(totalTepat, jumlahStruk),
      selang: selangWilson(totalTepat, jumlahStruk),
    },
    keputusan: { lolos, dari: jumlahStruk, rasioLolos: rasio(lolos, jumlahStruk), alasan },
    rataKeyakinan: keyakinan.length === 0 ? null : keyakinan.reduce((a, b) => a + b, 0) / keyakinan.length,
    waktu: { medianMs: median(ms), maksMs: ms.length === 0 ? null : Math.max(...ms) },
  };
}

function persen(x) {
  return x === null ? "-" : (x * 100).toFixed(1).replace(".", ",") + "%";
}

function selangTeks(s) {
  return s === null ? "-" : persen(s[0]) + " sampai " + persen(s[1]);
}

export function formatLaporan(m, { model = "tidak diketahui" } = {}) {
  const alasan = Object.keys(m.keputusan.alasan).sort().map((k) => k + "=" + m.keputusan.alasan[k]).join(", ");
  return [
    "Evaluasi jalur verifikasi struk (sampel kecil; BUKAN akurasi model tim)",
    "Model: " + model + " | berkas: " + m.jumlah + ", dinilai: " + m.dinilai + ", galat panggilan: " + m.galat + " (tidak ikut dinilai)",
    "isReceipt: akurasi " + persen(m.isReceipt.akurasi) + " (selang 95%: " + selangTeks(m.isReceipt.selangAkurasi) + "); TP " + m.isReceipt.tp + ", FN " + m.isReceipt.fn + ", FP " + m.isReceipt.fp + ", TN " + m.isReceipt.tn + "; presisi " + persen(m.isReceipt.presisi) + ", recall " + persen(m.isReceipt.recall),
    "Total struk: tepat " + m.total.tepat + " dari " + m.total.jumlahStruk + " (" + persen(m.total.rasioTepat) + ", selang 95%: " + selangTeks(m.total.selang) + "); kosong " + m.total.kosong + ", salah " + m.total.salah,
    "Keputusan akhir pada struk berlabel: lolos " + m.keputusan.lolos + " dari " + m.keputusan.dari + " (" + persen(m.keputusan.rasioLolos) + "); alasan: " + (alasan.length === 0 ? "-" : alasan),
    "Waktu panggilan: median " + (m.waktu.medianMs === null ? "-" : m.waktu.medianMs + " ms") + ", maksimum " + (m.waktu.maksMs === null ? "-" : m.waktu.maksMs + " ms"),
    "Catatan: sampel kecil, selang kepercayaan lebar; panggilan bergalat dikeluarkan sehingga dapat membuat angka tampak lebih baik.",
  ].join("\n");
}
