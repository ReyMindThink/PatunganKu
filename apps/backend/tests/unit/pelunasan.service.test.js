import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananPelunasan, objekPelunasan } from "../../src/services/pelunasan.js";
import { kodeKursor } from "../../src/utils/pagination.js";
import { HttpError } from "../../src/utils/httpError.js";

const JAM = new Date("2026-11-22T09:30:00.000Z");
const DIBUAT = new Date("2026-11-22T08:00:00.000Z");
const ctxKirim = { userId: 2, groupId: 7 };
const ctxTerima = { userId: 1, groupId: 7 };

const baris = (id, tambah = {}) => ({
  id, groupId: 7, senderId: 2, receiverId: 1, amount: 30000, methodType: "CASH", methodId: null, methodProvider: null,
  methodAccountName: null, note: null, proofUrl: null, status: "PENDING", rejectReason: null,
  createdAt: new Date("2026-11-20T10:00:00.000Z"), decidedAt: null, cancelledAt: null, ...tambah,
});

function cocok(row, w) {
  return Object.entries(w).every(([k, v]) => {
    if (k === "OR") return v.some((x) => cocok(row, x));
    if (k === "AND") return v.every((x) => cocok(row, x));
    if (v instanceof Date) return row[k].getTime() === v.getTime();
    if ((v === null) === false && typeof v === "object") {
      const a = row[k] instanceof Date ? row[k].getTime() : row[k];
      const b = v.lt instanceof Date ? v.lt.getTime() : v.lt;
      return a < b;
    }
    return row[k] === v;
  });
}

// Database dan ledger palsu di memori; mencatat urutan panggilan dan membatalkan perubahan bila
// transaksi melempar (meniru rollback). BUKAN bukti SQL Server (itu tugas tes integrasi).
function buat({ rows = [], metode = [], saldo = {}, grup = { 7: { name: "Kos" } }, anggota = { "7:1": { status: "ACTIVE" }, "7:2": { status: "ACTIVE" }, "7:3": { status: "LEFT" } } } = {}) {
  const blob = { simpan: [], hapus: [], gagalSimpan: null, gagalHapus: null, unduhGalat: null, unduhIsi: null };
  const s = { rows: rows.map((r) => ({ ...r })), audit: [], log: [], dipanggil: [], catat: [], gagalCatat: null, nomor: 100, blob };
  const dengan = (r) => ({ ...r, sender: { id: r.senderId, name: "Pengguna " + r.senderId }, receiver: { id: r.receiverId, name: "Pengguna " + r.receiverId } });
  const pc = {
    findFirst: async ({ where }) => { s.log.push("pc.findFirst"); s.dipanggil.push(["findFirst", where]); const r = s.rows.find((x) => cocok(x, where)); return r === undefined ? null : dengan(r); },
    findMany: async ({ where, take, orderBy }) => {
      s.log.push("pc.findMany"); s.dipanggil.push(["findMany", where, take]);
      let hasil = s.rows.filter((x) => cocok(x, where));
      if (orderBy) hasil = hasil.sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime()) || (b.id - a.id));
      if (take) hasil = hasil.slice(0, take);
      return hasil.map(dengan);
    },
    create: async ({ data }) => { s.log.push("pc.create"); s.dipanggil.push(["create", data]); const r = baris(s.nomor++, { ...data, createdAt: DIBUAT }); s.rows.push(r); return dengan(r); },
    updateMany: async ({ where, data }) => {
      s.log.push("pc.updateMany"); s.dipanggil.push(["updateMany", where, data]);
      const kena = s.rows.filter((x) => cocok(x, where));
      for (const r of kena) Object.assign(r, data);
      return { count: kena.length };
    },
    findUnique: async ({ where }) => { s.log.push("pc.findUnique"); const r = s.rows.find((x) => x.id === where.id); return r === undefined ? null : dengan(r); },
  };
  const tx = {
    penanda: "tx",
    group: {
      findUnique: async ({ where }) => { s.log.push("group.findUnique"); return grup[where.id] ?? null; },
      update: async ({ where, data }) => { s.log.push("group.update"); s.dipanggil.push(["group.update", where, data]); return {}; },
    },
    groupMember: { findUnique: async ({ where }) => { s.log.push("groupMember.findUnique"); const k = where.groupId_userId; return anggota[k.groupId + ":" + k.userId] ?? null; } },
    paymentConfirmation: pc,
    paymentMethod: {
      // Setia pada select: hanya kolom yang diminta yang dikembalikan (seperti Prisma).
      findFirst: async ({ where, select }) => {
        s.log.push("pm.findFirst");
        s.dipanggil.push(["pm.findFirst", where, select]);
        const m = metode.find((x) => cocok(x, where));
        if (m === undefined) return null;
        return Object.fromEntries(Object.entries(select).filter(([, minta]) => minta).map(([k]) => [k, m[k]]));
      },
    },
    auditLog: { create: async ({ data }) => { s.log.push("audit:" + data.action); s.audit.push(data); return { id: s.audit.length }; } },
  };
  const db = {
    penanda: "db",
    paymentConfirmation: pc,
    $transaction: async (fn) => {
      const fotoRows = structuredClone(s.rows);
      const fotoAudit = s.audit.length;
      try {
        return await fn(tx);
      } catch (e) {
        s.rows = fotoRows;
        s.audit = s.audit.slice(0, fotoAudit);
        throw e;
      }
    },
  };
  const ledger = {
    saldoPasangan: async (g, a, b, klien) => { s.log.push("saldo:" + a + ">" + b + ":" + (klien ? klien.penanda : "tanpa")); s.dipanggil.push(["saldo", g, a, b]); return saldo[a + ":" + b] ?? 0; },
    catatPelunasan: async (klien, arg) => { s.log.push("ledger.catat:" + klien.penanda); s.catat.push(arg); if (s.gagalCatat) throw s.gagalCatat; return { entryId: 1 }; },
  };
  const penyimpanan = {
    simpan: async (buffer, tipe) => { s.log.push("blob.simpan"); if (blob.gagalSimpan) throw blob.gagalSimpan; const nama = "bukti-" + (blob.simpan.length + 1) + ".jpg"; blob.simpan.push({ buffer, tipe, nama }); return nama; },
    hapus: async (nama) => { s.log.push("blob.hapus"); blob.hapus.push(nama); if (blob.gagalHapus) throw blob.gagalHapus; },
    unduh: async (nama) => { s.log.push("blob.unduh:" + nama); if (blob.unduhGalat) throw blob.unduhGalat; return blob.unduhIsi ?? { buffer: Buffer.from("isi"), tipe: "image/jpeg" }; },
  };
  const layanan = buatLayananPelunasan({ db, ledger, penyimpanan, jam: () => JAM });
  // Pembungkus idempotensi menjalankan kirim dan konfirmasi di dalam transaksi: ditiru di sini.
  const dalamTx = (fn) => db.$transaction((t) => fn(t));
  return { s, db, tx, layanan, dalamTx };
}
const status = (e, kode, kodeGalat) => e instanceof HttpError && e.status === kode && e.code === kodeGalat;
const galat = (janji, kode, kodeGalat) => assert.rejects(janji, (e) => status(e, kode, kodeGalat), kodeGalat);
const isi = { receiverId: 1, amount: 10000, methodType: "CASH" };
const JPEG = (n = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(10)]);
const metodeBank = { id: 21, userId: 1, kind: "BANK", provider: "BCA", accountName: "Pemilik Satu", isActive: true };
const metodeDompet = { id: 22, userId: 1, kind: "EWALLET", provider: "Dana", accountName: "Pemilik Satu", isActive: true };

