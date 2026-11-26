// catatAudit di SQL Server nyata: atomik dengan aksinya (batal bersama), lewat pembungkus
// idempotensi (replay tidak menulis dua kali), dan nilai JSON tersimpan utuh. AuditLog
// tambah-saja: tes ini tidak pernah UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, teksGalat } from "../helpers/db.js";
import { buatAnggota, buatGrup, buatUser } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { catatAudit } from "../../src/utils/audit.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";

const { idempoten } = buatIdempotensi({ db: prisma });
const sebagai = (req, res, next) => {
  req.user = { id: Number(req.headers["x-user"]) };
  next();
};
const tulis = (tx, s, deskripsi) =>
  tx.transaction.create({ data: { groupId: s.grup.id, payerId: s.pemilik.id, description: deskripsi, amount: 70000, status: "ACTIVE" } });
const audit = (tx, s, tambahan = {}) =>
  catatAudit(tx, { groupId: s.grup.id, actorId: s.pemilik.id, entity: "Transaction", action: "REVISE", reason: "uji atomik", ...tambahan });

describe("catatAudit di SQL Server", () => {
  let server;
  before(async () => {
    server = await mulaiAplikasi((app) =>
      app.post("/g/:groupId/aksi", sebagai, idempoten(async (req, tx) => {
        const s = { grup: { id: Number(req.params.groupId) }, pemilik: { id: req.user.id } };
        const t = await tulis(tx, s, req.body.deskripsi);
        await audit(tx, s, { transactionId: t.id, entityId: t.id });
        return { status: 201, body: { data: { id: t.id } } };
      })),
    );
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function siapkan() {
    const pemilik = await buatUser();
    const grup = await buatGrup(pemilik.id);
    await buatAnggota(grup.id, pemilik.id, { role: "OWNER" });
    return { pemilik, grup, deskripsi: "audit-" + randomUUID() };
  }
  const jumlahTransaksi = (s) => prisma.transaction.count({ where: { groupId: s.grup.id, description: s.deskripsi } });
  const jumlahAudit = (s) => prisma.auditLog.count({ where: { groupId: s.grup.id } });

  it("aksi gagal sesudah audit: transaksi dan audit batal bersama; tanpa gagal: keduanya tersimpan", async () => {
    const s = await siapkan();
    await assert.rejects(
      () => prisma.$transaction(async (tx) => {
        await tulis(tx, s, s.deskripsi);
        await audit(tx, s);
        throw new Error("gagal sesudah audit");
      }),
      /gagal sesudah audit/,
    );
    assert.equal(await jumlahTransaksi(s), 0);
    assert.equal(await jumlahAudit(s), 0);
    await prisma.$transaction(async (tx) => {
      const t = await tulis(tx, s, s.deskripsi);
      await audit(tx, s, { transactionId: t.id, entityId: t.id });
    });
    assert.equal(await jumlahTransaksi(s), 1);
    assert.equal(await jumlahAudit(s), 1);
  });

  it("audit gagal (grup tidak ada): penulisan transaksi sebelumnya ikut batal", async () => {
    const s = await siapkan();
    let galat = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tulis(tx, s, s.deskripsi);
        await audit(tx, s, { groupId: 2147483647 });
      });
    } catch (e) {
      galat = e;
    }
    assert.ok(galat, "seharusnya gagal");
    assert.match(teksGalat(galat), /foreign key|P2003/i);
    assert.equal(await jumlahTransaksi(s), 0);
  });

  it("lewat idempoten: aksi, transaksi, dan audit sekali; replay tidak menulis baris kedua", async () => {
    const s = await siapkan();
    const key = randomUUID();
    const kirim = async () => {
      const res = await fetch(server.url + "/g/" + s.grup.id + "/aksi", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key, "x-user": String(s.pemilik.id) },
        body: JSON.stringify({ deskripsi: s.deskripsi }),
      });
      return { res, body: await res.json() };
    };
    const a = await kirim();
    const b = await kirim();
    assert.equal(a.res.status, 201);
    assert.equal(b.res.headers.get("idempotent-replay"), "true");
    assert.deepEqual(b.body, a.body);
    assert.equal(await jumlahTransaksi(s), 1);
    assert.equal(await jumlahAudit(s), 1);
    const baris = await prisma.auditLog.findFirst({ where: { groupId: s.grup.id } });
    assert.equal(baris.transactionId, a.body.data.id);
    assert.equal(baris.actorId, s.pemilik.id);
  });

  it("kolom opsional dan nilai JSON (objek, array, Unicode) tersimpan utuh; aktor sistem null", async () => {
    const s = await siapkan();
    const lama = { nominal: 70000, catatan: "Rp 70.000 \u2014 kopi \u2615" };
    const baru = [{ userId: s.pemilik.id, bagian: 23334 }, { userId: 2, bagian: 23333 }];
    const { id } = await prisma.$transaction((tx) =>
      catatAudit(tx, { groupId: s.grup.id, actorId: null, entity: "ItemClaim", action: "HOLD_EXPIRED", oldValue: lama, newValue: baru }),
    );
    const sistem = await prisma.auditLog.findUnique({ where: { id } });
    assert.equal(sistem.actorId, null);
    assert.equal(sistem.transactionId, null);
    assert.equal(sistem.entityId, null);
    assert.equal(sistem.reason, null);
    assert.deepEqual(JSON.parse(sistem.oldValue), lama);
    assert.deepEqual(JSON.parse(sistem.newValue), baru);
    const { id: kedua } = await prisma.$transaction((tx) => audit(tx, s, { reason: "alasan \u2713" }));
    const polos = await prisma.auditLog.findUnique({ where: { id: kedua } });
    assert.equal(polos.oldValue, null);
    assert.equal(polos.newValue, null);
    assert.equal(polos.reason, "alasan \u2713");
  });
});
