import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananMetodeBayar } from "../../src/services/metodeBayar.js";
import { buatEnkripsi } from "../../src/utils/enkripsi.js";
import { HttpError } from "../../src/utils/httpError.js";

const KUNCI = Buffer.alloc(32, 5).toString("base64");
const kripto = buatEnkripsi({ kunci: KUNCI });
const sandi = (userId, nomor) => kripto.enkripsi(nomor, "PaymentMethod:" + userId);

// Database palsu di memori. Mencatat urutan panggilan dan membatalkan perubahan bila
// transaksi melempar (meniru rollback). Ini BUKAN bukti perilaku SQL Server.
function buatDb(awal = []) {
  let baris = awal.map((m) => ({ provider: null, accountNo: null, accountName: null, isActive: true, ...m }));
  let audit = [];
  const log = [];
  let nomor = 100;
  const cocok = (m, where) => Object.entries(where).every(([k, v]) => m[k] === v);
  const pm = {
    updateMany: async ({ where, data }) => {
      log.push(["updateMany", where, data]);
      const kena = baris.filter((m) => cocok(m, where));
      for (const m of kena) Object.assign(m, data);
      return { count: kena.length };
    },
    findFirst: async ({ where }) => {
      log.push(["findFirst", where]);
      const m = baris.find((x) => cocok(x, where));
      return m === undefined ? null : { ...m };
    },
    findMany: async ({ where, orderBy }) => {
      log.push(["findMany", where, orderBy]);
      return baris.filter((m) => cocok(m, where)).sort((a, b) => a.id - b.id).map((m) => ({ ...m }));
    },
    findUnique: async ({ where }) => {
      log.push(["findUnique", where]);
      const m = baris.find((x) => x.id === where.id);
      return m === undefined ? null : { ...m };
    },
    create: async ({ data }) => {
      log.push(["create", data]);
      const m = { id: nomor++, provider: null, accountNo: null, accountName: null, isActive: true, ...data };
      baris.push(m);
      return { ...m };
    },
  };
  const db = {
    paymentMethod: pm,
    auditLog: {
      create: async ({ data }) => {
        log.push(["audit", data.action]);
        audit.push(data);
        return { id: audit.length };
      },
    },
    $transaction: async (fn) => {
      const fotoBaris = JSON.parse(JSON.stringify(baris));
      const fotoAudit = audit.length;
      try {
        return await fn(db);
      } catch (e) {
        baris = fotoBaris;
        audit = audit.slice(0, fotoAudit);
        throw e;
      }
    },
  };
  return { db, log, baris: () => baris, audit: () => audit };
}

const ledgerPalsu = (saldo = {}) => {
  const panggilan = [];
  return { panggilan, saldoPasangan: async (g, a, b) => { panggilan.push([g, a, b]); return saldo[a + ":" + b] ?? 0; } };
};
const buat = (awal, opsi = {}) => {
  const d = buatDb(awal);
  const ledger = opsi.ledger ?? ledgerPalsu();
  return { ...d, ledger, layanan: buatLayananMetodeBayar({ db: d.db, enkripsi: opsi.enkripsi ?? kripto, ledger }) };
};
const galat = async (janji, status, kode) => {
  await assert.rejects(janji, (e) => e instanceof HttpError && e.status === status && e.code === kode, kode);
};
const bank = (id, userId, nomor = "1234567890", lain = {}) => ({ id, userId, kind: "BANK", provider: "BCA", accountNo: sandi(userId, nomor), accountName: "Nama " + id, ...lain });
const tunai = (id, userId, lain = {}) => ({ id, userId, kind: "CASH", ...lain });