describe("pelunasan.kirim", () => {
  it("sukses: urutan periksa penerima, kunci grup, baca saldo lewat tx, baca tertunda, tulis, audit", async () => {
    const t = buat({ saldo: { "2:1": 30000 } });
    const hasil = await t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, { ...isi, note: "tunai" }));
    assert.deepEqual(t.s.log, ["groupMember.findUnique", "group.findUnique", "group.update", "saldo:2>1:tx", "pc.findMany", "pc.create", "audit:PAYMENT_SUBMIT"]);
    assert.deepEqual(hasil, {
      id: 100, groupId: 7, sender: { kind: "USER", id: 2, name: "Pengguna 2" }, receiver: { kind: "USER", id: 1, name: "Pengguna 1" },
      amount: 10000, methodType: "CASH", method: null, note: "tunai", hasProof: false, status: "PENDING", rejectReason: null,
      createdAt: "2026-11-22T08:00:00.000Z", decidedAt: null, cancelledAt: null,
    });
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "create")[1], { groupId: 7, senderId: 2, receiverId: 1, amount: 10000, methodType: "CASH", note: "tunai" });
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "group.update").slice(1), [{ id: 7 }, { name: "Kos" }]);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "saldo"), ["saldo", 7, 2, 1]);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "findMany")[1], { groupId: 7, senderId: 2, receiverId: 1, status: "PENDING" });
    assert.equal(t.s.audit.length, 1);
    const a = t.s.audit[0];
    assert.deepEqual([a.groupId, a.actorId, a.entity, a.entityId, a.action], [7, 2, "PaymentConfirmation", 100, "PAYMENT_SUBMIT"]);
    assert.equal(a.newValue, JSON.stringify({ receiverId: 1, amount: 10000, methodType: "CASH" }));
  });

  it("catatan yang tidak dikirim disimpan sebagai null", async () => {
    const t = buat({ saldo: { "2:1": 30000 } });
    const hasil = await t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, isi));
    assert.equal(t.s.dipanggil.find((d) => d[0] === "create")[1].note, null);
    assert.equal(hasil.note, null);
  });

  it("batas nominal = saldo dikurangi pelunasan PENDING pasangan yang sama (contoh kontrak 10.4)", async () => {
    const rows = [
      baris(1, { amount: 10000 }),
      baris(2, { amount: 5000, receiverId: 3 }),
      baris(3, { amount: 7000, status: "CONFIRMED" }),
      baris(4, { amount: 4000, senderId: 1, receiverId: 2 }),
      baris(5, { amount: 6000, groupId: 8 }),
    ];
    const sah = buat({ rows, saldo: { "2:1": 30000 } });
    await sah.dalamTx((tx) => sah.layanan.kirim(tx, ctxKirim, { ...isi, amount: 20000 }));
    assert.equal(sah.s.rows.length, 6);
    const lebih = buat({ rows, saldo: { "2:1": 30000 } });
    await assert.rejects(lebih.dalamTx((tx) => lebih.layanan.kirim(tx, ctxKirim, { ...isi, amount: 20001 })), (e) => status(e, 409, "amount-exceeds-debt") && e.extra.payable === 20000);
    assert.equal(lebih.s.rows.length, 5);
    assert.equal(lebih.s.audit.length, 0);
    const contoh = buat({ rows: [baris(1, { amount: 10000 })], saldo: { "2:1": 30000 } });
    await assert.rejects(contoh.dalamTx((tx) => contoh.layanan.kirim(tx, ctxKirim, { ...isi, amount: 25000 })), (e) => status(e, 409, "amount-exceeds-debt") && e.extra.payable === 20000);
  });

  it("tidak berutang (saldo nol atau negatif): 409 dengan payable 0, tanpa tulis dan tanpa audit", async () => {
    for (const saldo of [0, -5000]) {
      const t = buat({ saldo: { "2:1": saldo } });
      await assert.rejects(t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, { ...isi, amount: 1 })), (e) => status(e, 409, "amount-exceeds-debt") && e.extra.payable === 0, String(saldo));
      assert.equal(t.s.rows.length, 0);
      assert.equal(t.s.audit.length, 0);
    }
  });

  it("pelunasan tertunda yang melahap seluruh saldo membuat sisa 0, bukan negatif", async () => {
    const t = buat({ rows: [baris(1, { amount: 30000 }), baris(2, { amount: 5000 })], saldo: { "2:1": 30000 } });
    await assert.rejects(t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, { ...isi, amount: 1 })), (e) => status(e, 409, "amount-exceeds-debt") && e.extra.payable === 0);
  });

  it("ke diri sendiri: 400 invalid-receiver sebelum menyentuh database", async () => {
    const t = buat({ saldo: { "2:1": 30000 } });
    await assert.rejects(t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, { ...isi, receiverId: 2 })), (e) => status(e, 400, "invalid-receiver"));
    assert.deepEqual(t.s.log, []);
  });

  it("penerima bukan anggota grup: 400 invalid-receiver sebelum kunci grup", async () => {
    const t = buat({ saldo: { "2:9": 30000 } });
    await assert.rejects(t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, { ...isi, receiverId: 9 })), (e) => status(e, 400, "invalid-receiver"));
    assert.deepEqual(t.s.log, ["groupMember.findUnique"]);
  });

  it("mantan anggota boleh menjadi penerima selama masih dipiutangi", async () => {
    const t = buat({ saldo: { "2:3": 5000 } });
    const hasil = await t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, { ...isi, receiverId: 3, amount: 5000 }));
    assert.equal(hasil.receiver.id, 3);
  });

  it("grup tidak ditemukan: 404 dan tidak ada tulisan", async () => {
    const t = buat({ grup: {}, saldo: { "2:1": 30000 } });
    await galat(t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, isi)), 404, "not-found");
    assert.equal(t.s.log.includes("group.update"), false);
    assert.equal(t.s.rows.length, 0);
  });

  it("audit yang gagal membatalkan pelunasan yang baru dibuat", async () => {
    const t = buat({ saldo: { "2:1": 30000 } });
    t.tx.auditLog.create = async () => { throw new Error("audit gagal"); };
    await assert.rejects(t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, isi)), /audit gagal/);
    assert.equal(t.s.rows.length, 0);
  });
});

