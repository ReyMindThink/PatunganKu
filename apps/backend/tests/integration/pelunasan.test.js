// Pelunasan tunai di SQL Server nyata (T1.9b-2a): router, layanan, ledger, idempotensi, requireMember,
// dan kunci baris Group asli. Tabel tambah-saja (LedgerEntry, AuditLog) tidak di-UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatTransaksi, buatLedger } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananPelunasan } from "../../src/services/pelunasan.js";
import { buatRouterPelunasan } from "../../src/routes/pelunasan.router.js";

const SECRET = "rahasia-integrasi-pelunasan-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

describe("pelunasan tunai di SQL Server", () => {
  let server;
  const ledger = buatLayananLedger({ db: prisma });
  before(async () => {
    const layanan = buatLayananPelunasan({ db: prisma, ledger });
    const router = buatRouterPelunasan({
      layanan,
      requireAuth: buatRequireAuth({ secret: SECRET }),
      requireMember: buatAkses({ db: prisma }).requireMember,
      idempoten: buatIdempotensi({ db: prisma }).idempoten,
    });
    server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  // kunci: undefined = buat UUID baru untuk POST kirim dan konfirmasi; false = tanpa header; string = pakai itu.
  async function minta(metode, path, user, { body, kunci } = {}) {
    const headers = {};
    if (user) headers.authorization = "Bearer " + token(user.id);
    if ((body === undefined) === false) headers["content-type"] = "application/json";
    const perluKunci = metode === "POST" && (path.endsWith("/payments") || path.endsWith("/confirm"));
    if (perluKunci && (kunci === false) === false) headers["idempotency-key"] = typeof kunci === "string" ? kunci : randomUUID();
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks), ulang: res.headers.get("idempotent-replay") };
  }

  // Ruang: pengguna 0 = OWNER ACTIVE, sisanya MEMBER dengan status yang diberi.
  async function ruang(daftar) {
    const user = [];
    for (let i = 0; i < daftar.length; i++) user.push(await buatUser({ name: "Orang " + i }));
    const grup = await buatGrup(user[0].id);
    for (let i = 0; i < daftar.length; i++) await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: daftar[i] });
    const transaksi = await buatTransaksi(grup.id, user[0].id, { amount: 100000 });
    return { user, grup, transaksi, g: "/" + grup.id + "/payments" };
  }
  const utang = (r, debitur, kreditur, jumlah) =>
    buatLedger(r.grup.id, { type: "CHARGE", sign: 1, amount: BigInt(jumlah), debtorUserId: debitur.id, creditorUserId: kreditur.id, category: "GROUP", transactionId: r.transaksi.id, createdBy: kreditur.id });
  const saldo = (r, a, b) => ledger.saldoPasangan(r.grup.id, a.id, b.id);
  const kirim = (r, dari, ke, amount, tambah = {}) => minta("POST", r.g, dari, { body: { receiverId: ke.id, amount, methodType: "CASH", ...tambah } });
  const settlement = (r) => prisma.ledgerEntry.findMany({ where: { groupId: r.grup.id, type: "SETTLEMENT" }, orderBy: { id: "asc" } });
  const audit = (r) => prisma.auditLog.findMany({ where: { groupId: r.grup.id, entity: "PaymentConfirmation" }, orderBy: { id: "asc" } });

  it("alur lengkap: kirim, lihat, konfirmasi menulis satu SETTLEMENT dan mengurangi saldo; audit atomik", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const dibuat = await kirim(r, b, a, 10000, { note: "tunai" });
    assert.equal(dibuat.status, 201);
    const p = dibuat.body.data;
    assert.deepEqual({ ...p, createdAt: typeof p.createdAt }, {
      id: p.id, groupId: r.grup.id, sender: { kind: "USER", id: b.id, name: "Orang 1" }, receiver: { kind: "USER", id: a.id, name: "Orang 0" },
      amount: 10000, methodType: "CASH", method: null, note: "tunai", hasProof: false, status: "PENDING", rejectReason: null,
      createdAt: "string", decidedAt: null, cancelledAt: null,
    });
    assert.equal(await saldo(r, b, a), 30000);
    assert.deepEqual((await minta("GET", r.g + "/" + p.id, a)).body.data, p);
    assert.deepEqual((await minta("GET", r.g + "/" + p.id, b)).body.data, p);
    assert.deepEqual((await minta("GET", r.g + "?role=received", a)).body.data.map((x) => x.id), [p.id]);
    assert.deepEqual((await minta("GET", r.g + "?role=sent", b)).body.data.map((x) => x.id), [p.id]);
    assert.deepEqual((await minta("GET", r.g + "?role=sent", a)).body.data, []);

    const konfirmasi = await minta("POST", r.g + "/" + p.id + "/confirm", a);
    assert.equal(konfirmasi.status, 200);
    assert.equal(konfirmasi.body.data.status, "CONFIRMED");
    assert.equal(typeof konfirmasi.body.data.decidedAt, "string");
    assert.equal(await saldo(r, b, a), 20000);
    const s = await settlement(r);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].sign, s[0].amount, s[0].debtorUserId, s[0].creditorUserId, s[0].paymentId, s[0].createdBy, s[0].transactionId], [-1, 10000n, b.id, a.id, p.id, a.id, null]);
    const log = await audit(r);
    assert.deepEqual(log.map((x) => [x.action, x.actorId, x.entityId]), [["PAYMENT_SUBMIT", b.id, p.id], ["PAYMENT_CONFIRM", a.id, p.id]]);
  });

  it("acceptance K25: A menanggung 50000 ke B dan B 20000 ke A: saldo 30000; 30001 ditolak 409; 30000 lunas menjadi nol; sesudahnya 409", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 50000);
    await utang(r, a, b, 20000);
    assert.equal(await saldo(r, b, a), 30000);
    const lebih = await kirim(r, b, a, 30001);
    assert.equal(lebih.status, 409);
    assert.equal(lebih.body.code, "amount-exceeds-debt");
    assert.equal(lebih.body.payable, 30000);
    const pas = await kirim(r, b, a, 30000);
    assert.equal(pas.status, 201);
    assert.equal((await minta("POST", r.g + "/" + pas.body.data.id + "/confirm", a)).status, 200);
    assert.equal(await saldo(r, b, a), 0);
    const lagi = await kirim(r, b, a, 1);
    assert.equal(lagi.status, 409);
    assert.equal(lagi.body.code, "amount-exceeds-debt");
    assert.equal(lagi.body.payable, 0);
    const sebaliknya = await kirim(r, a, b, 1);
    assert.equal(sebaliknya.status, 409);
  });

  it("pelunasan PENDING mengurangi nominal yang boleh diajukan (contoh kontrak 10.4); batal membebaskannya", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const satu = await kirim(r, b, a, 10000);
    assert.equal(satu.status, 201);
    const ditolak = await kirim(r, b, a, 25000);
    assert.equal(ditolak.status, 409);
    assert.equal(ditolak.body.payable, 20000);
    assert.equal((await kirim(r, b, a, 20000)).status, 201);
    assert.equal((await kirim(r, b, a, 1)).status, 409);
    const batal = await minta("POST", r.g + "/" + satu.body.data.id + "/cancel", b);
    assert.equal(batal.status, 200);
    assert.equal(batal.body.data.status, "CANCELLED");
    assert.equal(typeof batal.body.data.cancelledAt, "string");
    assert.equal((await kirim(r, b, a, 10000)).status, 201);
  });

  it("cek ulang saat konfirmasi: saldo turun sejak pengajuan menjadi 409, pelunasan tetap PENDING, tanpa SETTLEMENT dan tanpa audit konfirmasi", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const p = (await kirim(r, b, a, 30000)).body.data;
    await utang(r, a, b, 20000);
    const gagal = await minta("POST", r.g + "/" + p.id + "/confirm", a);
    assert.equal(gagal.status, 409);
    assert.equal(gagal.body.code, "amount-exceeds-debt");
    assert.equal(gagal.body.payable, 10000);
    assert.equal((await minta("GET", r.g + "/" + p.id, a)).body.data.status, "PENDING");
    assert.equal((await settlement(r)).length, 0);
    assert.deepEqual((await audit(r)).map((x) => x.action), ["PAYMENT_SUBMIT"]);
    const tolak = await minta("POST", r.g + "/" + p.id + "/reject", a, { body: { reason: "salah nominal" } });
    assert.equal(tolak.status, 200);
    assert.equal(tolak.body.data.status, "REJECTED");
    assert.equal(tolak.body.data.rejectReason, "salah nominal");
    assert.equal(typeof tolak.body.data.decidedAt, "string");
    assert.equal((await kirim(r, b, a, 10000)).status, 201);
    const log = await audit(r);
    const aksiTolak = log.find((x) => x.action === "PAYMENT_REJECT");
    assert.equal(aksiTolak.reason, "salah nominal");
    assert.equal(aksiTolak.actorId, a.id);
  });

  it("status akhir tidak dapat diubah lagi: konfirmasi dua kali, tolak atau batal sesudah konfirmasi, konfirmasi setelah tolak: 409 invalid-state", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const p = (await kirim(r, b, a, 10000)).body.data;
    assert.equal((await minta("POST", r.g + "/" + p.id + "/confirm", a)).status, 200);
    for (const [aksi, user] of [["confirm", a], ["reject", a], ["cancel", b]]) {
      const h = await minta("POST", r.g + "/" + p.id + "/" + aksi, user);
      assert.equal(h.status, 409, aksi);
      assert.equal(h.body.code, "invalid-state", aksi);
    }
    const q = (await kirim(r, b, a, 10000)).body.data;
    assert.equal((await minta("POST", r.g + "/" + q.id + "/reject", a)).status, 200);
    assert.equal((await minta("POST", r.g + "/" + q.id + "/confirm", a)).body.code, "invalid-state");
    assert.equal((await minta("POST", r.g + "/" + q.id + "/cancel", b)).body.code, "invalid-state");
    assert.equal((await settlement(r)).length, 1);
  });

  it("idempotensi: konfirmasi diulang dengan kunci sama diputar ulang tanpa SETTLEMENT kedua; kirim diulang tidak membuat pelunasan kedua", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const kunciKirim = randomUUID();
    const k1 = await minta("POST", r.g, b, { body: { receiverId: a.id, amount: 10000, methodType: "CASH" }, kunci: kunciKirim });
    const k2 = await minta("POST", r.g, b, { body: { receiverId: a.id, amount: 10000, methodType: "CASH" }, kunci: kunciKirim });
    assert.equal(k1.status, 201);
    assert.equal(k2.status, 201);
    assert.equal(k2.ulang, "true");
    assert.equal(k2.body.data.id, k1.body.data.id);
    assert.equal(await prisma.paymentConfirmation.count({ where: { groupId: r.grup.id } }), 1);
    const kunciKonf = randomUUID();
    const c1 = await minta("POST", r.g + "/" + k1.body.data.id + "/confirm", a, { kunci: kunciKonf });
    const c2 = await minta("POST", r.g + "/" + k1.body.data.id + "/confirm", a, { kunci: kunciKonf });
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);
    assert.equal(c2.ulang, "true");
    assert.equal((await settlement(r)).length, 1);
    assert.equal(await saldo(r, b, a), 20000);
  });

  it("Idempotency-Key wajib untuk kirim dan konfirmasi; tolak dan batal tidak memerlukannya", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const tanpa = await minta("POST", r.g, b, { body: { receiverId: a.id, amount: 1000, methodType: "CASH" }, kunci: false });
    assert.equal(tanpa.status, 400);
    assert.equal(tanpa.body.errors.some((e) => e.field === "Idempotency-Key"), true);
    const p = (await kirim(r, b, a, 1000)).body.data;
    const tanpaKonf = await minta("POST", r.g + "/" + p.id + "/confirm", a, { kunci: false });
    assert.equal(tanpaKonf.status, 400);
    assert.equal((await minta("GET", r.g + "/" + p.id, a)).body.data.status, "PENDING");
    assert.equal((await minta("POST", r.g + "/" + p.id + "/cancel", b)).status, 200);
    const q = (await kirim(r, b, a, 1000)).body.data;
    assert.equal((await minta("POST", r.g + "/" + q.id + "/reject", a)).status, 200);
  });

  it("akses: pihak ketiga 404, pengirim tidak boleh konfirmasi atau tolak (403), penerima tidak boleh batal (403), non-anggota 403, grup lain 404", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE", "ACTIVE"]);
    const [a, b, c] = r.user;
    const luar = await buatUser();
    const lain = await ruang(["ACTIVE"]);
    await buatAnggota(lain.grup.id, c.id);
    await utang(r, b, a, 30000);
    const p = (await kirim(r, b, a, 10000)).body.data;
    for (const [m, akhir] of [["GET", ""], ["POST", "/confirm"], ["POST", "/reject"], ["POST", "/cancel"]]) {
      const h = await minta(m, r.g + "/" + p.id + akhir, c);
      assert.equal(h.status, 404, m + akhir);
      assert.equal(h.body.code, "not-found");
    }
    assert.equal((await minta("GET", r.g, c)).body.data.length, 0);
    assert.equal((await minta("POST", r.g + "/" + p.id + "/confirm", b)).status, 403);
    assert.equal((await minta("POST", r.g + "/" + p.id + "/reject", b)).status, 403);
    assert.equal((await minta("POST", r.g + "/" + p.id + "/cancel", a)).status, 403);
    assert.equal((await minta("GET", r.g + "/" + p.id, luar)).status, 403);
    assert.equal((await kirim(r, luar, a, 1000)).status, 403);
    assert.equal((await minta("GET", lain.g + "/" + p.id, c)).status, 404);
    assert.equal((await minta("GET", "/999999999/payments", a)).status, 403);
    assert.equal((await minta("GET", r.g)).status, 401);
    assert.equal((await minta("GET", r.g + "/" + p.id, a)).body.data.status, "PENDING");
  });

  it("penerima: diri sendiri dan non-anggota 400 invalid-receiver; mantan anggota boleh mengirim dan dipiutangi", async () => {
    const r = await ruang(["ACTIVE", "LEFT", "REMOVED", "ACTIVE"]);
    const [a, b, c, d] = r.user;
    const luar = await buatUser();
    await utang(r, b, a, 30000);
    await utang(r, a, c, 5000);
    const diri = await kirim(r, a, a, 1000);
    assert.equal(diri.status, 400);
    assert.equal(diri.body.code, "invalid-receiver");
    const bukanAnggota = await kirim(r, a, luar, 1000);
    assert.equal(bukanAnggota.status, 400);
    assert.equal(bukanAnggota.body.code, "invalid-receiver");
    const tidakBerutang = await kirim(r, d, a, 1000);
    assert.equal(tidakBerutang.status, 409);
    assert.equal(tidakBerutang.body.code, "amount-exceeds-debt");
    const dariMantan = await kirim(r, b, a, 30000);
    assert.equal(dariMantan.status, 201);
    assert.equal((await minta("POST", r.g + "/" + dariMantan.body.data.id + "/confirm", a)).status, 200);
    assert.equal(await saldo(r, b, a), 0);
    const kePiutangMantan = await kirim(r, a, c, 5000);
    assert.equal(kePiutangMantan.status, 201);
    assert.equal((await minta("POST", r.g + "/" + kePiutangMantan.body.data.id + "/confirm", c)).status, 200);
    assert.equal(await saldo(r, a, c), 0);
  });

  it("badan tidak sah 400 dan tidak menulis apa pun; BANK belum didukung", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    for (const body of [{}, { receiverId: a.id, amount: 0, methodType: "CASH" }, { receiverId: a.id, amount: 1000, methodType: "BANK" }, { receiverId: a.id, amount: 1000, methodType: "CASH", methodId: 1 }, { receiverId: "x", amount: 1000, methodType: "CASH" }]) {
      const h = await minta("POST", r.g, b, { body });
      assert.equal(h.status, 400, JSON.stringify(body));
    }
    assert.equal(await prisma.paymentConfirmation.count({ where: { groupId: r.grup.id } }), 0);
    assert.equal((await audit(r)).length, 0);
  });

  it("daftar berkursor dan filter status di database nyata", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 100000);
    const p1 = (await kirim(r, b, a, 1000)).body.data;
    const p2 = (await kirim(r, b, a, 2000)).body.data;
    const p3 = (await kirim(r, b, a, 3000)).body.data;
    const hal1 = await minta("GET", r.g + "?limit=2", b);
    assert.deepEqual(hal1.body.data.map((x) => x.id), [p3.id, p2.id]);
    assert.equal(hal1.body.page.hasMore, true);
    const hal2 = await minta("GET", r.g + "?limit=2&cursor=" + hal1.body.page.nextCursor, b);
    assert.deepEqual(hal2.body.data.map((x) => x.id), [p1.id]);
    assert.deepEqual(hal2.body.page, { nextCursor: null, hasMore: false });
    await minta("POST", r.g + "/" + p2.id + "/cancel", b);
    assert.deepEqual((await minta("GET", r.g + "?status=CANCELLED", b)).body.data.map((x) => x.id), [p2.id]);
    assert.deepEqual((await minta("GET", r.g + "?status=PENDING", a)).body.data.map((x) => x.id), [p3.id, p1.id]);
    assert.equal((await minta("GET", r.g + "?cursor=rusak", b)).status, 400);
  });

  it("serentak [D: bergantung kunci baris SQL Server]: dua pengajuan penuh, tepat satu berhasil", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const hasil = await Promise.all([kirim(r, b, a, 30000), kirim(r, b, a, 30000)]);
    assert.deepEqual(hasil.map((h) => h.status).sort(), [201, 409]);
    assert.equal(await prisma.paymentConfirmation.count({ where: { groupId: r.grup.id } }), 1);
  });

  it("serentak [D]: dua konfirmasi atas dua pelunasan yang masing-masing sah: keduanya berhasil, saldo nol", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const p1 = (await kirim(r, b, a, 10000)).body.data;
    const p2 = (await kirim(r, b, a, 20000)).body.data;
    const hasil = await Promise.all([minta("POST", r.g + "/" + p1.id + "/confirm", a), minta("POST", r.g + "/" + p2.id + "/confirm", a)]);
    assert.deepEqual(hasil.map((h) => h.status), [200, 200]);
    assert.equal(await saldo(r, b, a), 0);
    assert.equal((await settlement(r)).length, 2);
  });

  it("serentak [D]: konfirmasi ganda atas satu pelunasan dengan kunci berbeda, tepat satu SETTLEMENT", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const p = (await kirim(r, b, a, 10000)).body.data;
    const hasil = await Promise.all([minta("POST", r.g + "/" + p.id + "/confirm", a), minta("POST", r.g + "/" + p.id + "/confirm", a)]);
    assert.deepEqual(hasil.map((h) => h.status).sort(), [200, 409]);
    assert.equal((await settlement(r)).length, 1);
    assert.equal(await saldo(r, b, a), 20000);
  });

  it("serentak [D]: konfirmasi melawan pembatalan, tepat satu menang dan SETTLEMENT sesuai status akhir", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    await utang(r, b, a, 30000);
    const p = (await kirim(r, b, a, 30000)).body.data;
    const hasil = await Promise.all([minta("POST", r.g + "/" + p.id + "/confirm", a), minta("POST", r.g + "/" + p.id + "/cancel", b)]);
    assert.equal(hasil.filter((h) => h.status === 200).length, 1);
    assert.equal(hasil.filter((h) => h.status === 409).length, 1);
    const akhir = (await minta("GET", r.g + "/" + p.id, a)).body.data.status;
    assert.equal((await settlement(r)).length, akhir === "CONFIRMED" ? 1 : 0);
    assert.equal(await saldo(r, b, a), akhir === "CONFIRMED" ? 0 : 30000);
  });
});