describe("metodeBayar.daftarSaya", () => {
  it("mengembalikan semua metode milik sendiri (aktif dan nonaktif) urut id, nomor terbuka, tanpa bidang dalam", async () => {
    const { layanan, log } = buat([bank(3, 1, "111111"), tunai(1, 1), bank(2, 1, "222222", { isActive: false }), bank(9, 2, "999999")]);
    const hasil = await layanan.daftarSaya(1);
    assert.deepEqual(hasil, [
      { id: 1, kind: "CASH", provider: null, accountName: null, accountNo: null, isActive: true },
      { id: 2, kind: "BANK", provider: "BCA", accountName: "Nama 2", accountNo: "222222", isActive: false },
      { id: 3, kind: "BANK", provider: "BCA", accountName: "Nama 3", accountNo: "111111", isActive: true },
    ]);
    assert.deepEqual(log[0], ["findMany", { userId: 1 }, [{ id: "asc" }]]);
  });

  it("pengguna tanpa metode mendapat daftar kosong", async () => {
    assert.deepEqual(await buat([]).layanan.daftarSaya(1), []);
  });

  it("tanpa kunci enkripsi: galat konfigurasi dan database tidak disentuh", async () => {
    const { layanan, log } = buat([], { enkripsi: buatEnkripsi({}) });
    await assert.rejects(layanan.daftarSaya(1), /PAYMENT_ENC_KEY belum diisi/);
    assert.deepEqual(log, []);
  });

  it("teks sandi yang dipindah ke pengguna lain tidak dapat dibuka (terikat ke pemilik)", async () => {
    const { layanan } = buat([{ id: 1, userId: 2, kind: "BANK", provider: "BCA", accountNo: sandi(1, "1234567890"), accountName: "x" }]);
    await assert.rejects(layanan.daftarSaya(2), /data tidak sah/);
  });
});

describe("metodeBayar.tambah", () => {
  const isi = { kind: "BANK", provider: "BCA", accountNo: "1234567890", accountName: "Rasyid" };

  it("menyimpan nomor terenkripsi terikat ke pengguna, mengembalikan nomor asli, dan menulis satu audit", async () => {
    const { layanan, log, baris, audit } = buat([]);
    const hasil = await layanan.tambah(7, isi);
    assert.deepEqual(hasil, { id: 100, kind: "BANK", provider: "BCA", accountName: "Rasyid", accountNo: "1234567890", isActive: true });
    const simpan = baris()[0];
    assert.equal(simpan.accountNo.includes("1234567890"), false);
    assert.equal(kripto.dekripsi(simpan.accountNo, "PaymentMethod:7"), "1234567890");
    assert.deepEqual(Object.keys(log.find((l) => l[0] === "create")[1]).sort(), ["accountName", "accountNo", "kind", "provider", "userId"]);
    assert.equal(audit().length, 1);
    const a = audit()[0];
    assert.equal(a.groupId, null);
    assert.equal(a.actorId, 7);
    assert.equal(a.entity, "PaymentMethod");
    assert.equal(a.entityId, 100);
    assert.equal(a.action, "PAYMENT_METHOD_CREATE");
    assert.equal(a.newValue, JSON.stringify({ kind: "BANK", provider: "BCA" }));
    assert.equal(JSON.stringify(a).includes("1234567890"), false);
    assert.equal(JSON.stringify(a).includes(simpan.accountNo), false);
  });

  it("urutan: kunci baris aktif dulu, baru tulis", async () => {
    const { layanan, log } = buat([]);
    await layanan.tambah(7, isi);
    assert.deepEqual(log[0], ["updateMany", { userId: 7, isActive: true }, { isActive: true }]);
    assert.deepEqual(log.map((l) => l[0]), ["updateMany", "create", "audit"]);
  });

  it("CASH hanya menulis userId dan kind; nomor dan penyedia null", async () => {
    const { layanan, log, audit } = buat([]);
    const hasil = await layanan.tambah(7, { kind: "CASH" });
    assert.deepEqual(hasil, { id: 100, kind: "CASH", provider: null, accountName: null, accountNo: null, isActive: true });
    assert.deepEqual(log.find((l) => l[0] === "create")[1], { userId: 7, kind: "CASH" });
    assert.equal(audit()[0].newValue, JSON.stringify({ kind: "CASH", provider: null }));
  });

  it("metode tunai aktif kedua ditolak 409; tunai nonaktif tidak menghalangi", async () => {
    const a = buat([tunai(1, 7)]);
    await galat(a.layanan.tambah(7, { kind: "CASH" }), 409, "invalid-state");
    assert.equal(a.baris().length, 1);
    assert.equal(a.audit().length, 0);
    const b = buat([tunai(1, 7, { isActive: false })]);
    await b.layanan.tambah(7, { kind: "CASH" });
    assert.equal(b.baris().length, 2);
    const c = buat([tunai(1, 8)]);
    await c.layanan.tambah(7, { kind: "CASH" });
    assert.equal(c.baris().length, 2);
  });

  it("batas 10 metode aktif: 9 masih boleh, 10 ditolak, nonaktif dan milik orang lain tidak dihitung", async () => {
    const aktif = (n, u) => Array.from({ length: n }, (_, i) => bank(u * 100 + i + 1, u, "12345" + i));
    const sembilan = buat([...aktif(9, 7), ...aktif(20, 8)]);
    await sembilan.layanan.tambah(7, isi);
    const sepuluh = buat(aktif(10, 7));
    await galat(sepuluh.layanan.tambah(7, isi), 409, "invalid-state");
    assert.equal(sepuluh.baris().length, 10);
    const nonaktif = buat([...aktif(9, 7), ...Array.from({ length: 5 }, (_, i) => bank(500 + i, 7, "99999", { isActive: false }))]);
    await nonaktif.layanan.tambah(7, isi);
  });

  it("tanpa kunci enkripsi: galat konfigurasi sebelum menyentuh database", async () => {
    const { layanan, log } = buat([], { enkripsi: buatEnkripsi({}) });
    await assert.rejects(layanan.tambah(7, isi), /PAYMENT_ENC_KEY belum diisi/);
    assert.deepEqual(log, []);
  });

  it("audit yang gagal membatalkan metode yang baru dibuat (satu transaksi)", async () => {
    const d = buatDb([]);
    d.db.auditLog.create = async () => { throw new Error("audit gagal"); };
    const layanan = buatLayananMetodeBayar({ db: d.db, enkripsi: kripto, ledger: ledgerPalsu() });
    await assert.rejects(layanan.tambah(7, isi), /audit gagal/);
    assert.equal(d.baris().length, 0);
  });
});

