// Metode pembayaran (api-contract 10.3, T1.9b-1). Nomor rekening disimpan terenkripsi
// (utils/enkripsi.js) dan terikat ke pemiliknya; tidak pernah masuk audit maupun log.
// Pabrik murni: db, enkripsi, dan ledger disuntik.
import { METODE_BAYAR } from "../config/constants.js";
import { HttpError } from "../utils/httpError.js";
import { catatAudit } from "../utils/audit.js";

const terikat = (userId) => "PaymentMethod:" + userId;

export function buatLayananMetodeBayar({ db, enkripsi, ledger }) {
  const objek = (m, accountNo) => ({
    id: m.id,
    kind: m.kind,
    provider: m.provider,
    accountName: m.accountName,
    accountNo,
    isActive: m.isActive,
  });
  const bukaNomor = (m) => (m.accountNo === null ? null : enkripsi.dekripsi(m.accountNo, terikat(m.userId)));
  const tidakAda = () => new HttpError(404, "not-found", "Metode pembayaran tidak ditemukan.");

  // Mengunci semua baris aktif milik pengguna sampai transaksi selesai (update tanpa
  // perubahan nilai menahan kunci di SQL Server) dan mengembalikan jumlahnya.
  async function kunciDanHitung(tx, userId) {
    const { count } = await tx.paymentMethod.updateMany({ where: { userId, isActive: true }, data: { isActive: true } });
    return count;
  }

  async function daftarSaya(userId) {
    enkripsi.pastikan();
    const baris = await db.paymentMethod.findMany({ where: { userId }, orderBy: [{ id: "asc" }] });
    return baris.map((m) => objek(m, bukaNomor(m)));
  }

  async function tambah(userId, body) {
    enkripsi.pastikan();
    return db.$transaction(async (tx) => {
      const aktif = await kunciDanHitung(tx, userId);
      if (aktif >= METODE_BAYAR.AKTIF_MAKS) {
        throw new HttpError(409, "invalid-state", "Batas " + METODE_BAYAR.AKTIF_MAKS + " metode aktif tercapai. Nonaktifkan salah satu dahulu.");
      }
      const tunai = body.kind === "CASH";
      if (tunai) {
        const ada = await tx.paymentMethod.findFirst({ where: { userId, kind: "CASH", isActive: true }, select: { id: true } });
        if (ada) throw new HttpError(409, "invalid-state", "Metode tunai sudah ada.");
      }
      const baris = await tx.paymentMethod.create({
        data: tunai
          ? { userId, kind: "CASH" }
          : { userId, kind: body.kind, provider: body.provider, accountNo: enkripsi.enkripsi(body.accountNo, terikat(userId)), accountName: body.accountName },
      });
      await catatAudit(tx, {
        groupId: null,
        actorId: userId,
        entity: "PaymentMethod",
        entityId: baris.id,
        action: "PAYMENT_METHOD_CREATE",
        newValue: { kind: body.kind, provider: tunai ? null : body.provider },
      });
      return objek(baris, tunai ? null : body.accountNo);
    });
  }

  async function ubah(userId, methodId, body) {
    enkripsi.pastikan();
    return db.$transaction(async (tx) => {
      const lama = await tx.paymentMethod.findFirst({ where: { id: methodId, userId } });
      if (lama === null) throw tidakAda();
      if (lama.kind === "CASH") throw new HttpError(409, "invalid-state", "Metode tunai tidak memiliki data yang dapat diubah.");
      const data = {};
      if ((body.provider === undefined) === false) data.provider = body.provider;
      if ((body.accountName === undefined) === false) data.accountName = body.accountName;
      if ((body.accountNo === undefined) === false) data.accountNo = enkripsi.enkripsi(body.accountNo, terikat(userId));
      // Klaim atomik: metode yang sudah nonaktif (atau dinonaktifkan serentak) tidak ikut berubah.
      const klaim = await tx.paymentMethod.updateMany({ where: { id: methodId, userId, isActive: true }, data });
      if (klaim.count === 0) throw new HttpError(409, "invalid-state", "Metode ini sudah dinonaktifkan.");
      await catatAudit(tx, {
        groupId: null,
        actorId: userId,
        entity: "PaymentMethod",
        entityId: methodId,
        action: "PAYMENT_METHOD_UPDATE",
        newValue: { fields: Object.keys(data).sort() },
      });
      const baru = await tx.paymentMethod.findUnique({ where: { id: methodId } });
      return objek(baru, bukaNomor(baru));
    });
  }

  async function nonaktifkan(userId, methodId) {
    await db.$transaction(async (tx) => {
      const lama = await tx.paymentMethod.findFirst({ where: { id: methodId, userId } });
      if (lama === null) throw tidakAda();
      if (lama.isActive === false) return;
      const aktif = await kunciDanHitung(tx, userId);
      if (aktif <= 1) throw new HttpError(409, "last-payment-method", "Metode aktif terakhir tidak dapat dinonaktifkan.");
      const klaim = await tx.paymentMethod.updateMany({ where: { id: methodId, userId, isActive: true }, data: { isActive: false } });
      if (klaim.count === 0) return;
      await catatAudit(tx, {
        groupId: null,
        actorId: userId,
        entity: "PaymentMethod",
        entityId: methodId,
        action: "PAYMENT_METHOD_DEACTIVATE",
      });
    });
  }

  // Nomor rekening hanya dibuka untuk pemiliknya atau pihak yang berutang kepadanya di grup ini
  // (termasuk mantan anggota); selain itu 403.
  async function metodeAnggota({ userId, groupId }, targetId) {
    enkripsi.pastikan();
    if ((targetId === userId) === false) {
      const saldo = await ledger.saldoPasangan(groupId, userId, targetId);
      if (saldo <= 0) throw new HttpError(403, "forbidden", "Anda tidak berhak melihat metode pembayaran anggota ini.");
    }
    const baris = await db.paymentMethod.findMany({ where: { userId: targetId, isActive: true }, orderBy: [{ id: "asc" }] });
    return baris.map((m) => objek(m, bukaNomor(m)));
  }

  return { daftarSaya, tambah, ubah, nonaktifkan, metodeAnggota };
}
