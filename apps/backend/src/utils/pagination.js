// Pagination berkursor (api-contract 2.5). Murni: tidak mengenal Prisma. Kursor adalah
// JSON base64url berisi posisi di daftar; hanya bentuknya yang diperiksa (tidak
// ditandatangani), karena hak akses dan filter grup tetap ada di query tiap endpoint.
import { HttpError } from "./httpError.js";

const KURSOR_MAKS = 300;

export function kodeKursor(isi) {
  return Buffer.from(JSON.stringify(isi), "utf8").toString("base64url");
}

function kursorTidakValid() {
  return new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [
    { field: "cursor", message: "Kursor tidak valid." },
  ]);
}

// skema: skema zod untuk isi kursor milik endpoint. Kursor yang rusak, terlalu panjang,
// atau berbentuk lain dijawab 400 validation-failed dengan field cursor.
export function bacaKursor(teks, skema) {
  const teksSah = typeof teks === "string" && teks.length > 0 && teks.length <= KURSOR_MAKS;
  if (teksSah === false) throw kursorTidakValid();
  if (/^[A-Za-z0-9_-]+$/.test(teks) === false) throw kursorTidakValid();
  let isi;
  try {
    isi = JSON.parse(Buffer.from(teks, "base64url").toString("utf8"));
  } catch {
    throw kursorTidakValid();
  }
  const hasil = skema.safeParse(isi);
  if (hasil.success === false) throw kursorTidakValid();
  return hasil.data;
}

// ambil({ take, kursor }) mengembalikan paling banyak "take" baris, terbaru lebih dulu,
// yang berada setelah posisi kursor (kursor null untuk halaman pertama). Diminta limit + 1
// baris supaya hasMore diketahui tanpa query hitung. buatKursor(baris) mengembalikan
// posisi baris terakhir halaman. Hasilnya cocok untuk halaman(res, data, hasil).
export async function ambilHalaman({ limit, kursor, skemaKursor, ambil, buatKursor }) {
  if (Number.isInteger(limit) === false || limit < 1) {
    throw new Error("ambilHalaman: limit harus bilangan bulat positif");
  }
  const posisi = kursor === undefined || kursor === null ? null : bacaKursor(kursor, skemaKursor);
  const baris = await ambil({ take: limit + 1, kursor: posisi });
  const hasMore = baris.length > limit;
  const data = hasMore ? baris.slice(0, limit) : baris;
  const nextCursor = hasMore ? kodeKursor(buatKursor(data[data.length - 1])) : null;
  return { data, nextCursor, hasMore };
}