describe("pelunasan.kirim non-tunai (BANK dan EWALLET)", () => {
  const bank = { ...isi, methodType: "BANK", methodId: 21 };
  const kirimBank = (t, body = bank, bukti = { buffer: JPEG() }) => t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, body, bukti));
  const siap = (tambah = {}) => buat({ saldo: { "2:1": 30000 }, metode: [metodeBank, metodeDompet], ...tambah });

  it("sukses: periksa metode, kunci, saldo, unggah blob, tulis dengan snapshot metode dan nama blob, audit memuat methodId", async () => {
    const t = siap();
    const hasil = await kirimBank(t);
    assert.deepEqual(t.s.log, ["groupMember.findUnique", "pm.findFirst", "group.findUnique", "group.update", "saldo:2>1:tx", "pc.findMany", "blob.simpan", "pc.create", "audit:PAYMENT_SUBMIT"]);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "pm.findFirst").slice(1), [{ id: 21, userId: 1, kind: "BANK", isActive: true }, { id: true, provider: true, accountName: true }]);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "create")[1], {
      groupId: 7, senderId: 2, receiverId: 1, amount: 10000, methodType: "BANK", note: null,
      methodId: 21, methodProvider: "BCA", methodAccountName: "Pemilik Satu", proofUrl: "bukti-1.jpg",
    });
    assert.equal(t.s.blob.simpan.length, 1);
    assert.equal(t.s.blob.simpan[0].tipe, "image/jpeg");
    assert.equal(t.s.blob.simpan[0].buffer.length, JPEG().length);
    assert.deepEqual(hasil.method, { id: 21, provider: "BCA", accountName: "Pemilik Satu" });
    assert.equal(hasil.hasProof, true);
    assert.equal(hasil.methodType, "BANK");
    assert.equal(JSON.stringify(hasil).includes("bukti-1.jpg"), false);
    assert.equal(t.s.audit[0].newValue, JSON.stringify({ receiverId: 1, amount: 10000, methodType: "BANK", methodId: 21 }));
    assert.equal(t.s.blob.hapus.length, 0);
  });

  it("EWALLET dan tipe gambar PNG serta WebP diteruskan ke penyimpanan sesuai byte", async () => {
    for (const [gambar, tipe] of [[PNG, "image/png"], [WEBP, "image/webp"], [JPEG(), "image/jpeg"]]) {
      const t = siap();
      const hasil = await kirimBank(t, { ...isi, methodType: "EWALLET", methodId: 22 }, { buffer: gambar });
      assert.equal(t.s.blob.simpan[0].tipe, tipe);
      assert.equal(hasil.methodType, "EWALLET");
      assert.deepEqual(hasil.method, { id: 22, provider: "Dana", accountName: "Pemilik Satu" });
    }
  });

  it("metode bukan milik penerima, nonaktif, jenis berbeda, atau tidak ada: 409 no-accepted-method tanpa kunci, unggah, dan tulis", async () => {
    const kasus = [
      [{ metode: [{ ...metodeBank, userId: 3 }] }, bank],
      [{ metode: [{ ...metodeBank, isActive: false }] }, bank],
      [{ metode: [metodeBank] }, { ...bank, methodType: "EWALLET" }],
      [{ metode: [metodeDompet] }, bank],
      [{ metode: [] }, bank],
      [{ metode: [metodeBank] }, { ...bank, methodId: 999 }],
    ];
    for (const [tambah, body] of kasus) {
      const t = siap(tambah);
      await galat(kirimBank(t, body), 409, "no-accepted-method");
      assert.equal(t.s.log.includes("group.update"), false);
      assert.equal(t.s.blob.simpan.length, 0);
      assert.equal(t.s.rows.length, 0);
      assert.equal(t.s.audit.length, 0);
    }
  });

  it("format bukan JPEG, PNG, atau WebP: 415 sebelum menyentuh database; lebih dari 5 MB: 413; tepat 5 MB lolos", async () => {
    const a = siap();
    await galat(kirimBank(a, bank, { buffer: Buffer.from("bukan gambar") }), 415, "unsupported-media-type");
    assert.deepEqual(a.s.log, []);
    const b = siap();
    await galat(kirimBank(b, bank, { buffer: JPEG(5 * 1024 * 1024) }), 413, "payload-too-large");
    assert.deepEqual(b.s.log, []);
    const c = siap();
    await kirimBank(c, bank, { buffer: JPEG(5 * 1024 * 1024 - 4) });
    assert.equal(c.s.blob.simpan.length, 1);
    const d = siap();
    await galat(kirimBank(d, bank, { buffer: Buffer.alloc(0) }), 415, "unsupported-media-type");
  });

  it("penerima tidak sah, diri sendiri, atau nominal melebihi sisa: galat yang sama seperti tunai dan tanpa unggah", async () => {
    const a = siap();
    await galat(kirimBank(a, { ...bank, receiverId: 2 }), 400, "invalid-receiver");
    const b = siap();
    await galat(kirimBank(b, { ...bank, receiverId: 9 }), 400, "invalid-receiver");
    const c = siap();
    await assert.rejects(kirimBank(c, { ...bank, amount: 30001 }), (e) => status(e, 409, "amount-exceeds-debt") && e.extra.payable === 30000);
    for (const t of [a, b, c]) assert.equal(t.s.blob.simpan.length, 0);
  });

  it("tulis atau audit gagal sesudah unggah: blob dihapus dan galat asli diteruskan", async () => {
    const a = siap();
    a.tx.paymentConfirmation.create = async () => { throw new Error("tulis gagal"); };
    await assert.rejects(kirimBank(a), /tulis gagal/);
    assert.deepEqual(a.s.blob.hapus, ["bukti-1.jpg"]);
    const b = siap();
    b.tx.auditLog.create = async () => { throw new Error("audit gagal"); };
    await assert.rejects(kirimBank(b), /audit gagal/);
    assert.deepEqual(b.s.blob.hapus, ["bukti-1.jpg"]);
    assert.equal(b.s.rows.length, 0);
  });

  it("galat saat menghapus blob ditelan dan galat asli tetap yang keluar", async () => {
    const t = siap();
    t.s.blob.gagalHapus = new Error("hapus gagal");
    t.tx.auditLog.create = async () => { throw new Error("audit gagal"); };
    await assert.rejects(kirimBank(t), /audit gagal/);
    assert.equal(t.s.blob.hapus.length, 1);
  });

  it("unggah blob gagal: galat diteruskan, tidak ada tulisan, dan tidak ada yang dihapus", async () => {
    const t = siap();
    t.s.blob.gagalSimpan = new Error("blob gagal");
    await assert.rejects(kirimBank(t), /blob gagal/);
    assert.equal(t.s.rows.length, 0);
    assert.equal(t.s.blob.hapus.length, 0);
  });

  it("CASH mengabaikan bukti: tidak diunggah dan tidak ada kolom metode atau bukti pada tulisan", async () => {
    const t = siap();
    await t.dalamTx((tx) => t.layanan.kirim(tx, ctxKirim, isi, { buffer: JPEG() }));
    assert.equal(t.s.blob.simpan.length, 0);
    assert.deepEqual(Object.keys(t.s.dipanggil.find((d) => d[0] === "create")[1]).sort(), ["amount", "groupId", "methodType", "note", "receiverId", "senderId"]);
    assert.equal(t.s.log.includes("pm.findFirst"), false);
  });
});

