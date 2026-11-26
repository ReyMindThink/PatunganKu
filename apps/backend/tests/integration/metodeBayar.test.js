// Metode pembayaran di SQL Server nyata (T1.9b-1): router, layanan, ledger, requireMember, dan
// enkripsi asli. Tabel tambah-saja (LedgerEntry, AuditLog) tidak di-UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatTransaksi, buatLedger } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatEnkripsi } from "../../src/utils/enkripsi.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananMetodeBayar } from "../../src/services/metodeBayar.js";
import { buatRouterMetodeAnggota, buatRouterMetodeSaya } from "../../src/routes/metodeBayar.router.js";

const SECRET = "rahasia-integrasi-metode-bayar-yang-cukup-panjang";
const KUNCI = Buffer.alloc(32, 11).toString("base64");
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

describe("metode pembayaran di SQL Server", () => {
  let server;
  let tanpaKunci;
  before(async () => {
    const requireAuth = buatRequireAuth({ secret: SECRET });
    const akses = buatAkses({ db: prisma });
    const ledger = buatLayananLedger({ db: prisma });
    const pasang = (enkripsi) => (app) => {
      const layanan = buatLayananMetodeBayar({ db: prisma, enkripsi, ledger });
      app.use("/api/me", buatRouterMetodeSaya({ layanan, requireAuth }));
      app.use("/api/groups", buatRouterMetodeAnggota({ layanan, requireAuth, requireMember: akses.requireMember }));
    };
    server = await mulaiAplikasi(pasang(buatEnkripsi({ kunci: KUNCI })));
    tanpaKunci = await mulaiAplikasi(pasang(buatEnkripsi({})));
  });
  after(async () => {
    await server.tutup();
    await tanpaKunci.tutup();
    await prisma.$disconnect();
  });

  async function minta(metode, path, user, body, dasar = server) {
    const headers = {};
    if (user) headers.authorization = "Bearer " + token(user.id);
    if ((body === undefined) === false) headers["content-type"] = "application/json";
    const res = await fetch(dasar.url + "/api" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  }
  const bank = (nomor = "1234567890", lain = {}) => ({ kind: "BANK", provider: "BCA", accountNo: nomor, accountName: "Pemilik Tes", ...lain });

  it("tambah, daftar, ubah: nomor tersimpan terenkripsi dan terikat ke pemiliknya, API mengembalikan nomor asli", async () => {
    const u = await buatUser();
    const dibuat = await minta("POST", "/me/payment-methods", u, bank("1234567890"));
    assert.equal(dibuat.status, 201);
    assert.deepEqual(dibuat.body.data, { id: dibuat.body.data.id, kind: "BANK", provider: "BCA", accountName: "Pemilik Tes", accountNo: "1234567890", isActive: true });

    const mentah = await prisma.paymentMethod.findUnique({ where: { id: dibuat.body.data.id } });
    assert.equal(mentah.userId, u.id);
    assert.equal(mentah.accountNo.startsWith("v1."), true);
    assert.equal(mentah.accountNo.includes("1234567890"), false);
    assert.equal(buatEnkripsi({ kunci: KUNCI }).dekripsi(mentah.accountNo, "PaymentMethod:" + u.id), "1234567890");

    const diubah = await minta("PATCH", "/me/payment-methods/" + mentah.id, u, { accountNo: "9876543210", provider: "BNI" });
    assert.equal(diubah.status, 200);
    assert.deepEqual(diubah.body.data, { id: mentah.id, kind: "BANK", provider: "BNI", accountName: "Pemilik Tes", accountNo: "9876543210", isActive: true });
    const daftar = await minta("GET", "/me/payment-methods", u);
    assert.deepEqual(daftar.body.data, [diubah.body.data]);
  });

  it("tunai: hanya kind, nomor dan penyedia null; tunai aktif kedua 409; nonaktif lalu boleh lagi", async () => {
    const u = await buatUser();
    await minta("POST", "/me/payment-methods", u, bank());
    const tunai = await minta("POST", "/me/payment-methods", u, { kind: "CASH" });
    assert.equal(tunai.status, 201);
    assert.deepEqual(tunai.body.data, { id: tunai.body.data.id, kind: "CASH", provider: null, accountName: null, accountNo: null, isActive: true });
    const lagi = await minta("POST", "/me/payment-methods", u, { kind: "CASH" });
    assert.equal(lagi.status, 409);
    assert.equal(lagi.body.code, "invalid-state");
    assert.equal((await minta("DELETE", "/me/payment-methods/" + tunai.body.data.id, u)).status, 204);
    assert.equal((await minta("POST", "/me/payment-methods", u, { kind: "CASH" })).status, 201);
  });

  it("penonaktifan: metode aktif terakhir 409 last-payment-method; satu dari dua 204; ulang 204 tanpa efek; milik orang lain 404", async () => {
    const u = await buatUser();
    const lain = await buatUser();
    const a = (await minta("POST", "/me/payment-methods", u, bank("11111111"))).body.data;
    const terakhir = await minta("DELETE", "/me/payment-methods/" + a.id, u);
    assert.equal(terakhir.status, 409);
    assert.equal(terakhir.body.code, "last-payment-method");
    const b = (await minta("POST", "/me/payment-methods", u, bank("22222222"))).body.data;
    assert.equal((await minta("DELETE", "/me/payment-methods/" + a.id, u)).status, 204);
    assert.equal((await minta("DELETE", "/me/payment-methods/" + a.id, u)).status, 204);
    assert.deepEqual((await minta("GET", "/me/payment-methods", u)).body.data.map((m) => [m.id, m.isActive]), [[a.id, false], [b.id, true]]);
    assert.equal((await minta("DELETE", "/me/payment-methods/" + b.id, u)).status, 409);
    assert.equal((await minta("DELETE", "/me/payment-methods/" + b.id, lain)).status, 404);
    assert.equal((await minta("DELETE", "/me/payment-methods/99999999", u)).status, 404);
    assert.equal((await minta("PATCH", "/me/payment-methods/" + b.id, lain, { provider: "BNI" })).status, 404);
  });

  it("ubah: metode nonaktif dan tunai 409; badan tidak sah 400", async () => {
    const u = await buatUser();
    const a = (await minta("POST", "/me/payment-methods", u, bank("11111111"))).body.data;
    const tunai = (await minta("POST", "/me/payment-methods", u, { kind: "CASH" })).body.data;
    assert.equal((await minta("PATCH", "/me/payment-methods/" + tunai.id, u, { provider: "BNI" })).status, 409);
    await minta("DELETE", "/me/payment-methods/" + a.id, u);
    assert.equal((await minta("PATCH", "/me/payment-methods/" + a.id, u, { provider: "BNI" })).status, 409);
    assert.equal((await minta("PATCH", "/me/payment-methods/" + a.id, u, {})).status, 400);
    assert.equal((await minta("POST", "/me/payment-methods", u, { kind: "BANK" })).status, 400);
  });

  it("batas 10 metode aktif: kesebelas 409; menonaktifkan satu membuka tempat lagi", async () => {
    const u = await buatUser();
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const h = await minta("POST", "/me/payment-methods", u, bank("5555" + i + "5555"));
      assert.equal(h.status, 201, "ke-" + (i + 1));
      ids.push(h.body.data.id);
    }
    assert.equal((await minta("POST", "/me/payment-methods", u, bank("12121212"))).status, 409);
    assert.equal((await minta("DELETE", "/me/payment-methods/" + ids[0], u)).status, 204);
    assert.equal((await minta("POST", "/me/payment-methods", u, bank("12121212"))).status, 201);
  });

  it("audit: satu baris per aksi, tanpa grup, tanpa nomor rekening di mana pun", async () => {
    const u = await buatUser();
    const a = (await minta("POST", "/me/payment-methods", u, bank("1234509876"))).body.data;
    const b = (await minta("POST", "/me/payment-methods", u, bank("6789012345"))).body.data;
    await minta("PATCH", "/me/payment-methods/" + a.id, u, { accountNo: "5555566666" });
    await minta("DELETE", "/me/payment-methods/" + b.id, u);
    await minta("DELETE", "/me/payment-methods/" + a.id, u);
    const baris = await prisma.auditLog.findMany({ where: { actorId: u.id, entity: "PaymentMethod" }, orderBy: { id: "asc" } });
    assert.deepEqual(baris.map((r) => r.action), ["PAYMENT_METHOD_CREATE", "PAYMENT_METHOD_CREATE", "PAYMENT_METHOD_UPDATE", "PAYMENT_METHOD_DEACTIVATE"]);
    assert.deepEqual(baris.map((r) => r.entityId), [a.id, b.id, a.id, b.id]);
    assert.equal(baris.every((r) => r.groupId === null), true);
    const semuaTeks = JSON.stringify(baris);
    for (const nomor of ["1234509876", "6789012345", "5555566666"]) assert.equal(semuaTeks.includes(nomor), false, nomor);
    assert.deepEqual(JSON.parse(baris[2].newValue), { fields: ["accountNo"] });
  });

  it("dua penonaktifan serentak atas dua metode aktif terakhir: tepat satu berhasil, satu 409, satu metode tetap aktif [D: bergantung kunci baris SQL Server]", async () => {
    const u = await buatUser();
    const a = (await minta("POST", "/me/payment-methods", u, bank("11111111"))).body.data;
    const b = (await minta("POST", "/me/payment-methods", u, bank("22222222"))).body.data;
    const hasil = await Promise.all([minta("DELETE", "/me/payment-methods/" + a.id, u), minta("DELETE", "/me/payment-methods/" + b.id, u)]);
    assert.deepEqual(hasil.map((h) => h.status).sort(), [204, 409]);
    assert.equal(await prisma.paymentMethod.count({ where: { userId: u.id, isActive: true } }), 1);
  });

  it("tanpa PAYMENT_ENC_KEY semua endpoint metode menjawab 500 generik tanpa bocoran", async () => {
    const u = await buatUser();
    const grup = await buatGrup(u.id);
    await buatAnggota(grup.id, u.id, { role: "OWNER" });
    for (const [m, p, body] of [["GET", "/me/payment-methods"], ["POST", "/me/payment-methods", bank()], ["GET", "/groups/" + grup.id + "/members/" + u.id + "/payment-methods"]]) {
      const h = await minta(m, p, u, body, tanpaKunci);
      assert.equal(h.status, 500, m + " " + p);
      assert.equal(h.body.code, "internal-error");
      assert.equal(JSON.stringify(h.body).includes("PAYMENT_ENC_KEY"), false);
    }
    assert.equal(await prisma.paymentMethod.count({ where: { userId: u.id } }), 0);
  });

  describe("metode milik anggota lain di grup", () => {
    async function buatRuang(daftar) {
      const user = [];
      for (const _ of daftar) user.push(await buatUser());
      const grup = await buatGrup(user[0].id);
      for (let i = 0; i < daftar.length; i++) await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: daftar[i] });
      const transaksi = await buatTransaksi(grup.id, user[0].id, { amount: 100000 });
      return { user, grup, transaksi, path: (target) => "/groups/" + grup.id + "/members/" + target.id + "/payment-methods" };
    }
    const utang = (r, debitur, kreditur, jumlah) =>
      buatLedger(r.grup.id, { type: "CHARGE", sign: 1, amount: BigInt(jumlah), debtorUserId: debitur.id, creditorUserId: kreditur.id, category: "GROUP", transactionId: r.transaksi.id, createdBy: kreditur.id });

    it("pengutang melihat metode aktif beserta nomor; tanpa utang, kreditur yang melihat pengutang, dan non-anggota 403", async () => {
      const r = await buatRuang(["ACTIVE", "ACTIVE", "ACTIVE"]);
      const [a, b, c] = r.user;
      const luar = await buatUser();
      const bankA = (await minta("POST", "/me/payment-methods", a, bank("1234567890"))).body.data;
      const lama = (await minta("POST", "/me/payment-methods", a, bank("7777777777"))).body.data;
      await minta("DELETE", "/me/payment-methods/" + lama.id, a);
      const tunaiA = (await minta("POST", "/me/payment-methods", a, { kind: "CASH" })).body.data;
      await minta("POST", "/me/payment-methods", b, bank("2222222222"));
      await utang(r, b, a, 30000);

      const dariB = await minta("GET", r.path(a), b);
      assert.equal(dariB.status, 200);
      assert.deepEqual(dariB.body.data, [bankA, tunaiA]);
      assert.equal((await minta("GET", r.path(a), c)).status, 403);
      const dariA = await minta("GET", r.path(b), a);
      assert.equal(dariA.status, 403);
      assert.equal(dariA.body.code, "forbidden");
      assert.equal((await minta("GET", r.path(a), luar)).status, 403);
      assert.equal((await minta("GET", r.path(a), a)).status, 200);
      assert.equal((await minta("GET", r.path(c), b)).status, 403);
    });

    it("mantan anggota (LEFT dan REMOVED) yang berutang masih dapat melihat metode kreditur", async () => {
      const r = await buatRuang(["ACTIVE", "LEFT", "REMOVED"]);
      const [a, b, c] = r.user;
      const m = (await minta("POST", "/me/payment-methods", a, bank("1234567890"))).body.data;
      await utang(r, b, a, 10000);
      await utang(r, c, a, 20000);
      assert.deepEqual((await minta("GET", r.path(a), b)).body.data, [m]);
      assert.deepEqual((await minta("GET", r.path(a), c)).body.data, [m]);
    });

    it("utang yang sudah lunas menutup akses; id tak sah 400", async () => {
      const r = await buatRuang(["ACTIVE", "ACTIVE"]);
      const [a, b] = r.user;
      await minta("POST", "/me/payment-methods", a, bank("1234567890"));
      await utang(r, b, a, 10000);
      const bayar = await prisma.paymentConfirmation.create({ data: { groupId: r.grup.id, senderId: b.id, receiverId: a.id, amount: 10000, methodType: "CASH", status: "CONFIRMED" } });
      await buatLedger(r.grup.id, { type: "SETTLEMENT", sign: -1, amount: 10000n, debtorUserId: b.id, creditorUserId: a.id, paymentId: bayar.id, createdBy: a.id });
      assert.equal((await minta("GET", r.path(a), b)).status, 403);
      assert.equal((await minta("GET", "/groups/" + r.grup.id + "/members/abc/payment-methods", b)).status, 400);
    });
  });
});
