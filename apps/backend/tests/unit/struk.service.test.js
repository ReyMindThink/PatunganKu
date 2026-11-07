import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananStruk } from "../../src/services/struk.js";
import { fingerprintStruk, sha256Hex } from "../../src/utils/sidikStruk.js";

// tx, penyimpanan, dan pemverifikasi palsu di memori. BUKAN bukti SQL Server, Azure, atau Gemini.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("isi-gambar-uji")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-uji")]);
const penalang = { userId: 1, groupId: 7, role: "OWNER" };
const anggota = { userId: 2, groupId: 7, role: "MEMBER" };
const galat = (status, code) => (e) => e.status === status && e.code === code;

function buatDunia(awal = {}) {
  const s = {
    transaksi: { 5: { id: 5, groupId: 7, payerId: 1, amount: 70000, status: "DRAFT", receiptUrl: null, receiptStatus: "PENDING", imageSha256: null } },
    blob: new Map(), ekstraksi: [], kembar: null, mirip: null, hasil: null, gagalBaca: false, gagalHapus: false, ...awal,
  };
  const log = [];
  const catat = (nama, arg) => log.push({ nama, arg });
  const cocok = (t, w) => ["id", "groupId", "payerId", "status", "imageSha256"].every((k) => w[k] === undefined || t[k] === w[k]);
  const tx = {
    transaction: {
      findFirst: async (arg) => {
        catat("transaction.findFirst", arg);
        if (Object.hasOwn(arg.where, "imageSha256") && Object.hasOwn(arg.where.id, "not")) return s.kembar;
        if (Object.hasOwn(arg.where, "fingerprint")) return s.mirip;
        const t = s.transaksi[arg.where.id];
        if (t === undefined || (t.groupId === arg.where.groupId) === false) return null;
        return { ...t };
      },
      updateMany: async (arg) => {
        catat("transaction.updateMany", arg);
        const t = s.transaksi[arg.where.id];
        if (t === undefined || cocok(t, arg.where) === false) return { count: 0 };
        Object.assign(t, arg.data);
        return { count: 1 };
      },
    },
    receiptExtraction: {
      findFirst: async (arg) => {
        catat("receiptExtraction.findFirst", arg);
        const sama = s.ekstraksi.filter((e) => e.transactionId === arg.where.transactionId);
        return sama.length === 0 ? null : { version: Math.max(...sama.map((e) => e.version)) };
      },
      create: async ({ data }) => {
        catat("receiptExtraction.create", data);
        s.ekstraksi.push(data);
        return { id: 1 };
      },
    },
  };
  const penyimpanan = {
    simpan: async (buffer, tipe) => { catat("penyimpanan.simpan", { panjang: buffer.length, tipe }); const nama = "blob-" + (s.blob.size + 1) + ".bin"; s.blob.set(nama, buffer); return nama; },
    baca: async (nama) => { catat("penyimpanan.baca", nama); if (s.gagalBaca) throw new Error("azurite mati"); return s.blob.get(nama); },
    hapus: async (nama) => { catat("penyimpanan.hapus", nama); if (s.gagalHapus) throw new Error("hapus gagal"); s.blob.delete(nama); },
  };
  const pemverif = async (buffer, tipe) => {
    catat("pemverif", { panjang: buffer.length, tipe });
    if (s.hasil instanceof Error) throw s.hasil;
    return s.hasil ?? { isReceipt: true, total: 70000, confidence: 0.9, merchant: "Warung Sedap", purchasedAt: new Date("2026-10-05T05:30:00.000Z"), aiModel: "gemini-uji", promptVersion: "v-uji" };
  };
  const bacaTransaksi = async (klien, ctx, id) => ({ id, status: s.transaksi[id].status, receiptStatus: s.transaksi[id].receiptStatus });
  return { tx, s, log, penyimpanan, pemverif, layanan: buatLayananStruk({ penyimpanan, pemverif, bacaTransaksi }) };
}
const nama = (d) => d.log.map((l) => l.nama);
const ambil = (d, n) => d.log.filter((l) => l.nama === n);
const urut = (d, a, b) => nama(d).indexOf(a) >= 0 && nama(d).indexOf(a) < nama(d).indexOf(b);