describe("pelunasan.bukti", () => {
  const berbukti = (tambah = {}) => baris(801, { methodType: "BANK", methodId: 21, methodProvider: "BCA", methodAccountName: "P", proofUrl: "bukti-9.png", ...tambah });

  it("pengirim dan penerima menerima isi dan tipe berkas sesuai nama blob di pelunasan", async () => {
    const t = buat({ rows: [berbukti()] });
    t.s.blob.unduhIsi = { buffer: Buffer.from("png-isi"), tipe: "image/png" };
    for (const ctx of [ctxKirim, ctxTerima]) {
      const hasil = await t.layanan.bukti(ctx, 801);
      assert.equal(hasil.buffer.toString(), "png-isi");
      assert.equal(hasil.tipe, "image/png");
    }
    assert.equal(t.s.log.filter((l) => l === "blob.unduh:bukti-9.png").length, 2);
  });

  it("tipe yang bukan gambar kita sendiri menjadi application/octet-stream", async () => {
    for (const tipe of ["text/html", "image/svg+xml", undefined, "", "image/gif"]) {
      const t = buat({ rows: [berbukti()] });
      t.s.blob.unduhIsi = { buffer: Buffer.from("x"), tipe };
      assert.equal((await t.layanan.bukti(ctxTerima, 801)).tipe, "application/octet-stream", String(tipe));
    }
    for (const tipe of ["image/jpeg", "image/png", "image/webp"]) {
      const t = buat({ rows: [berbukti()] });
      t.s.blob.unduhIsi = { buffer: Buffer.from("x"), tipe };
      assert.equal((await t.layanan.bukti(ctxTerima, 801)).tipe, tipe);
    }
  });

  it("bukan pihak, grup lain, dan id tak ada: 404 tanpa membaca blob", async () => {
    const t = buat({ rows: [berbukti(), berbukti({ id: 802, groupId: 8 })] });
    await galat(t.layanan.bukti({ userId: 3, groupId: 7 }, 801), 404, "not-found");
    await galat(t.layanan.bukti(ctxTerima, 802), 404, "not-found");
    await galat(t.layanan.bukti(ctxTerima, 999), 404, "not-found");
    assert.equal(t.s.log.some((l) => l.startsWith("blob.")), false);
  });

  it("pelunasan tunai tidak punya bukti: 404 tanpa membaca blob", async () => {
    const t = buat({ rows: [baris(801)] });
    await galat(t.layanan.bukti(ctxTerima, 801), 404, "not-found");
    assert.equal(t.s.log.some((l) => l.startsWith("blob.")), false);
  });

  it("blob hilang (statusCode 404) menjadi 404 not-found; galat lain diteruskan apa adanya", async () => {
    const a = buat({ rows: [berbukti()] });
    a.s.blob.unduhGalat = Object.assign(new Error("blob tidak ada"), { statusCode: 404 });
    await galat(a.layanan.bukti(ctxTerima, 801), 404, "not-found");
    const b = buat({ rows: [berbukti()] });
    b.s.blob.unduhGalat = Object.assign(new Error("azure mati"), { statusCode: 500 });
    await assert.rejects(b.layanan.bukti(ctxTerima, 801), /azure mati/);
    const c = buat({ rows: [berbukti()] });
    c.s.blob.unduhGalat = new Error("tanpa kode");
    await assert.rejects(c.layanan.bukti(ctxTerima, 801), /tanpa kode/);
  });
});

