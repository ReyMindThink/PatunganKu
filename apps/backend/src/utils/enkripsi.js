// Enkripsi nomor rekening (architecture 6.5): AES-256-GCM dengan kunci dari env
// (PAYMENT_ENC_KEY, base64 dari 32 byte). Murni: kunci dan pembangkit acak disuntik.
// Format simpan: v1.<iv>.<tag>.<teks>, tiap bagian base64. "terikat" (data tambahan yang
// diautentikasi) mengikat teks sandi ke satu baris/pengguna sehingga tidak dapat dipindah.
// Pesan galat tidak pernah memuat teks asli maupun kunci.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMA = "aes-256-gcm";
const BYTE_KUNCI = 32;
const BYTE_IV = 12;
const BYTE_TAG = 16;
const VERSI = "v1";

// Mengembalikan Buffer 32 byte, atau null bila teks bukan base64 baku dari tepat 32 byte.
// "Baku" = hasil encode ulang sama persis dengan teks (menolak spasi, url-safe, tanpa padding).
export function bacaKunci(teks) {
  if ((typeof teks === "string") === false) return null;
  const buf = Buffer.from(teks, "base64");
  if ((buf.length === BYTE_KUNCI) === false) return null;
  if ((buf.toString("base64") === teks) === false) return null;
  return buf;
}

export function buatEnkripsi({ kunci, acak = randomBytes } = {}) {
  const ada = (kunci === undefined || kunci === null) === false;
  const buf = ada ? bacaKunci(kunci) : null;
  if (ada && buf === null) throw new Error("enkripsi: kunci harus base64 dari 32 byte");

  // Dipanggil di awal tiap aksi: tanpa kunci, endpoint menjawab 500 konfigurasi.
  function pastikan() {
    if (buf === null) throw new Error("PAYMENT_ENC_KEY belum diisi");
  }

  function enkripsi(teks, terikat = "") {
    pastikan();
    if ((typeof teks === "string") === false) throw new Error("enkripsi: teks harus string");
    const iv = acak(BYTE_IV);
    const cipher = createCipheriv(ALGORITMA, buf, iv);
    cipher.setAAD(Buffer.from(String(terikat), "utf8"));
    const isi = Buffer.concat([cipher.update(teks, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSI, iv.toString("base64"), tag.toString("base64"), isi.toString("base64")].join(".");
  }

  function dekripsi(simpan, terikat = "") {
    pastikan();
    const bagian = typeof simpan === "string" ? simpan.split(".") : [];
    if ((bagian.length === 4 && bagian[0] === VERSI) === false) throw new Error("dekripsi: format tidak dikenal");
    const iv = Buffer.from(bagian[1], "base64");
    const tag = Buffer.from(bagian[2], "base64");
    if ((iv.length === BYTE_IV && tag.length === BYTE_TAG) === false) throw new Error("dekripsi: format tidak dikenal");
    try {
      const decipher = createDecipheriv(ALGORITMA, buf, iv);
      decipher.setAAD(Buffer.from(String(terikat), "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(bagian[3], "base64")), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("dekripsi: data tidak sah");
    }
  }

  return { pastikan, enkripsi, dekripsi };
}
