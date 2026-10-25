// Pengaman: tes integrasi hanya boleh berjalan pada database khusus tes.
// Tes menulis data permanen (tabel tambah-saja tidak dapat dibersihkan), jadi
// database kerja seperti patunganku_v2 tidak boleh terkena.
import "dotenv/config";

const nama = process.env.DB_NAME ?? "";
const aman = /_(test|ci)$/.test(nama);
if (aman === false) {
  throw new Error(
    "Tes integrasi menolak berjalan: DB_NAME harus berakhiran _test atau _ci, sekarang: " +
      JSON.stringify(nama),
  );
}