describe("pelunasan.konfirmasi", () => {
  const satu = (tambah, opsi = {}) => buat({ rows: [baris(801, tambah)], saldo: { "2:1": 30000 }, ...opsi });

  it("sukses: baca milik, kunci grup, klaim, cek saldo lewat tx, catat SETTLEMENT, audit, baca ulang", async () => {
    const t = satu();
    const hasil = await t.dalamTx((tx) => t.layanan.konfirmasi(tx, ctxTerima, 801));
    assert.deepEqual(t.s.log, ["pc.findFirst", "group.findUnique", "group.update", "pc.updateMany", "saldo:2>1:tx", "ledger.catat:tx", "audit:PAYMENT_CONFIRM", "pc.findUnique"]);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "findFirst")[1], { id: 801, groupId: 7 });
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "updateMany").slice(1), [{ id: 801, groupId: 7, receiverId: 1, status: "PENDING" }, { status: "CONFIRMED", decidedAt: JAM }]);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "saldo"), ["saldo", 7, 2, 1]);
    assert.deepEqual(t.s.catat, [{ groupId: 7, paymentId: 801, pengirimId: 2, penerimaId: 1, jumlah: 30000, createdBy: 1 }]);
    assert.equal(hasil.status, "CONFIRMED");
    assert.equal(hasil.decidedAt, "2026-11-22T09:30:00.000Z");
    assert.equal(hasil.cancelledAt, null);
    const a = t.s.audit[0];
    assert.deepEqual([a.groupId, a.actorId, a.entity, a.entityId, a.action], [7, 1, "PaymentConfirmation", 801, "PAYMENT_CONFIRM"]);
    assert.equal(a.newValue, JSON.stringify({ amount: 30000 }));
  });

  it("cek ulang K25: saldo sama dengan nominal lolos; kurang satu rupiah 409 dan seluruhnya dibatalkan", async () => {
    const pas = buat({ rows: [baris(801)], saldo: { "2:1": 30000 } });
    await pas.dalamTx((tx) => pas.layanan.konfirmasi(tx, ctxTerima, 801));
    assert.equal(pas.s.catat.length, 1);
    for (const [saldo, payable] of [[29999, 29999], [0, 0], [-5000, 0]]) {
      const t = buat({ rows: [baris(801)], saldo: { "2:1": saldo } });
      await assert.rejects(t.dalamTx((tx) => t.layanan.konfirmasi(tx, ctxTerima, 801)), (e) => status(e, 409, "amount-exceeds-debt") && e.extra.payable === payable, String(saldo));
      assert.equal(t.s.rows[0].status, "PENDING", "klaim harus dibatalkan");
      assert.equal(t.s.rows[0].decidedAt, null);
      assert.equal(t.s.catat.length, 0);
      assert.equal(t.s.audit.length, 0);
    }
  });

  it("bukan pihak, tidak ada, atau milik grup lain: 404 tanpa menyentuh yang lain", async () => {
    const t = satu();
    await galat(t.dalamTx((tx) => t.layanan.konfirmasi(tx, { userId: 9, groupId: 7 }, 801)), 404, "not-found");
    await galat(t.dalamTx((tx) => t.layanan.konfirmasi(tx, ctxTerima, 999)), 404, "not-found");
    const lain = satu({ groupId: 8 });
    await galat(lain.dalamTx((tx) => lain.layanan.konfirmasi(tx, ctxTerima, 801)), 404, "not-found");
    assert.deepEqual(t.s.log.filter((l) => (l === "pc.findFirst") === false), []);
    assert.equal(t.s.rows[0].status, "PENDING");
  });

  it("pengirim tidak boleh mengonfirmasi: 403 sebelum kunci dan klaim", async () => {
    const t = satu();
    await galat(t.dalamTx((tx) => t.layanan.konfirmasi(tx, ctxKirim, 801)), 403, "forbidden");
    assert.deepEqual(t.s.log, ["pc.findFirst"]);
  });

  it("sudah CONFIRMED, REJECTED, atau CANCELLED: 409 invalid-state tanpa ledger dan audit", async () => {
    for (const st of ["CONFIRMED", "REJECTED", "CANCELLED"]) {
      const t = satu({ status: st });
      await galat(t.dalamTx((tx) => t.layanan.konfirmasi(tx, ctxTerima, 801)), 409, "invalid-state");
      assert.equal(t.s.catat.length + t.s.audit.length, 0, st);
      assert.equal(t.s.log.some((l) => l.startsWith("saldo")), false, st);
    }
  });

  it("galat dari ledger atau audit membatalkan klaim status", async () => {
    const a = satu();
    a.s.gagalCatat = new Error("ledger gagal");
    await assert.rejects(a.dalamTx((tx) => a.layanan.konfirmasi(tx, ctxTerima, 801)), /ledger gagal/);
    assert.equal(a.s.rows[0].status, "PENDING");
    const b = satu();
    b.tx.auditLog.create = async () => { throw new Error("audit gagal"); };
    await assert.rejects(b.dalamTx((tx) => b.layanan.konfirmasi(tx, ctxTerima, 801)), /audit gagal/);
    assert.equal(b.s.rows[0].status, "PENDING");
  });
});

