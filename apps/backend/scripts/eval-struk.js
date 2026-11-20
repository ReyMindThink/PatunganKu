// Penilai jalur verifikasi struk (Gemini) pada sampel berlabel.
// Pakai (dari apps/backend):
//   command node scripts/eval-struk.js <folder> <label.csv> [--kirim] [--maks N] [--jeda ms] [--keluar hasil.csv]
// Tanpa --kirim hanya memeriksa label dan berkas: TIDAK ADA foto yang dikirim ke pihak ketiga.
// label.csv berformat: berkas,struk,total (struk = ya atau tidak; total rupiah bulat, kosong bila bukan struk).
import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buatPemverifGemini } from "../src/lib/pemverifGemini.js";
import { detectImageType } from "../src/utils/imageType.js";
import { putuskanStruk } from "../src/utils/keputusanStruk.js";
import { bacaLabel, formatLaporan, hitungMetrik, rencanaEvaluasi } from "../src/utils/evaluasiStruk.js";

const argumen = process.argv.slice(2);
const posisi = [];
const opsi = { kirim: false, maks: 60, jeda: 800, keluar: null };
for (let i = 0; i < argumen.length; i++) {
  if (argumen[i] === "--kirim") opsi.kirim = true;
  else if (argumen[i] === "--maks") opsi.maks = Number(argumen[++i]);
  else if (argumen[i] === "--jeda") opsi.jeda = Number(argumen[++i]);
  else if (argumen[i] === "--keluar") opsi.keluar = argumen[++i];
  else posisi.push(argumen[i]);
}

function berhenti(pesan) {
  console.error(pesan);
  process.exit(1);
}

if ((posisi.length === 2) === false || Number.isInteger(opsi.maks) === false || Number.isFinite(opsi.jeda) === false) {
  berhenti("Pakai: node scripts/eval-struk.js <folder> <label.csv> [--kirim] [--maks N] [--jeda ms] [--keluar hasil.csv]");
}
const [folder, berkasLabel] = posisi;

let teksLabel;
let isiFolder;
try {
  teksLabel = readFileSync(berkasLabel, "utf8");
  isiFolder = readdirSync(folder);
} catch (e) {
  berhenti("Tidak dapat membaca folder atau label: " + e.message);
}

const label = bacaLabel(teksLabel);
if (label.ok === false) berhenti("Label tidak sah:\n- " + label.errors.join("\n- "));
const rencana = rencanaEvaluasi({ labels: label.labels, berkasDiFolder: isiFolder, maks: opsi.maks });
console.log("Label: " + rencana.jumlah + " berkas (" + label.labels.filter((l) => l.isReceipt).length + " struk, " + label.labels.filter((l) => l.isReceipt === false).length + " bukan struk)");
console.log("Foto di folder tanpa label (diabaikan): " + rencana.tanpaLabel.length);
if (rencana.hilang.length > 0) berhenti("Berkas berlabel tidak ada di folder: " + rencana.hilang.join(", "));
if (rencana.terlaluBanyak) berhenti("Jumlah berkas melebihi --maks " + opsi.maks + " (naikkan --maks bila memang disengaja)");
if (opsi.kirim === false) {
  console.log("Mode periksa saja: tidak ada foto yang dikirim. Tambahkan --kirim untuk mengirim " + rencana.jumlah + " foto ke Gemini.");
  process.exit(0);
}

const kunci = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
if (kunci === undefined || kunci.length === 0) berhenti("GEMINI_API_KEY kosong");
const pemverif = buatPemverifGemini({ apiKey: kunci, model, catat: () => {} });
const tunggu = (ms) => new Promise((selesai) => setTimeout(selesai, ms));

console.log("Mengirim " + rencana.jumlah + " foto ke Gemini (" + model + ") satu per satu...");
const baris = [];
for (const l of label.labels) {
  const mulai = Date.now();
  let hasil = null;
  let galat = null;
  try {
    const buffer = readFileSync(join(folder, isiFolder.find((b) => b.toLowerCase() === l.berkas.toLowerCase())));
    const tipe = detectImageType(buffer);
    if (tipe === null) galat = "bukan-gambar-didukung";
    else hasil = await pemverif(buffer, tipe);
  } catch (e) {
    galat = e.code ?? "galat";
  }
  baris.push({ berkas: l.berkas, label: { isReceipt: l.isReceipt, total: l.total }, hasil, galat, ms: Date.now() - mulai });
  console.log((baris.length + "/" + rencana.jumlah).padEnd(7) + l.berkas + ": " + (galat === null ? "ok" : "GALAT " + galat));
  await tunggu(opsi.jeda);
}

console.log("");
console.log(formatLaporan(hitungMetrik(baris), { model }));

if ((opsi.keluar === null) === false) {
  const kepala = "berkas,label_struk,label_total,pred_struk,pred_total,keyakinan,status,alasan,ms,galat";
  const isi = baris.map((b) => {
    const keputusan = b.hasil === null || b.label.isReceipt === false ? null : putuskanStruk({ hasil: b.hasil, nominal: b.label.total });
    return [
      b.berkas,
      b.label.isReceipt ? "ya" : "tidak",
      b.label.total ?? "",
      b.hasil === null ? "" : b.hasil.isReceipt ? "ya" : "tidak",
      b.hasil === null ? "" : b.hasil.total ?? "",
      b.hasil === null ? "" : b.hasil.confidence,
      keputusan === null ? "" : keputusan.status,
      keputusan === null ? "" : keputusan.reason,
      b.ms,
      b.galat ?? "",
    ].join(",");
  });
  writeFileSync(opsi.keluar, [kepala, ...isi].join("\n") + "\n");
  console.log("Hasil per berkas ditulis ke " + opsi.keluar);
}