describe("metodeBayar.ubah", () => {
  it("metode tidak ada atau milik orang lain: 404, data orang lain tidak berubah", async () => {
    const { layanan, baris } = buat([bank(1, 2, "111111")]);
    await galat(layanan.ubah(7, 1, { provider: "BNI" }), 404, "not-found");
    await galat(layanan.ubah(7, 99, { provider: "BNI" }), 404, "not-found");
    assert.equal(baris()[0].provider, "BCA");
  });

  it("metode tunai dan metode nonaktif tidak dapat diubah (409) dan tidak ada audit", async () => {
    const a = buat([tunai(1, 7)]);
    await galat(a.layanan.ubah(7, 1, { provider: "BNI" }), 409, "invalid-state");
    const b = buat([bank(2, 7, "111111", { isActive: false })]);
    await galat(b.layanan.ubah(7, 2, { provider: "BNI" }), 409, "invalid-state");
    assert.equal(a.audit().length + b.audit().length, 0);
    assert.equal(b.baris()[0].provider, "BCA");
  });

  it("hanya field yang dikirim yang berubah; nomor baru dienkripsi terikat; audit memuat nama field saja", async () => {
    const { layanan, baris, audit, log } = buat([bank(4, 7, "111111")]);
    const hasil = await layanan.ubah(7, 4, { accountNo: "222222", provider: "BNI" });
    assert.deepEqual(hasil, { id: 4, kind: "BANK", provider: "BNI", accountName: "Nama 4", accountNo: "222222", isActive: true });
    assert.equal(baris()[0].accountName, "Nama 4");
    assert.equal(baris()[0].accountNo.includes("222222"), false);
    assert.equal(kripto.dekripsi(baris()[0].accountNo, "PaymentMethod:7"), "222222");
    const klaim = log.find((l) => l[0] === "updateMany");
    assert.deepEqual(klaim[1], { id: 4, userId: 7, isActive: true });
    assert.deepEqual(Object.keys(klaim[2]).sort(), ["accountNo", "provider"]);
    assert.equal(audit().length, 1);
    assert.equal(audit()[0].action, "PAYMENT_METHOD_UPDATE");
    assert.equal(audit()[0].entityId, 4);
    assert.equal(audit()[0].groupId, null);
    assert.equal(audit()[0].actorId, 7);
    assert.equal(audit()[0].newValue, JSON.stringify({ fields: ["accountNo", "provider"] }));
    assert.equal(JSON.stringify(audit()[0]).includes("222222"), false);
    assert.equal(JSON.stringify(audit()[0]).includes("111111"), false);
  });

  it("mengubah nama saja tidak menyentuh nomor terenkripsi", async () => {
    const { layanan, baris, audit } = buat([bank(1, 7, "111111")]);
    const sebelum = baris()[0].accountNo;
    const hasil = await layanan.ubah(7, 1, { accountName: "Baru" });
    assert.equal(baris()[0].accountNo, sebelum);
    assert.equal(baris()[0].accountName, "Baru");
    assert.equal(baris()[0].provider, "BCA");
    assert.deepEqual(hasil, { id: 1, kind: "BANK", provider: "BCA", accountName: "Baru", accountNo: "111111", isActive: true });
    assert.equal(audit()[0].newValue, JSON.stringify({ fields: ["accountName"] }));
  });

  it("metode yang dinonaktifkan di tengah jalan (klaim 0 baris): 409 dan tanpa audit", async () => {
    const d = buat([bank(1, 7, "111111")]);
    const asli = d.db.paymentMethod.updateMany;
    d.db.paymentMethod.updateMany = async (a) => (Object.hasOwn(a.where, "id") ? { count: 0 } : asli(a));
    await galat(d.layanan.ubah(7, 1, { provider: "BNI" }), 409, "invalid-state");
    assert.equal(d.audit().length, 0);
  });

  it("tanpa kunci enkripsi: galat konfigurasi", async () => {
    const { layanan, log } = buat([bank(1, 7)], { enkripsi: buatEnkripsi({}) });
    await assert.rejects(layanan.ubah(7, 1, { provider: "BNI" }), /PAYMENT_ENC_KEY belum diisi/);
    assert.deepEqual(log, []);
  });
});