describe("struk: unggah", () => {
  it("penjaga akses: tak ada 404, DRAFT orang lain 404, bukan DRAFT oleh bukan penalang 403, bukan DRAFT oleh penalang 409", async () => {
    const d = buatDunia({ transaksi: { 5: { id: 5, groupId: 7, payerId: 1, amount: 1, status: "DRAFT" }, 6: { id: 6, groupId: 7, payerId: 1, amount: 1, status: "ACTIVE" } } });
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 99, { buffer: JPEG }), galat(404, "not-found"));
    await assert.rejects(() => d.layanan.unggah(d.tx, anggota, 5, { buffer: JPEG }), galat(404, "not-found"));
    await assert.rejects(() => d.layanan.unggah(d.tx, anggota, 6, { buffer: JPEG }), galat(403, "forbidden"));
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 6, { buffer: JPEG }), galat(409, "invalid-state"));
    assert.equal(ambil(d, "penyimpanan.simpan").length, 0);
  });

  it("bukan gambar 415 dan di atas 5 MB 413, keduanya sebelum menyentuh penyimpanan", async () => {
    const d = buatDunia();
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 5, { buffer: Buffer.from("bukan gambar") }), galat(415, "unsupported-media-type"));
    const besar = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 5, { buffer: besar }), galat(413, "payload-too-large"));
    const persis = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 - 3)]);
    await d.layanan.unggah(d.tx, penalang, 5, { buffer: persis });
    assert.equal(ambil(d, "penyimpanan.simpan").length, 1);
  });

  it("hash sama dengan struk transaksi ACTIVE atau PENDING_APPROVAL lain di grup: 409 duplicate-receipt dengan existingTransactionId, tanpa menyimpan", async () => {
    const d = buatDunia({ kembar: { id: 31 } });
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 5, { buffer: JPEG }), (e) => e.status === 409 && e.code === "duplicate-receipt" && e.extra.existingTransactionId === 31);
    const cari = ambil(d, "transaction.findFirst").find((l) => Object.hasOwn(l.arg.where, "imageSha256")).arg.where;
    assert.deepEqual(cari, { groupId: 7, imageSha256: sha256Hex(JPEG), status: { in: ["ACTIVE", "PENDING_APPROVAL"] }, id: { not: 5 } });
    assert.equal(ambil(d, "penyimpanan.simpan").length, 0);
    assert.equal(ambil(d, "transaction.updateMany").length, 0);
  });

  it("berhasil: blob disimpan dengan tipe terdeteksi; hash, nama blob, status PENDING, dan fingerprint kosong ditulis dengan syarat DRAFT milik penalang", async () => {
    const d = buatDunia();
    d.s.transaksi[5].receiptStatus = "VERIFIED";
    const hasil = await d.layanan.unggah(d.tx, penalang, 5, { buffer: PNG });
    assert.deepEqual(ambil(d, "penyimpanan.simpan")[0].arg, { panjang: PNG.length, tipe: "image/png" });
    const tulis = ambil(d, "transaction.updateMany")[0].arg;
    assert.deepEqual(tulis.where, { id: 5, groupId: 7, payerId: 1, status: "DRAFT" });
    assert.deepEqual(tulis.data, { receiptUrl: "blob-1.bin", imageSha256: sha256Hex(PNG), receiptStatus: "PENDING", fingerprint: null });
    assert.equal(hasil.receiptStatus, "PENDING");
    assert.ok(urut(d, "penyimpanan.simpan", "transaction.updateMany"));
  });

  it("klaim gagal (status berubah): blob baru dihapus dan 409; galat saat menghapus blob tidak menutupi galat asli", async () => {
    const d = buatDunia();
    d.tx.transaction.updateMany = async () => ({ count: 0 });
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 5, { buffer: JPEG }), galat(409, "invalid-state"));
    assert.deepEqual(ambil(d, "penyimpanan.hapus").map((l) => l.arg), ["blob-1.bin"]);
    assert.equal(d.s.blob.size, 0);
    const gagalHapus = buatDunia({ gagalHapus: true });
    gagalHapus.tx.transaction.updateMany = async () => ({ count: 0 });
    await assert.rejects(() => gagalHapus.layanan.unggah(gagalHapus.tx, penalang, 5, { buffer: JPEG }), galat(409, "invalid-state"));
  });

  it("galat lain saat menulis transaksi juga membersihkan blob dan diteruskan apa adanya", async () => {
    const d = buatDunia();
    d.tx.transaction.updateMany = async () => { throw new Error("koneksi putus"); };
    await assert.rejects(() => d.layanan.unggah(d.tx, penalang, 5, { buffer: JPEG }), /koneksi putus/);
    assert.equal(ambil(d, "penyimpanan.hapus").length, 1);
  });
});

