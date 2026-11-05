// Aturan akses satu transaksi, dipakai bersama oleh layanan transaksi dan struk supaya tidak ada
// dua salinan logika otorisasi. DRAFT hanya terlihat penalangnya (orang lain 404). Aksi tulis oleh
// bukan penalang pada transaksi yang bukan DRAFT: 403. "pilih" adalah select Prisma pemanggil.
import { HttpError } from "./httpError.js";

export async function muatTransaksi(klien, ctx, transactionId, { tulis = false, pilih }) {
  const t = await klien.transaction.findFirst({ where: { id: transactionId, groupId: ctx.groupId }, select: pilih });
  if (t === null) throw new HttpError(404, "not-found", "Transaksi tidak ditemukan.");
  const penalang = t.payerId === ctx.userId;
  if (t.status === "DRAFT" && penalang === false) throw new HttpError(404, "not-found", "Transaksi tidak ditemukan.");
  if (tulis && penalang === false) throw new HttpError(403, "forbidden", "Hanya penalang yang dapat mengubah transaksi ini.");
  return t;
}