describe("metodeBayar.nonaktifkan", () => {
  it("metode tidak ada atau milik orang lain: 404 dan tidak berubah", async () => {
    const { layanan, baris } = buat([bank(1, 2, "111111"), bank(2, 2, "222222")]);
    await galat(layanan.nonaktifkan(7, 1), 404, "not-found");
    assert.equal(baris().every((m) => m.isActive), true);
  });

  it("menonaktifkan satu dari dua metode aktif: urutan cari, kunci, klaim, audit tanpa nilai", async () => {
    const { layanan, baris, audit, log } = buat([bank(1, 7, "111111"), tunai(2, 7)]);
    assert.equal(await layanan.nonaktifkan(7, 1), undefined);
    assert.deepEqual(baris().map((m) => m.isActive), [false, true]);
    assert.deepEqual(log.map((l) => l[0]), ["findFirst", "updateMany", "updateMany", "audit"]);
    assert.deepEqual(log[1], ["updateMany", { userId: 7, isActive: true }, { isActive: true }]);
    assert.deepEqual(log[2], ["updateMany", { id: 1, userId: 7, isActive: true }, { isActive: false }]);
    assert.equal(audit().length, 1);
    assert.equal(audit()[0].action, "PAYMENT_METHOD_DEACTIVATE");
    assert.equal(audit()[0].entityId, 1);
    assert.equal(audit()[0].groupId, null);
    assert.equal(audit()[0].actorId, 7);
    assert.equal(audit()[0].newValue, null);
    assert.equal(audit()[0].oldValue, null);
  });

  it("metode aktif terakhir ditolak 409 last-payment-method; nonaktif lain tidak dihitung", async () => {
    const { layanan, baris, audit } = buat([bank(1, 7, "111111"), bank(2, 7, "222222", { isActive: false }), tunai(3, 7, { isActive: false })]);
    await galat(layanan.nonaktifkan(7, 1), 409, "last-payment-method");
    assert.equal(baris()[0].isActive, true);
    assert.equal(audit().length, 0);
  });

  it("metode aktif orang lain tidak dihitung sebagai milik pengguna", async () => {
    const { layanan } = buat([bank(1, 7, "111111"), bank(2, 8, "222222"), bank(3, 8, "333333")]);
    await galat(layanan.nonaktifkan(7, 1), 409, "last-payment-method");
  });

  it("menonaktifkan metode yang sudah nonaktif: tidak berbuat apa-apa, tanpa audit, tanpa penguncian", async () => {
    const { layanan, audit, log } = buat([bank(1, 7, "111111", { isActive: false }), bank(2, 7, "222222")]);
    assert.equal(await layanan.nonaktifkan(7, 1), undefined);
    assert.equal(audit().length, 0);
    assert.deepEqual(log.map((l) => l[0]), ["findFirst"]);
  });

  it("klaim 0 baris di tengah jalan (sudah dinonaktifkan pihak lain): selesai tanpa audit ganda", async () => {
    const d = buat([bank(1, 7, "111111"), bank(2, 7, "222222")]);
    const asli = d.db.paymentMethod.updateMany;
    d.db.paymentMethod.updateMany = async (a) => (Object.hasOwn(a.where, "id") ? { count: 0 } : asli(a));
    assert.equal(await d.layanan.nonaktifkan(7, 1), undefined);
    assert.equal(d.audit().length, 0);
  });

  it("audit yang gagal membatalkan penonaktifan", async () => {
    const d = buatDb([bank(1, 7, "111111"), bank(2, 7, "222222")]);
    d.db.auditLog.create = async () => { throw new Error("audit gagal"); };
    const layanan = buatLayananMetodeBayar({ db: d.db, enkripsi: kripto, ledger: ledgerPalsu() });
    await assert.rejects(layanan.nonaktifkan(7, 1), /audit gagal/);
    assert.equal(d.baris()[0].isActive, true);
  });
});