describe("pelunasan.tolak dan pelunasan.batal", () => {
  const satu = (tambah) => buat({ rows: [baris(801, tambah)], saldo: { "2:1": 30000 } });

  it("tolak: klaim WHERE PENDING oleh penerima, simpan alasan, audit dengan alasan, tanpa kunci grup dan ledger", async () => {
    const t = satu();
    const hasil = await t.layanan.tolak(ctxTerima, 801, { reason: "tidak sesuai" });
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "updateMany").slice(1), [{ id: 801, groupId: 7, receiverId: 1, status: "PENDING" }, { status: "REJECTED", rejectReason: "tidak sesuai", decidedAt: JAM }]);
    assert.deepEqual(t.s.log, ["pc.findFirst", "pc.updateMany", "audit:PAYMENT_REJECT", "pc.findUnique"]);
    assert.equal(hasil.status, "REJECTED");
    assert.equal(hasil.rejectReason, "tidak sesuai");
    assert.equal(hasil.decidedAt, "2026-11-22T09:30:00.000Z");
    const a = t.s.audit[0];
    assert.deepEqual([a.groupId, a.actorId, a.entity, a.entityId, a.action, a.reason], [7, 1, "PaymentConfirmation", 801, "PAYMENT_REJECT", "tidak sesuai"]);
  });

  it("tolak tanpa alasan (tanpa argumen ketiga): rejectReason null dan audit tanpa alasan", async () => {
    const t = satu();
    const hasil = await t.layanan.tolak(ctxTerima, 801);
    assert.equal(hasil.rejectReason, null);
    assert.equal(t.s.dipanggil.find((d) => d[0] === "updateMany")[2].rejectReason, null);
    assert.equal(t.s.audit[0].reason ?? null, null);
  });

  it("tolak: pengirim 403, bukan pihak 404, sudah diputuskan 409; keadaan tidak berubah", async () => {
    const a = satu();
    await galat(a.layanan.tolak(ctxKirim, 801, {}), 403, "forbidden");
    assert.deepEqual(a.s.log, ["pc.findFirst"]);
    const b = satu();
    await galat(b.layanan.tolak({ userId: 9, groupId: 7 }, 801, {}), 404, "not-found");
    for (const st of ["CONFIRMED", "REJECTED", "CANCELLED"]) {
      const c = satu({ status: st });
      await galat(c.layanan.tolak(ctxTerima, 801, { reason: "x" }), 409, "invalid-state");
      assert.equal(c.s.audit.length, 0);
      assert.equal(c.s.rows[0].status, st);
    }
  });

  it("batal: klaim WHERE PENDING oleh pengirim, audit tanpa alasan", async () => {
    const t = satu();
    const hasil = await t.layanan.batal(ctxKirim, 801);
    assert.deepEqual(t.s.dipanggil.find((d) => d[0] === "updateMany").slice(1), [{ id: 801, groupId: 7, senderId: 2, status: "PENDING" }, { status: "CANCELLED", cancelledAt: JAM }]);
    assert.deepEqual(t.s.log, ["pc.findFirst", "pc.updateMany", "audit:PAYMENT_CANCEL", "pc.findUnique"]);
    assert.equal(hasil.status, "CANCELLED");
    assert.equal(hasil.cancelledAt, "2026-11-22T09:30:00.000Z");
    assert.equal(hasil.decidedAt, null);
    assert.deepEqual([t.s.audit[0].groupId, t.s.audit[0].actorId, t.s.audit[0].entityId], [7, 2, 801]);
    assert.equal(t.s.audit[0].reason ?? null, null);
  });

  it("batal: penerima 403, bukan pihak 404, sudah diputuskan 409", async () => {
    const a = satu();
    await galat(a.layanan.batal(ctxTerima, 801), 403, "forbidden");
    const b = satu();
    await galat(b.layanan.batal({ userId: 9, groupId: 7 }, 801), 404, "not-found");
    for (const st of ["CONFIRMED", "REJECTED", "CANCELLED"]) {
      const c = satu({ status: st });
      await galat(c.layanan.batal(ctxKirim, 801), 409, "invalid-state");
      assert.equal(c.s.rows[0].status, st);
    }
  });

  it("klaim 0 baris di tengah jalan (diputuskan serentak): 409 tanpa audit", async () => {
    const t = satu();
    const asli = t.tx.paymentConfirmation.updateMany;
    t.tx.paymentConfirmation.updateMany = async (a) => (a.where.status === "PENDING" ? { count: 0 } : asli(a));
    await galat(t.layanan.tolak(ctxTerima, 801, {}), 409, "invalid-state");
    assert.equal(t.s.audit.length, 0);
  });

  it("audit yang gagal membatalkan perubahan status", async () => {
    const t = satu();
    t.tx.auditLog.create = async () => { throw new Error("audit gagal"); };
    await assert.rejects(t.layanan.batal(ctxKirim, 801), /audit gagal/);
    assert.equal(t.s.rows[0].status, "PENDING");
    assert.equal(t.s.rows[0].cancelledAt, null);
  });
});