describe("struk: verifikasi", () => {
  const siapDiverifikasi = (ubah = {}, awal = {}) => {
    const d = buatDunia(awal);
    Object.assign(d.s.transaksi[5], { receiptUrl: "blob-9.bin", imageSha256: "abc123" }, ubah);
    d.s.blob.set("blob-9.bin", JPEG);
    return d;
  };

  it("penjaga: bukan penalang 404 atau 403; bukan DRAFT 409; struk belum diunggah 409; tanpa memanggil Gemini", async () => {
    let d = siapDiverifikasi();
    await assert.rejects(() => d.layanan.verifikasi(d.tx, anggota, 5), galat(404, "not-found"));
    d = siapDiverifikasi({ status: "ACTIVE" });
    await assert.rejects(() => d.layanan.verifikasi(d.tx, anggota, 5), galat(403, "forbidden"));
    await assert.rejects(() => d.layanan.verifikasi(d.tx, penalang, 5), galat(409, "invalid-state"));
    d = siapDiverifikasi({ receiptUrl: null });
    await assert.rejects(() => d.layanan.verifikasi(d.tx, penalang, 5), galat(409, "invalid-state"));
    assert.equal(ambil(d, "pemverif").length, 0);
  });

  it("penyimpanan gagal atau blob rusak 502 upstream-error; galat Gemini diteruskan; status tidak berubah", async () => {
    let d = siapDiverifikasi({}, { gagalBaca: true });
    await assert.rejects(() => d.layanan.verifikasi(d.tx, penalang, 5), galat(502, "upstream-error"));
    d = siapDiverifikasi();
    d.s.blob.set("blob-9.bin", Buffer.from("bukan gambar"));
    await assert.rejects(() => d.layanan.verifikasi(d.tx, penalang, 5), galat(502, "upstream-error"));
    d = siapDiverifikasi({}, { hasil: new (await import("../../src/utils/httpError.js")).HttpError(502, "upstream-error", "Gemini tidak merespons.") });
    await assert.rejects(() => d.layanan.verifikasi(d.tx, penalang, 5), galat(502, "upstream-error"));
    assert.equal(d.s.transaksi[5].receiptStatus, "PENDING");
    assert.equal(d.s.ekstraksi.length, 0);
    assert.equal(ambil(d, "transaction.updateMany").length, 0);
  });

  it("struk cocok: VERIFIED; Gemini dipanggil dengan isi dan tipe blob, sebelum klaim dan penulisan ekstraksi; hasil lengkap", async () => {
    const d = siapDiverifikasi();
    const hasil = await d.layanan.verifikasi(d.tx, penalang, 5);
    assert.deepEqual(ambil(d, "pemverif")[0].arg, { panjang: JPEG.length, tipe: "image/jpeg" });
    assert.ok(urut(d, "pemverif", "transaction.updateMany"));
    assert.ok(urut(d, "transaction.updateMany", "receiptExtraction.findFirst"));
    assert.ok(urut(d, "receiptExtraction.findFirst", "receiptExtraction.create"));
    const fp = fingerprintStruk({ merchant: "Warung Sedap", purchasedAt: new Date("2026-10-05T05:30:00.000Z"), total: 70000 });
    assert.deepEqual(ambil(d, "transaction.updateMany")[0].arg, {
      where: { id: 5, groupId: 7, payerId: 1, status: "DRAFT", imageSha256: "abc123" },
      data: { receiptStatus: "VERIFIED", fingerprint: fp },
    });
    const e = d.s.ekstraksi[0];
    assert.deepEqual([e.transactionId, e.version, e.source, e.createdBy, e.merchant, e.total, e.confidence, e.aiModel, e.promptVersion], [5, 1, "AI", 1, "Warung Sedap", 70000, 0.9, "gemini-uji", "v-uji"]);
    assert.deepEqual(e.purchasedAt, new Date("2026-10-05T05:30:00.000Z"));
    assert.deepEqual(JSON.parse(e.rawJson).decision, { status: "VERIFIED", reason: "ok" });
    assert.deepEqual(hasil.decision, { status: "VERIFIED", reason: "ok" });
    assert.deepEqual(hasil.detected, { total: 70000, confidence: 0.9 });
    assert.equal(hasil.transaction.receiptStatus, "VERIFIED");
  });

  it("keputusan gagal ditulis ke transaksi dan ekstraksi: bukan struk, keyakinan rendah, total tak terbaca, total berbeda", async () => {
    const dasar = { isReceipt: true, total: 70000, confidence: 0.9, merchant: null, purchasedAt: null, aiModel: "m", promptVersion: "p" };
    for (const [ubah, reason] of [[{ isReceipt: false }, "not-a-receipt"], [{ confidence: 0.2 }, "low-confidence"], [{ total: null }, "total-unreadable"], [{ total: 69000 }, "total-mismatch"]]) {
      const d = siapDiverifikasi({}, { hasil: { ...dasar, ...ubah } });
      const hasil = await d.layanan.verifikasi(d.tx, penalang, 5);
      assert.equal(d.s.transaksi[5].receiptStatus, "FAILED", reason);
      assert.equal(hasil.decision.reason, reason);
      assert.equal(JSON.parse(d.s.ekstraksi[0].rawJson).decision.reason, reason);
      assert.equal(ambil(d, "transaction.updateMany")[0].arg.data.fingerprint, null, "tanpa merchant dan waktu tidak ada fingerprint: " + reason);
    }
  });

  it("isi mirip struk lain di grup: NEEDS_REVIEW possible-duplicate dengan existingTransactionId; pencarian memakai fingerprint, status, dan bukan dirinya", async () => {
    const d = siapDiverifikasi({}, { mirip: { id: 44 } });
    const hasil = await d.layanan.verifikasi(d.tx, penalang, 5);
    assert.equal(d.s.transaksi[5].receiptStatus, "NEEDS_REVIEW");
    assert.deepEqual(hasil.decision, { status: "NEEDS_REVIEW", reason: "possible-duplicate", warnings: [{ code: "possible-duplicate", existingTransactionId: 44 }] });
    const cari = ambil(d, "transaction.findFirst").find((l) => Object.hasOwn(l.arg.where, "fingerprint")).arg.where;
    assert.deepEqual(cari, { groupId: 7, fingerprint: d.s.transaksi[5].fingerprint, status: { in: ["ACTIVE", "PENDING_APPROVAL"] }, id: { not: 5 } });
  });

  it("tanpa fingerprint (merchant atau waktu tak terbaca) pencarian mirip dilewati", async () => {
    const d = siapDiverifikasi({}, { hasil: { isReceipt: true, total: 70000, confidence: 0.9, merchant: "Warung", purchasedAt: null, aiModel: "m", promptVersion: "p" }, mirip: { id: 44 } });
    const hasil = await d.layanan.verifikasi(d.tx, penalang, 5);
    assert.equal(hasil.decision.status, "VERIFIED");
    assert.equal(ambil(d, "transaction.findFirst").filter((l) => Object.hasOwn(l.arg.where, "fingerprint")).length, 0);
  });

  it("klaim gagal (struk diganti atau status berubah selama verifikasi) 409 tanpa menulis ekstraksi", async () => {
    const d = siapDiverifikasi();
    d.tx.transaction.updateMany = async () => ({ count: 0 });
    await assert.rejects(() => d.layanan.verifikasi(d.tx, penalang, 5), galat(409, "invalid-state"));
    assert.equal(d.s.ekstraksi.length, 0);
  });

  it("verifikasi ulang menaikkan versi ekstraksi", async () => {
    const d = siapDiverifikasi();
    await d.layanan.verifikasi(d.tx, penalang, 5);
    await d.layanan.verifikasi(d.tx, penalang, 5);
    assert.deepEqual(d.s.ekstraksi.map((e) => e.version), [1, 2]);
  });
});