describe("metodeBayar.metodeAnggota", () => {
  const ctx = { userId: 7, groupId: 3 };

  it("pemilik melihat metodenya sendiri tanpa menyentuh ledger; hanya yang aktif", async () => {
    const { layanan, ledger, log } = buat([bank(1, 7, "111111"), bank(2, 7, "222222", { isActive: false }), tunai(3, 7)]);
    const hasil = await layanan.metodeAnggota(ctx, 7);
    assert.deepEqual(log, [["findMany", { userId: 7, isActive: true }, [{ id: "asc" }]]]);
    assert.deepEqual(hasil.map((m) => m.id), [1, 3]);
    assert.equal(hasil[0].accountNo, "111111");
    assert.equal(hasil[1].accountNo, null);
    assert.deepEqual(ledger.panggilan, []);
  });

  it("pihak yang berutang kepada pemilik boleh melihat nomor; urutan argumen ledger (grup, pemanggil, pemilik)", async () => {
    const ledger = ledgerPalsu({ "7:9": 15000 });
    const { layanan } = buat([bank(1, 9, "999999"), bank(2, 9, "888888", { isActive: false }), bank(3, 7, "777777")], { ledger });
    const hasil = await layanan.metodeAnggota(ctx, 9);
    assert.deepEqual(hasil, [{ id: 1, kind: "BANK", provider: "BCA", accountName: "Nama 1", accountNo: "999999", isActive: true }]);
    assert.deepEqual(ledger.panggilan, [[3, 7, 9]]);
  });

  it("tanpa utang (nol) atau pemilik yang berutang kepada pemanggil (negatif): 403 dan database metode tidak dibaca", async () => {
    for (const saldo of [0, -5000]) {
      const ledger = ledgerPalsu({ "7:9": saldo });
      const { layanan, log } = buat([bank(1, 9, "999999")], { ledger });
      await galat(layanan.metodeAnggota(ctx, 9), 403, "forbidden");
      assert.deepEqual(log, []);
    }
  });

  it("tanpa kunci enkripsi: galat konfigurasi sebelum ledger", async () => {
    const ledger = ledgerPalsu({ "7:9": 1 });
    const { layanan } = buat([bank(1, 9)], { ledger, enkripsi: buatEnkripsi({}) });
    await assert.rejects(layanan.metodeAnggota(ctx, 9), /PAYMENT_ENC_KEY belum diisi/);
    assert.deepEqual(ledger.panggilan, []);
  });
});