describe("pelunasan.detail", () => {
  it("pengirim dan penerima boleh membaca; bukan pihak dan grup lain 404", async () => {
    const t = buat({ rows: [baris(801), baris(802, { groupId: 8 })] });
    assert.equal((await t.layanan.detail(ctxKirim, 801)).id, 801);
    assert.equal((await t.layanan.detail(ctxTerima, 801)).id, 801);
    await galat(t.layanan.detail({ userId: 3, groupId: 7 }, 801), 404, "not-found");
    await galat(t.layanan.detail(ctxTerima, 802), 404, "not-found");
    await galat(t.layanan.detail(ctxTerima, 999), 404, "not-found");
  });
});

describe("pelunasan.daftar", () => {
  const rows = () => [
    baris(1, { createdAt: new Date("2026-11-20T10:00:00.000Z") }),
    baris(2, { senderId: 1, receiverId: 3, status: "CONFIRMED", createdAt: new Date("2026-11-20T11:00:00.000Z") }),
    baris(3, { senderId: 3, receiverId: 2, createdAt: new Date("2026-11-20T12:00:00.000Z") }),
    baris(4, { status: "CANCELLED", createdAt: new Date("2026-11-20T12:00:00.000Z") }),
    baris(5, { groupId: 8, createdAt: new Date("2026-11-20T13:00:00.000Z") }),
  ];
  const ids = (h) => h.data.map((p) => p.id);
  const q = (tambah = {}) => ({ limit: 20, ...tambah });

  it("tanpa role: yang dikirim dan diterima pemanggil saja, di grup ini, terbaru dulu dengan id sebagai pemecah seri", async () => {
    const t = buat({ rows: rows() });
    const h = await t.layanan.daftar(ctxTerima, q());
    assert.deepEqual(ids(h), [4, 2, 1]);
    assert.equal(h.hasMore, false);
    assert.equal(h.nextCursor, null);
  });

  it("role sent dan received menyaring sisi pemanggil; status menyaring status", async () => {
    const t = buat({ rows: rows() });
    assert.deepEqual(ids(await t.layanan.daftar(ctxTerima, q({ role: "sent" }))), [2]);
    assert.deepEqual(ids(await t.layanan.daftar(ctxTerima, q({ role: "received" }))), [4, 1]);
    assert.deepEqual(ids(await t.layanan.daftar(ctxTerima, q({ status: "PENDING" }))), [1]);
    assert.deepEqual(ids(await t.layanan.daftar(ctxTerima, q({ role: "received", status: "CANCELLED" }))), [4]);
    assert.deepEqual(ids(await t.layanan.daftar(ctxKirim, q({ role: "sent" }))), [4, 1]);
  });

  it("halaman berkursor: limit 2 lalu sisanya lewat kursor, tanpa duplikat", async () => {
    const t = buat({ rows: rows() });
    const p1 = await t.layanan.daftar(ctxTerima, q({ limit: 2 }));
    assert.deepEqual(ids(p1), [4, 2]);
    assert.equal(p1.hasMore, true);
    assert.equal(p1.nextCursor, kodeKursor({ t: "2026-11-20T11:00:00.000Z", id: 2 }));
    const p2 = await t.layanan.daftar(ctxTerima, q({ limit: 2, cursor: p1.nextCursor }));
    assert.deepEqual(ids(p2), [1]);
    assert.equal(p2.hasMore, false);
    assert.equal(p2.nextCursor, null);
  });

  it("kursor pada waktu yang sama memakai id sebagai pemecah seri", async () => {
    const t = buat({ rows: [...rows(), baris(6, { createdAt: new Date("2026-11-20T12:00:00.000Z") })] });
    const p1 = await t.layanan.daftar(ctxTerima, q({ limit: 1 }));
    assert.deepEqual(ids(p1), [6]);
    const p2 = await t.layanan.daftar(ctxTerima, q({ limit: 1, cursor: p1.nextCursor }));
    assert.deepEqual(ids(p2), [4]);
    const p3 = await t.layanan.daftar(ctxTerima, q({ limit: 1, cursor: p2.nextCursor }));
    assert.deepEqual(ids(p3), [2]);
  });

  it("kursor rusak, atau base64 sah tetapi bentuknya salah: 400 validation-failed", async () => {
    const t = buat({ rows: rows() });
    const buruk = ["bukan-kursor", kodeKursor({ foo: 1 }), kodeKursor({ t: "bukan-waktu", id: 1 }), kodeKursor({ t: "2026-11-20T11:00:00.000Z", id: 0 }), kodeKursor({ t: "2026-11-20T11:00:00.000Z", id: "2" })];
    for (const cursor of buruk) {
      await assert.rejects(t.layanan.daftar(ctxTerima, q({ cursor })), (e) => status(e, 400, "validation-failed"), cursor);
    }
    assert.equal(t.s.log.includes("pc.findMany"), false);
  });

  it("meminta satu baris lebih banyak dari limit untuk mengetahui hasMore", async () => {
    const t = buat({ rows: rows() });
    await t.layanan.daftar(ctxTerima, q({ limit: 2 }));
    assert.equal(t.s.dipanggil.filter((d) => d[0] === "findMany").at(-1)[2], 3);
  });

  it("objek daftar memuat nama pihak dan bentuk yang sama dengan detail", async () => {
    const t = buat({ rows: rows() });
    const h = await t.layanan.daftar(ctxTerima, q({ role: "sent" }));
    assert.deepEqual(h.data[0], await t.layanan.detail(ctxTerima, 2));
    assert.deepEqual(h.data[0].sender, { kind: "USER", id: 1, name: "Pengguna 1" });
  });
});

