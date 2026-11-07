import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catatAudit } from "../../src/utils/audit.js";

const buatTx = () => {
  const dicatat = [];
  return {
    dicatat,
    auditLog: {
      create: async ({ data, select }) => {
        dicatat.push({ data, select });
        return { id: dicatat.length };
      },
    },
  };
};
const dasar = { groupId: 7, actorId: 3, entity: "ItemClaim", action: "CLAIM_SET" };
const ditolak = async (isi, pola, tx = buatTx()) => {
  await assert.rejects(() => catatAudit(tx, isi), pola);
  assert.equal(tx.dicatat.length, 0, "tidak boleh menulis bila ditolak");
};
const diterima = async (isi) => {
  const tx = buatTx();
  await catatAudit(tx, isi);
  return tx.dicatat[0].data;
};

describe("catatAudit", () => {
  it("menulis satu baris dengan bentuk benar dan default null; mengembalikan id", async () => {
    const tx = buatTx();
    const hasil = await catatAudit(tx, dasar);
    assert.deepEqual(hasil, { id: 1 });
    assert.equal(tx.dicatat.length, 1);
    assert.deepEqual(tx.dicatat[0].select, { id: true });
    assert.deepEqual(tx.dicatat[0].data, {
      groupId: 7, actorId: 3, transactionId: null, entity: "ItemClaim", entityId: null,
      action: "CLAIM_SET", oldValue: null, newValue: null, reason: null,
    });
  });

  it("semua kolom: nilai diserialisasi ke JSON dan alasan dipangkas spasinya", async () => {
    const d = await diterima({ ...dasar, transactionId: 11, entityId: 55, oldValue: { a: 1 }, newValue: [1, { b: 2 }], reason: "  alasan  " });
    assert.equal(d.transactionId, 11);
    assert.equal(d.entityId, 55);
    assert.equal(d.oldValue, '{"a":1}');
    assert.equal(d.newValue, '[1,{"b":2}]');
    assert.equal(d.reason, "alasan");
  });

  it("groupId dan actorId null eksplisit diterima (aksi sistem dan aksi tanpa grup)", async () => {
    const d = await diterima({ ...dasar, groupId: null, actorId: null });
    assert.equal(d.groupId, null);
    assert.equal(d.actorId, null);
  });

  it("groupId dan actorId wajib ditulis dan berupa bilangan bulat positif", async () => {
    for (const nama of ["groupId", "actorId"]) {
      for (const salah of [undefined, 0, -1, 1.5, "7", NaN, 2147483648]) {
        await ditolak({ ...dasar, [nama]: salah }, new RegExp(nama));
      }
    }
    const d = await diterima({ ...dasar, groupId: 2147483647, actorId: 1 });
    assert.equal(d.groupId, 2147483647);
  });

  it("transactionId dan entityId: undefined jadi null, nilai salah ditolak", async () => {
    for (const nama of ["transactionId", "entityId"]) {
      assert.equal((await diterima({ ...dasar, [nama]: undefined }))[nama], null);
      for (const salah of ["5", 0, 1.2, -3]) await ditolak({ ...dasar, [nama]: salah }, new RegExp(nama));
    }
  });

  it("entity harus huruf-angka berawalan huruf, maksimal 40 karakter", async () => {
    for (const salah of ["", "1Abc", "Item Claim", "Item_Claim", "a".repeat(41), 5, undefined, null]) {
      await ditolak({ ...dasar, entity: salah }, /entity/);
    }
    assert.equal((await diterima({ ...dasar, entity: "A".repeat(40) })).entity, "A".repeat(40));
  });

  it("action harus huruf besar, angka, garis bawah berawalan huruf, maksimal 40 karakter", async () => {
    for (const salah of ["claim_set", "CLAIM-SET", "", "_X", "1X", "A".repeat(41), undefined, 7]) {
      await ditolak({ ...dasar, action: salah }, /action/);
    }
    assert.equal((await diterima({ ...dasar, action: "A".repeat(40) })).action, "A".repeat(40));
  });

  it("oldValue dan newValue hanya objek atau array; skalar, Date, siklus, BigInt ditolak", async () => {
    const siklus = {};
    siklus.diri = siklus;
    for (const nama of ["oldValue", "newValue"]) {
      for (const salah of [5, "teks", true, new Date(), siklus, { x: 10n }]) {
        await ditolak({ ...dasar, [nama]: salah }, new RegExp(nama));
      }
      assert.equal((await diterima({ ...dasar, [nama]: null }))[nama], null);
      assert.equal((await diterima({ ...dasar, [nama]: [] }))[nama], "[]");
    }
  });

  it("batas panjang nilai JSON: tepat 10000 karakter diterima, 10001 ditolak", async () => {
    const ok = { a: "x".repeat(9992) };
    assert.equal(JSON.stringify(ok).length, 10000);
    assert.equal((await diterima({ ...dasar, newValue: ok })).newValue.length, 10000);
    await ditolak({ ...dasar, newValue: { a: "x".repeat(9993) } }, /newValue/);
    await ditolak({ ...dasar, oldValue: { a: "x".repeat(9993) } }, /oldValue/);
  });

  it("reason: harus teks; batas 500 sesudah dipangkas; spasi saja menjadi null", async () => {
    await ditolak({ ...dasar, reason: 5 }, /reason/);
    await ditolak({ ...dasar, reason: "a".repeat(501) }, /reason/);
    assert.equal((await diterima({ ...dasar, reason: " " + "a".repeat(500) + " " })).reason.length, 500);
    assert.equal((await diterima({ ...dasar, reason: "   " })).reason, null);
    assert.equal((await diterima({ ...dasar, reason: null })).reason, null);
  });

  it("reason wajib untuk REVISE, TAKEDOWN, OVERRIDE_LEAVE; aksi lain tidak wajib", async () => {
    for (const action of ["REVISE", "TAKEDOWN", "OVERRIDE_LEAVE"]) {
      for (const kosong of [undefined, null, "", "   "]) await ditolak({ ...dasar, action, reason: kosong }, /reason wajib/);
      assert.equal((await diterima({ ...dasar, action, reason: "koreksi nominal" })).reason, "koreksi nominal");
    }
    for (const action of ["CLAIM_SET", "ROLE_CHANGE", "FUND_MARK"]) {
      assert.equal((await diterima({ ...dasar, action })).reason, null);
    }
  });

  it("argumen pertama harus klien transaksi dengan auditLog.create", async () => {
    for (const tx of [undefined, null, {}, { auditLog: {} }, { auditLog: { create: 5 } }]) {
      await assert.rejects(() => catatAudit(tx, dasar), /klien transaksi/);
    }
  });

  it("tanpa objek isi: galat pemrogram; galat dari create diteruskan apa adanya", async () => {
    await assert.rejects(() => catatAudit(buatTx()), /groupId/);
    const tx = { auditLog: { create: async () => { throw new Error("db mati"); } } };
    await assert.rejects(() => catatAudit(tx, dasar), /db mati/);
  });
});
