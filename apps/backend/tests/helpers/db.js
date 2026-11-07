// Klien Prisma yang sama dengan aplikasi (adapter mssql, driver Node), setelah pengaman.
import "./guard.js";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";

export { prisma };

function aman(nilai) {
  try {
    return typeof nilai === "string" ? nilai : JSON.stringify(nilai);
  } catch {
    return String(nilai);
  }
}

// Gabungan teks galat Prisma dan driver, supaya pesan trigger atau nama CHECK dapat dicari.
export function teksGalat(e) {
  const bagian = [e?.message, e?.code, e?.cause?.message, e?.meta ? aman(e.meta) : ""];
  return bagian.filter(Boolean).join(" | ");
}

// Operasi harus ditolak, dan teks galatnya harus memuat kataKunci (pesan trigger atau
// nama constraint). Hanya "gagal" tidak cukup: kegagalan lain akan lolos diam-diam.
export async function harusDitolak(operasi, kataKunci, label = "operasi") {
  let galat = null;
  try {
    await operasi();
  } catch (e) {
    galat = e;
  }
  assert.ok(galat, label + " seharusnya ditolak, tetapi diterima");
  const teks = teksGalat(galat);
  assert.ok(
    teks.includes(kataKunci),
    label + ": teks galat tidak memuat " + JSON.stringify(kataKunci) + ". Teks galat: " + teks,
  );
  return galat;
}