describe("objekPelunasan", () => {
  const dengan = (r) => ({ ...r, sender: { id: r.senderId, name: "Rey" }, receiver: { id: r.receiverId, name: "Aqidatul" } });

  it("tunai: method null, hasProof false, tanggal ISO atau null", () => {
    assert.deepEqual(objekPelunasan(dengan(baris(801))), {
      id: 801, groupId: 7, sender: { kind: "USER", id: 2, name: "Rey" }, receiver: { kind: "USER", id: 1, name: "Aqidatul" },
      amount: 30000, methodType: "CASH", method: null, note: null, hasProof: false, status: "PENDING", rejectReason: null,
      createdAt: "2026-11-20T10:00:00.000Z", decidedAt: null, cancelledAt: null,
    });
  });

  it("non-tunai: method terisi, hasProof true, alamat berkas tidak pernah keluar", () => {
    const o = objekPelunasan(dengan(baris(801, { methodType: "EWALLET", methodId: 21, methodProvider: "Dana", methodAccountName: "Aqidatul I.", proofUrl: "rahasia.jpg", note: "n", status: "REJECTED", rejectReason: "salah", decidedAt: new Date("2026-11-21T00:00:00.000Z") })));
    assert.deepEqual(o.method, { id: 21, provider: "Dana", accountName: "Aqidatul I." });
    assert.equal(o.hasProof, true);
    assert.equal(Object.hasOwn(o, "proofUrl"), false);
    assert.equal(JSON.stringify(o).includes("rahasia.jpg"), false);
    assert.equal(o.decidedAt, "2026-11-21T00:00:00.000Z");
    assert.equal(o.rejectReason, "salah");
  });
});
