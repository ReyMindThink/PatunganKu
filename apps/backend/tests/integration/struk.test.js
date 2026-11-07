// Struk di SQL Server nyata (T1.7b): unggah, verifikasi, duplikat, idempotensi, dan alur utama utuh
// (buat, unggah, verifikasi, submit, ACTIVE). Penyimpanan blob dan Gemini PALSU (CI tidak punya
// Azurite maupun kunci Gemini); yang diuji adalah router, layanan, ledger, dan database asli.
// Tabel tambah-saja (AuditLog, LedgerEntry, ReceiptExtraction) tidak di-UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatTransaksi } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { STRUK } from "../../src/config/constants.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterStruk, buatPembatasStruk } from "../../src/routes/struk.router.js";
import { buatRouterTransaksi } from "../../src/routes/transaksi.router.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananStruk } from "../../src/services/struk.js";
import { buatLayananTransaksi } from "../../src/services/transaksi.js";
import { HttpError } from "../../src/utils/httpError.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { fingerprintStruk, sha256Hex } from "../../src/utils/sidikStruk.js";

const SECRET = "rahasia-integrasi-struk-yang-cukup-panjang-abcdef";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
const gambar = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(label + randomUUID())]);
const WAKTU = new Date("2026-10-05T05:30:00.000Z");
const HASIL_BAIK = { isReceipt: true, total: 70000, confidence: 0.92, merchant: "Warung Sedap Uji", purchasedAt: WAKTU, aiModel: "gemini-uji", promptVersion: "v-uji" };
const FP_BAIK = fingerprintStruk({ merchant: HASIL_BAIK.merchant, purchasedAt: WAKTU, total: 70000 });

