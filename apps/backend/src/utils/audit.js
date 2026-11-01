// Pembantu AuditLog (architecture K19): menulis satu baris riwayat dalam transaksi database
// yang sama dengan aksinya. Menerima klien transaksi (tx), bukan klien utama, sehingga aksi
// dan catatannya ter-commit atau batal bersama. Salah pakai oleh pemanggil adalah galat
// pemrogram (Error biasa), bukan HttpError: validasi masukan pengguna ada di validator.
import { AUDIT_ALASAN_WAJIB } from "../config/constants.js";

const POLA_ENTITY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const POLA_ACTION = /^[A-Z][A-Z0-9_]{0,39}$/;
const NILAI_MAKS = 10000;
const ALASAN_MAKS = 500;
const INT_MAKS = 2147483647;

const galat = (pesan) => new Error("catatAudit: " + pesan);
const idSah = (n) => Number.isInteger(n) && n >= 1 && n <= INT_MAKS;

// Id yang wajib ditulis eksplisit: bilangan bulat positif atau null (undefined ditolak).
function idEksplisit(nama, nilai) {
  if (nilai === null || idSah(nilai)) return nilai;
  throw galat(nama + " harus bilangan bulat positif atau null (tulis eksplisit)");
}

function idOpsional(nama, nilai) {
  return nilai === undefined ? null : idEksplisit(nama, nilai);
}

function teksSah(nama, nilai, pola) {
  if (typeof nilai === "string" && pola.test(nilai)) return nilai;
  throw galat(nama + " tidak sesuai format");
}

// ISJSON di SQL Server hanya menerima objek atau array, jadi skalar ditolak di sini.
function nilaiJson(nama, nilai) {
  if (nilai === undefined || nilai === null) return null;
  const jenis = Object.prototype.toString.call(nilai);
  if (jenis === "[object Object]" || jenis === "[object Array]") {
    let teks;
    try {
      teks = JSON.stringify(nilai);
    } catch {
      throw galat(nama + " tidak dapat diserialisasi ke JSON");
    }
    if (typeof teks === "string" && teks.length <= NILAI_MAKS) return teks;
    throw galat(nama + " kosong atau lebih dari " + NILAI_MAKS + " karakter");
  }
  throw galat(nama + " harus objek atau array");
}

function bacaAlasan(action, reason) {
  const jenisSah = reason === undefined || reason === null || typeof reason === "string";
  if (jenisSah === false) throw galat("reason harus teks");
  const bersih = typeof reason === "string" ? reason.trim() : "";
  if (bersih.length > ALASAN_MAKS) throw galat("reason lebih dari " + ALASAN_MAKS + " karakter");
  if (bersih === "" && AUDIT_ALASAN_WAJIB.includes(action)) throw galat("reason wajib untuk " + action);
  return bersih === "" ? null : bersih;
}

// Mengembalikan { id }. groupId dan actorId wajib ditulis (null = tanpa grup / sistem).
export async function catatAudit(tx, { groupId, actorId, transactionId, entity, entityId, action, oldValue, newValue, reason } = {}) {
  const punyaCreate = typeof tx?.auditLog?.create === "function";
  if (punyaCreate === false) throw galat("argumen pertama harus klien transaksi (tx)");
  const data = {
    groupId: idEksplisit("groupId", groupId),
    actorId: idEksplisit("actorId", actorId),
    transactionId: idOpsional("transactionId", transactionId),
    entity: teksSah("entity", entity, POLA_ENTITY),
    entityId: idOpsional("entityId", entityId),
    action: teksSah("action", action, POLA_ACTION),
    oldValue: nilaiJson("oldValue", oldValue),
    newValue: nilaiJson("newValue", newValue),
    reason: bacaAlasan(action, reason),
  };
  const baris = await tx.auditLog.create({ data, select: { id: true } });
  return { id: baris.id };
}
