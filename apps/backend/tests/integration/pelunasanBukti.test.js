// Pelunasan BANK dan EWALLET dengan bukti di SQL Server nyata (T1.9b-2b). Penyimpanan blob diganti
// penyimpanan di memori (CI tidak punya Azurite), jadi jalur lib/blob.js ke Azure TIDAK dibuktikan di
// sini. Tabel tambah-saja (LedgerEntry, AuditLog) tidak di-UPDATE atau DELETE.
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

const SECRET = "rahasia-integrasi-bukti-pelunasan-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("bukti-transfer-jpeg")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("bukti-png")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from("bukti-webp")]);

describe("pelunasan BANK dan EWALLET dengan bukti di SQL Server", () => {
  let server;
  const blob = new Map();
  let urut = 0;
  const ledger = buatLayananLedger({ db: prisma });
  const penyimpanan = {
    simpan: async (buffer, tipe) => { const nama = "uji-" + ++urut + "-" + randomUUID().slice(0, 8) + "." + tipe.split("/")[1]; blob.set(nama, { buffer: Buffer.from(buffer), tipe }); return nama; },
    hapus: async (nama) => { blob.delete(nama); },
    unduh: async (nama) => { const b = blob.get(nama); if (b === undefined) throw Object.assign(new Error("blob tidak ada"), { statusCode: 404 }); return { buffer: b.buffer, tipe: b.tipe }; },
  };
  before(async () => {
    const router = buatRouterPelunasan({
      layanan: buatLayananPelunasan({ db: prisma, ledger, penyimpanan }),
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
  const metode = (user, kind, lain = {}) => prisma.paymentMethod.create({ data: { userId: user.id, kind, provider: kind === "BANK" ? "BCA" : "Dana", accountNo: "v1.contoh.tag.isi", accountName: "Nama " + user.id, ...lain } });
  const settlement = (r) => prisma.ledgerEntry.findMany({ where: { groupId: r.grup.id, type: "SETTLEMENT" } });
  const audit = (r) => prisma.auditLog.findMany({ where: { groupId: r.grup.id, entity: "PaymentConfirmation" }, orderBy: { id: "asc" } });
  const jumlahBaris = (r) => prisma.paymentConfirmation.count({ where: { groupId: r.grup.id } });

  async function minta(metodeHttp, path, user, { form, body, kunci } = {}) {
    const headers = {};
    if (user) headers.authorization = "Bearer " + token(user.id);
    if ((body === undefined) === false) headers["content-type"] = "application/json";
    if (metodeHttp === "POST" && (path.endsWith("/payments") || path.endsWith("/confirm"))) headers["idempotency-key"] = kunci ?? randomUUID();
    const res = await fetch(server.url + "/api/groups" + path, { method: metodeHttp, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks), ulang: res.headers.get("idempotent-replay") };
  }
  const formDari = (medan, berkas, namaBerkas = "bukti.jpg") => {
    const f = new FormData();
    for (const [k, v] of Object.entries(medan)) f.append(k, String(v));
    if (berkas) f.append("proof", new Blob([berkas]), namaBerkas);
    return f;
  };
  const kirimBukti = (r, dari, ke, mtd, berkas, tambah = {}, kunci) =>
    minta("POST", r.g, dari, { form: formDari({ receiverId: ke.id, amount: 10000, methodType: mtd.kind, methodId: mtd.id, ...tambah }, berkas), kunci });
  async function bukti(r, id, user) {
    const res = await fetch(server.url + "/api/groups" + r.g + "/" + id + "/proof", { headers: user ? { authorization: "Bearer " + token(user.id) } : {} });
    const ketik = res.headers.get("content-type");
    return { status: res.status, tipe: ketik, cache: res.headers.get("cache-control"), sniff: res.headers.get("x-content-type-options"), bytes: Buffer.from(await res.arrayBuffer()) };
  }

  it("alur BANK lengkap: kirim dengan bukti, bukti dapat dibaca dua pihak, konfirmasi menulis SETTLEMENT, audit tanpa nomor dan nama blob", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE", "ACTIVE"]);
    const [a, b, c] = r.user;
    const bank = await metode(a, "BANK");
    await utang(r, b, a, 30000);
    const sebelum = blob.size;
    const dibuat = await kirimBukti(r, b, a, bank, JPEG, { note: "transfer" });
    assert.equal(dibuat.status, 201);
    const p = dibuat.body.data;
    assert.deepEqual({ ...p, createdAt: typeof p.createdAt }, {
      id: p.id, groupId: r.grup.id, sender: { kind: "USER", id: b.id, name: "Orang 1" }, receiver: { kind: "USER", id: a.id, name: "Orang 0" },
      amount: 10000, methodType: "BANK", method: { id: bank.id, provider: "BCA", accountName: "Nama " + a.id }, note: "transfer",
      hasProof: true, status: "PENDING", rejectReason: null, createdAt: "string", decidedAt: null, cancelledAt: null,
    });
    assert.equal(blob.size, sebelum + 1);
    const baris = await prisma.paymentConfirmation.findUnique({ where: { id: p.id } });
    assert.equal(blob.has(baris.proofUrl), true);
    assert.deepEqual([baris.methodId, baris.methodProvider, baris.methodAccountName], [bank.id, "BCA", "Nama " + a.id]);
    assert.equal(JSON.stringify(dibuat.body).includes(baris.proofUrl), false);

    for (const pihak of [a, b]) {
      const h = await bukti(r, p.id, pihak);
      assert.equal(h.status, 200);
      assert.equal(h.tipe, "image/jpeg");
      assert.equal(h.cache, "private, no-store");
      assert.equal(h.sniff, "nosniff");
      assert.equal(h.bytes.equals(JPEG), true);
    }
    assert.equal((await bukti(r, p.id, c)).status, 404);
    assert.equal((await bukti(r, p.id, await buatUser())).status, 403);
    assert.equal((await bukti(r, p.id, null)).status, 401);

    assert.equal((await minta("POST", r.g + "/" + p.id + "/confirm", a)).status, 200);
    assert.equal((await settlement(r)).length, 1);
    const log = await audit(r);
    assert.deepEqual(log.map((x) => x.action), ["PAYMENT_SUBMIT", "PAYMENT_CONFIRM"]);
    assert.deepEqual(JSON.parse(log[0].newValue), { receiverId: a.id, amount: 10000, methodType: "BANK", methodId: bank.id });
    const semua = JSON.stringify(log);
    assert.equal(semua.includes("v1.contoh"), false);
    assert.equal(semua.includes(baris.proofUrl), false);
  });

  it("snapshot metode bertahan: metode diubah dan dinonaktifkan sesudah pengajuan, riwayat dan bukti tetap", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const bank = await metode(a, "BANK");
    await metode(a, "EWALLET");
    await utang(r, b, a, 30000);
    const p = (await kirimBukti(r, b, a, bank, JPEG)).body.data;
    await prisma.paymentMethod.update({ where: { id: bank.id }, data: { provider: "BNI", accountName: "Nama Baru", isActive: false } });
    const detail = (await minta("GET", r.g + "/" + p.id, a)).body.data;
    assert.deepEqual(detail.method, { id: bank.id, provider: "BCA", accountName: "Nama " + a.id });
    assert.equal((await bukti(r, p.id, b)).status, 200);
    assert.equal((await minta("POST", r.g + "/" + p.id + "/confirm", a)).status, 200);
  });

  it("EWALLET dengan PNG dan WebP: tipe berkas yang dikembalikan mengikuti isi yang diunggah", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const dompet = await metode(a, "EWALLET");
    await utang(r, b, a, 30000);
    for (const [gambar, tipe] of [[PNG, "image/png"], [WEBP, "image/webp"]]) {
      const p = (await kirimBukti(r, b, a, dompet, gambar, { amount: 1000 })).body.data;
      assert.equal(p.methodType, "EWALLET");
      const h = await bukti(r, p.id, a);
      assert.equal(h.tipe, tipe);
      assert.equal(h.bytes.equals(gambar), true);
    }
  });

  it("metode tidak sah: milik orang lain, nonaktif, jenis berbeda, atau tidak ada menjadi 409 no-accepted-method tanpa blob, baris, maupun audit", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE", "ACTIVE"]);
    const [a, b, c] = r.user;
    await utang(r, b, a, 30000);
    const bankA = await metode(a, "BANK");
    const bankC = await metode(c, "BANK");
    const mati = await metode(a, "BANK", { isActive: false });
    const sebelum = blob.size;
    const kasus = [
      () => kirimBukti(r, b, a, bankC, JPEG),
      () => kirimBukti(r, b, a, mati, JPEG),
      () => kirimBukti(r, b, a, bankA, JPEG, { methodType: "EWALLET" }),
      () => kirimBukti(r, b, a, { ...bankA, id: 999999999 }, JPEG),
    ];
    for (const jalankan of kasus) {
      const h = await jalankan();
      assert.equal(h.status, 409);
      assert.equal(h.body.code, "no-accepted-method");
    }
    assert.equal(blob.size, sebelum);
    assert.equal(await jumlahBaris(r), 0);
    assert.equal((await audit(r)).length, 0);
  });

  it("berkas: wajib untuk BANK (400 proof), dilarang untuk CASH (400 proof), bukan gambar 415; tidak ada yang tersimpan", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const bank = await metode(a, "BANK");
    await utang(r, b, a, 30000);
    const sebelum = blob.size;
    const tanpa = await kirimBukti(r, b, a, bank, null);
    assert.equal(tanpa.status, 400);
    assert.equal(tanpa.body.errors.some((e) => e.field === "proof"), true);
    const tunaiBerkas = await minta("POST", r.g, b, { form: formDari({ receiverId: a.id, amount: 1000, methodType: "CASH" }, JPEG) });
    assert.equal(tunaiBerkas.status, 400);
    assert.equal(tunaiBerkas.body.errors.some((e) => e.field === "proof"), true);
    const teks = await kirimBukti(r, b, a, bank, Buffer.from("ini bukan gambar sama sekali"), {}, undefined);
    assert.equal(teks.status, 415);
    assert.equal(teks.body.code, "unsupported-media-type");
    assert.equal(blob.size, sebelum);
    assert.equal(await jumlahBaris(r), 0);
  });

  it("aturan nominal sama dengan tunai: melebihi sisa 409 tanpa blob; pelunasan PENDING non-tunai ikut mengurangi sisa", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const bank = await metode(a, "BANK");
    await utang(r, b, a, 30000);
    const sebelum = blob.size;
    const lebih = await kirimBukti(r, b, a, bank, JPEG, { amount: 30001 });
    assert.equal(lebih.status, 409);
    assert.equal(lebih.body.code, "amount-exceeds-debt");
    assert.equal(lebih.body.payable, 30000);
    assert.equal(blob.size, sebelum);
    assert.equal((await kirimBukti(r, b, a, bank, JPEG, { amount: 10000 })).status, 201);
    const sisa = await kirimBukti(r, b, a, bank, JPEG, { amount: 25000 });
    assert.equal(sisa.status, 409);
    assert.equal(sisa.body.payable, 20000);
    assert.equal(blob.size, sebelum + 1);
  });

  it("idempotensi: kunci dan berkas sama diputar ulang (satu baris, satu blob); kunci sama dengan berkas lain 409 idempotency-key-reuse", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const bank = await metode(a, "BANK");
    await utang(r, b, a, 30000);
    const kunci = randomUUID();
    const sebelum = blob.size;
    const k1 = await kirimBukti(r, b, a, bank, JPEG, {}, kunci);
    const k2 = await kirimBukti(r, b, a, bank, JPEG, {}, kunci);
    assert.equal(k1.status, 201);
    assert.equal(k2.status, 201);
    assert.equal(k2.ulang, "true");
    assert.equal(k2.body.data.id, k1.body.data.id);
    assert.equal(await jumlahBaris(r), 1);
    assert.equal(blob.size, sebelum + 1);
    const lain = await kirimBukti(r, b, a, bank, PNG, {}, kunci);
    assert.equal(lain.status, 409);
    assert.equal(lain.body.code, "idempotency-key-reuse");
    assert.equal(await jumlahBaris(r), 1);
    assert.equal(blob.size, sebelum + 1);
  });

  it("tolak dan batal membiarkan bukti (arsip pembuktian); bukti tetap dapat dibaca kedua pihak", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const bank = await metode(a, "BANK");
    await utang(r, b, a, 30000);
    const p1 = (await kirimBukti(r, b, a, bank, JPEG, { amount: 1000 })).body.data;
    const p2 = (await kirimBukti(r, b, a, bank, PNG, { amount: 2000 })).body.data;
    assert.equal((await minta("POST", r.g + "/" + p1.id + "/reject", a, { body: { reason: "bukan transfer saya" } })).status, 200);
    assert.equal((await minta("POST", r.g + "/" + p2.id + "/cancel", b)).status, 200);
    for (const [id, bytes] of [[p1.id, JPEG], [p2.id, PNG]]) {
      for (const pihak of [a, b]) {
        const h = await bukti(r, id, pihak);
        assert.equal(h.status, 200);
        assert.equal(h.bytes.equals(bytes), true);
      }
    }
  });

  it("pelunasan tunai tidak punya bukti (404); blob yang hilang menjadi 404 bukan 500", async () => {
    const r = await ruang(["ACTIVE", "ACTIVE"]);
    const [a, b] = r.user;
    const bank = await metode(a, "BANK");
    await utang(r, b, a, 30000);
    const tunai = (await minta("POST", r.g, b, { body: { receiverId: a.id, amount: 1000, methodType: "CASH" } })).body.data;
    const hTunai = await bukti(r, tunai.id, a);
    assert.equal(hTunai.status, 404);
    const p = (await kirimBukti(r, b, a, bank, JPEG, { amount: 2000 })).body.data;
    const baris = await prisma.paymentConfirmation.findUnique({ where: { id: p.id } });
    blob.delete(baris.proofUrl);
    const hilang = await bukti(r, p.id, a);
    assert.equal(hilang.status, 404);
  });
});