describe("struk di SQL Server", () => {
  let server;
  const blob = new Map();
  let skenario = {};
  let panggilanGemini = 0;
  const penyimpanan = {
    simpan: async (buffer) => { const nama = randomUUID() + ".bin"; blob.set(nama, buffer); return nama; },
    baca: async (nama) => { if (blob.has(nama) === false) throw new Error("blob tidak ada"); return blob.get(nama); },
    hapus: async (nama) => { blob.delete(nama); },
  };
  const pemverif = async () => {
    panggilanGemini++;
    if (skenario instanceof Error) throw skenario;
    return { ...HASIL_BAIK, ...skenario };
  };

  before(async () => {
    const ledger = buatLayananLedger({ db: prisma });
    const transaksi = buatLayananTransaksi({ db: prisma, ledger });
    const struk = buatLayananStruk({ penyimpanan, pemverif, bacaTransaksi: transaksi.bacaDetail });
    const requireAuth = buatRequireAuth({ secret: SECRET });
    const requireActiveMember = buatAkses({ db: prisma }).requireActiveMember;
    const idempoten = buatIdempotensi({ db: prisma }).idempoten;
    const idempotenVerifikasi = buatIdempotensi({ db: prisma, opsiTransaksi: { timeout: STRUK.TX_VERIFIKASI_TIMEOUT_MS, maxWait: 5000 } }).idempoten;
    server = await mulaiAplikasi((app) => {
      app.use("/api/groups", buatRouterTransaksi({ layanan: transaksi, requireAuth, requireActiveMember, idempoten }));
      app.use("/api/groups", buatRouterStruk({ layanan: struk, requireAuth, requireActiveMember, idempoten, idempotenVerifikasi, pembatas: buatPembatasStruk() }));
    });
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  const hasil = async (res) => {
    const teks = await res.text();
    return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
  };
  async function kirim(path, { metode = "GET", body, user, kunci } = {}) {
    const headers = { "content-type": "application/json" };
    if (user) headers.authorization = "Bearer " + token(user.id);
    if (kunci) headers["idempotency-key"] = kunci;
    return hasil(await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  }
  const tulis = (path, metode, user, body) => kirim(path, { metode, user, body, kunci: randomUUID() });
  async function unggah(r, id, bytes, { user = r.user[0], kunci = randomUUID(), field = "receipt" } = {}) {
    const form = new FormData();
    if (bytes) form.append(field, new Blob([bytes], { type: "image/jpeg" }), "struk.jpg");
    const headers = {};
    if (user) headers.authorization = "Bearer " + token(user.id);
    if (kunci) headers["idempotency-key"] = kunci;
    return hasil(await fetch(server.url + "/api/groups" + r.base + "/" + id + "/receipt", { method: "POST", headers, body: form }));
  }
  const verifikasi = (r, id, { user = r.user[0], kunci = randomUUID() } = {}) => kirim(r.base + "/" + id + "/receipt/verify", { metode: "POST", user, kunci });
  const kirimTrx = (r, id) => tulis(r.base + "/" + id + "/submit", "POST", r.user[0]);

  async function buatRuang(n = 3) {
    const user = [];
    for (let i = 0; i < n; i++) user.push(await buatUser());
    const grup = await buatGrup(user[0].id);
    for (let i = 0; i < n; i++) await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: "ACTIVE" });
    return { user, grup, base: "/" + grup.id + "/transactions" };
  }
  const buatDraft = async (r, amount = 70000) => (await tulis(r.base, "POST", r.user[0], { description: "Makan bersama", amount })).body.data;
  const siapUnggah = async (r, amount) => {
    const t = await buatDraft(r, amount);
    const bytes = gambar("struk");
    const h = await unggah(r, t.id, bytes);
    assert.equal(h.status, 200);
    return { t, bytes };
  };
  const ekstraksi = (id) => prisma.receiptExtraction.findMany({ where: { transactionId: id }, orderBy: { version: "asc" } });
  const baris = (id) => prisma.transaction.findUnique({ where: { id } });

  it("alur utama utuh: buat, unggah, verifikasi, submit menjadi ACTIVE dengan share dan CHARGE; alamat blob tidak bocor", async () => {
    skenario = {};
    const r = await buatRuang(3);
    const [a, b, c] = r.user;
    const t = await buatDraft(r);
    const bytes = gambar("alur");
    const up = await unggah(r, t.id, bytes);
    assert.equal(up.status, 200);
    assert.equal(up.body.data.hasReceipt, true);
    assert.equal(up.body.data.receiptStatus, "PENDING");
    const sesudahUnggah = await baris(t.id);
    assert.equal(sesudahUnggah.imageSha256, sha256Hex(bytes));
    assert.equal(blob.get(sesudahUnggah.receiptUrl).equals(bytes), true);
    assert.equal(up.teks.includes(sesudahUnggah.receiptUrl), false, "nama blob bocor di respons unggah");

    const ver = await verifikasi(r, t.id);
    assert.equal(ver.status, 200);
    assert.deepEqual(ver.body.data.decision, { status: "VERIFIED", reason: "ok" });
    assert.deepEqual(ver.body.data.detected, { total: 70000, confidence: 0.92 });
    assert.equal(ver.body.data.transaction.receiptStatus, "VERIFIED");
    const sesudahVerif = await baris(t.id);
    assert.equal(sesudahVerif.receiptStatus, "VERIFIED");
    assert.equal(sesudahVerif.fingerprint, FP_BAIK);
    const e = await ekstraksi(t.id);
    assert.equal(e.length, 1);
    assert.deepEqual([e[0].version, e[0].source, e[0].createdBy, e[0].merchant, e[0].total, Number(e[0].confidence), e[0].aiModel, e[0].promptVersion], [1, "AI", a.id, "Warung Sedap Uji", 70000, 0.92, "gemini-uji", "v-uji"]);
    assert.equal(e[0].purchasedAt.getTime(), WAKTU.getTime());
    assert.equal(JSON.parse(e[0].rawJson).decision.reason, "ok");

    const kirimHasil = await kirimTrx(r, t.id);
    assert.equal(kirimHasil.status, 200);
    assert.equal(kirimHasil.body.data.transaction.status, "ACTIVE");
    assert.deepEqual((await prisma.transactionShare.findMany({ where: { transactionId: t.id }, orderBy: { userId: "asc" } })).map((s) => s.amount), [23334, 23333, 23333]);
    assert.deepEqual((await prisma.ledgerEntry.findMany({ where: { transactionId: t.id }, orderBy: { id: "asc" } })).map((l) => [l.debtorUserId, l.creditorUserId, l.amount]), [[b.id, a.id, 23333n], [c.id, a.id, 23333n]]);
    assert.equal(await prisma.auditLog.count({ where: { transactionId: t.id } }), 1);
  });

  it("unggah: bukan gambar 415, di atas 5 MB 413, tanpa berkas atau field salah 400, tanpa Idempotency-Key 400; semua tanpa menyimpan blob", async () => {
    const r = await buatRuang(2);
    const t = await buatDraft(r);
    const sebelum = blob.size;
    assert.equal((await unggah(r, t.id, Buffer.from("ini teks biasa"))).status, 415);
    const besar = await unggah(r, t.id, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(STRUK.UKURAN_MAKS)]));
    assert.equal(besar.status, 413);
    assert.equal(besar.body.code, "payload-too-large");
    assert.equal((await unggah(r, t.id, null)).status, 400);
    assert.equal((await unggah(r, t.id, gambar("x"), { field: "foto" })).status, 400);
    const tanpaKunci = await unggah(r, t.id, gambar("x"), { kunci: null });
    assert.equal(tanpaKunci.status, 400);
    assert.ok(tanpaKunci.body.errors.some((x) => x.field === "Idempotency-Key"));
    assert.equal(blob.size, sebelum);
    assert.equal((await baris(t.id)).receiptUrl, null);
  });

  it("unggah: bukan penalang 404 (DRAFT); setelah dikirim 409 untuk penalang dan 403 untuk lain", async () => {
    const r = await buatRuang(2);
    const t = await buatDraft(r);
    assert.equal((await unggah(r, t.id, gambar("x"), { user: r.user[1] })).status, 404);
    await prisma.transaction.update({ where: { id: t.id }, data: { status: "ACTIVE" } });
    const penalang = await unggah(r, t.id, gambar("y"));
    assert.equal(penalang.status, 409);
    assert.equal(penalang.body.code, "invalid-state");
    assert.equal((await unggah(r, t.id, gambar("z"), { user: r.user[1] })).status, 403);
  });

  it("idempotensi unggah: replay kunci dan berkas sama tidak menyimpan lagi; kunci sama dengan berkas lain 409 idempotency-key-reuse", async () => {
    const r = await buatRuang(2);
    const t = await buatDraft(r);
    const bytes = gambar("idem");
    const kunci = randomUUID();
    const pertama = await unggah(r, t.id, bytes, { kunci });
    assert.equal(pertama.status, 200);
    const ukuran = blob.size;
    const ulang = await unggah(r, t.id, bytes, { kunci });
    assert.equal(ulang.status, 200);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    assert.equal(blob.size, ukuran);
    const lain = await unggah(r, t.id, gambar("beda"), { kunci });
    assert.equal(lain.status, 409);
    assert.equal(lain.body.code, "idempotency-key-reuse");
    assert.equal(blob.size, ukuran);
    assert.equal((await baris(t.id)).imageSha256, sha256Hex(bytes));
  });

  it("duplikat hash (K8): struk transaksi ACTIVE atau PENDING_APPROVAL di grup yang sama ditolak 409 dengan existingTransactionId; status lain dan grup lain tidak", async () => {
    const r = await buatRuang(2);
    const lain = await buatRuang(2);
    const bytes = gambar("kembar");
    const sha = sha256Hex(bytes);
    const asli = await buatTransaksi(r.grup.id, r.user[0].id, { status: "ACTIVE", imageSha256: sha });
    await buatTransaksi(lain.grup.id, lain.user[0].id, { status: "ACTIVE", imageSha256: sha });
    const draft = await buatDraft(r);
    const sebelum = blob.size;
    for (const status of ["ACTIVE", "PENDING_APPROVAL"]) {
      await prisma.transaction.update({ where: { id: asli.id }, data: { status } });
      const h = await unggah(r, draft.id, bytes);
      assert.equal(h.status, 409, status);
      assert.equal(h.body.code, "duplicate-receipt");
      assert.equal(h.body.existingTransactionId, asli.id);
    }
    assert.equal(blob.size, sebelum);
    for (const status of ["REJECTED", "EXPIRED", "WITHDRAWN", "TAKEN_DOWN"]) {
      await prisma.transaction.update({ where: { id: asli.id }, data: { status } });
      assert.equal((await unggah(r, draft.id, bytes)).status, 200, status);
    }
    assert.equal((await unggah(r, draft.id, bytes)).status, 200, "mengunggah ulang berkas yang sama ke draft sendiri");

    assert.equal((await unggah(lain, (await buatDraft(lain)).id, bytes)).status, 409, "hash sama di grup yang memegangnya sendiri");
    assert.equal((await unggah(r, (await buatDraft(r)).id, gambar("lain"))).status, 200);
  });

  it("keputusan verifikasi: bukan struk, keyakinan rendah, total tak terbaca, dan total berbeda menjadi FAILED dan tercatat di ekstraksi", async () => {
    const r = await buatRuang(2);
    for (const [ubah, reason] of [[{ isReceipt: false }, "not-a-receipt"], [{ confidence: 0.3 }, "low-confidence"], [{ total: null }, "total-unreadable"], [{ total: 65000 }, "total-mismatch"]]) {
      skenario = ubah;
      const { t } = await siapUnggah(r);
      const h = await verifikasi(r, t.id);
      assert.equal(h.status, 200, reason);
      assert.equal(h.body.data.decision.status, "FAILED", reason);
      assert.equal(h.body.data.decision.reason, reason);
      assert.equal((await baris(t.id)).receiptStatus, "FAILED", reason);
      assert.equal(JSON.parse((await ekstraksi(t.id))[0].rawJson).decision.reason, reason);
    }
    skenario = {};
  });

  it("isi mirip (K8): NEEDS_REVIEW possible-duplicate bila fingerprint sama dengan transaksi ACTIVE lain; lalu submit menjadi PENDING_APPROVAL tanpa CHARGE; status lain tidak dihitung", async () => {
    skenario = {};
    const r = await buatRuang(3);
    const asli = await buatTransaksi(r.grup.id, r.user[0].id, { status: "ACTIVE", fingerprint: FP_BAIK });
    const { t } = await siapUnggah(r);
    const h = await verifikasi(r, t.id);
    assert.deepEqual(h.body.data.decision, { status: "NEEDS_REVIEW", reason: "possible-duplicate", warnings: [{ code: "possible-duplicate", existingTransactionId: asli.id }] });
    assert.equal((await baris(t.id)).receiptStatus, "NEEDS_REVIEW");
    assert.equal((await baris(t.id)).fingerprint, FP_BAIK);
    const kirimHasil = await kirimTrx(r, t.id);
    assert.equal(kirimHasil.body.data.transaction.status, "PENDING_APPROVAL");
    assert.equal(await prisma.ledgerEntry.count({ where: { transactionId: t.id } }), 0);
    assert.equal(await prisma.transactionShare.count({ where: { transactionId: t.id } }), 3);

    await prisma.transaction.updateMany({ where: { groupId: r.grup.id, fingerprint: FP_BAIK }, data: { status: "REJECTED" } });
    const { t: t2 } = await siapUnggah(r);
    assert.equal((await verifikasi(r, t2.id)).body.data.decision.status, "VERIFIED");
  });

  it("Gemini gagal: 502 upstream-error tanpa mengubah status atau menulis ekstraksi; percobaan ulang berhasil dengan versi 1", async () => {
    const r = await buatRuang(2);
    const { t } = await siapUnggah(r);
    skenario = new HttpError(502, "upstream-error", "Layanan verifikasi struk tidak merespons tepat waktu.");
    const gagal = await verifikasi(r, t.id);
    assert.equal(gagal.status, 502);
    assert.equal(gagal.body.code, "upstream-error");
    assert.equal((await baris(t.id)).receiptStatus, "PENDING");
    assert.equal((await ekstraksi(t.id)).length, 0);
    skenario = {};
    const ulang = await verifikasi(r, t.id);
    assert.equal(ulang.status, 200);
    assert.deepEqual((await ekstraksi(t.id)).map((e) => e.version), [1]);
  });

  it("verifikasi: tanpa unggahan 409; bukan penalang 404; setelah dikirim 409; blob hilang 502; tanpa Idempotency-Key 400", async () => {
    skenario = {};
    const r = await buatRuang(2);
    const polos = await buatDraft(r);
    assert.equal((await verifikasi(r, polos.id)).status, 409);
    const { t } = await siapUnggah(r);
    assert.equal((await verifikasi(r, t.id, { user: r.user[1] })).status, 404);
    const tanpaKunci = await verifikasi(r, t.id, { kunci: null });
    assert.equal(tanpaKunci.status, 400);
    assert.ok(tanpaKunci.body.errors.some((x) => x.field === "Idempotency-Key"));
    const nama = (await baris(t.id)).receiptUrl;
    const simpan = blob.get(nama);
    blob.delete(nama);
    const hilang = await verifikasi(r, t.id);
    assert.equal(hilang.status, 502);
    assert.equal(hilang.body.code, "upstream-error");
    blob.set(nama, simpan);
    await prisma.transaction.update({ where: { id: t.id }, data: { status: "ACTIVE" } });
    assert.equal((await verifikasi(r, t.id)).status, 409);
    assert.equal((await verifikasi(r, t.id, { user: r.user[1] })).status, 403);
  });

  it("verifikasi ulang menaikkan versi; unggah ulang mengembalikan PENDING dan mengosongkan fingerprint tetapi riwayat ekstraksi tetap; draft yang sudah diverifikasi tidak dapat dihapus", async () => {
    skenario = {};
    const r = await buatRuang(2);
    const { t } = await siapUnggah(r);
    await verifikasi(r, t.id);
    await verifikasi(r, t.id);
    assert.deepEqual((await ekstraksi(t.id)).map((e) => e.version), [1, 2]);
    const baru = gambar("pengganti");
    assert.equal((await unggah(r, t.id, baru)).status, 200);
    const b = await baris(t.id);
    assert.equal(b.receiptStatus, "PENDING");
    assert.equal(b.fingerprint, null);
    assert.equal(b.imageSha256, sha256Hex(baru));
    assert.equal((await ekstraksi(t.id)).length, 2);
    const hapus = await tulis(r.base + "/" + t.id, "DELETE", r.user[0]);
    assert.equal(hapus.status, 409);
    assert.equal(hapus.body.code, "invalid-state");
    assert.equal(await prisma.transaction.count({ where: { id: t.id } }), 1);
  });

  it("dua verifikasi serentak dengan kunci berbeda: keduanya 200 dan versi ekstraksi 1 dan 2 tanpa bentrok UNIQUE", async () => {
    skenario = {};
    const r = await buatRuang(2);
    const { t } = await siapUnggah(r);
    const hasilKedua = await Promise.all([verifikasi(r, t.id), verifikasi(r, t.id)]);
    assert.deepEqual(hasilKedua.map((h) => h.status), [200, 200]);
    assert.deepEqual((await ekstraksi(t.id)).map((e) => e.version), [1, 2]);
  });

  it("replay verifikasi dengan kunci sama tidak memanggil Gemini lagi dan tidak menambah ekstraksi", async () => {
    skenario = {};
    const r = await buatRuang(2);
    const { t } = await siapUnggah(r);
    const kunci = randomUUID();
    const sebelum = panggilanGemini;
    const pertama = await verifikasi(r, t.id, { kunci });
    assert.equal(pertama.status, 200);
    const ulang = await verifikasi(r, t.id, { kunci });
    assert.equal(ulang.status, 200);
    assert.equal(ulang.res.headers.get("idempotent-replay"), "true");
    assert.equal(panggilanGemini - sebelum, 1);
    assert.equal((await ekstraksi(t.id)).length, 1);
  });
});
