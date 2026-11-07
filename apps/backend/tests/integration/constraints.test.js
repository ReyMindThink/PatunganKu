// Bukti bahwa pengaman database bekerja bila ditulis lewat driver Node dan Prisma Client,
// jalur yang sama dengan aplikasi. Setiap penolakan harus memuat pesan trigger atau nama
// constraint yang benar. Data uji unik per tes, dan tidak ada DELETE ke tabel tambah-saja.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { harusDitolak, prisma } from "../helpers/db.js";
import {
  buatAnggota,
  buatGrup,
  buatLedger,
  buatSkenario,
  buatTransaksi,
  buatUser,
} from "../helpers/factories.js";

after(async () => {
  await prisma.$disconnect();
});

const dataCharge = (s, ubah = {}) => ({
  type: "CHARGE",
  sign: 1,
  amount: 23333n,
  debtorUserId: s.anggota.id,
  creditorUserId: s.pemilik.id,
  category: "GROUP",
  transactionId: s.transaksi.id,
  createdBy: s.pemilik.id,
  ...ubah,
});

const dataReversal = (s, charge) => ({
  ...dataCharge(s, { type: "REVERSAL", sign: -1 }),
  reversesEntryId: charge.id,
});

describe("sesi koneksi driver Node", () => {
  it("memenuhi opsi SET yang disyaratkan indeks terfilter", async () => {
    const baris = await prisma.$queryRaw`SELECT
      CAST(SESSIONPROPERTY('ANSI_NULLS') AS INT) AS ansi_nulls,
      CAST(SESSIONPROPERTY('ANSI_PADDING') AS INT) AS ansi_padding,
      CAST(SESSIONPROPERTY('ANSI_WARNINGS') AS INT) AS ansi_warnings,
      CAST(SESSIONPROPERTY('ARITHABORT') AS INT) AS arithabort,
      CAST(SESSIONPROPERTY('CONCAT_NULL_YIELDS_NULL') AS INT) AS concat_null,
      CAST(SESSIONPROPERTY('QUOTED_IDENTIFIER') AS INT) AS quoted_identifier,
      CAST(SESSIONPROPERTY('NUMERIC_ROUNDABORT') AS INT) AS numeric_roundabort`;
    const r = Object.fromEntries(Object.entries(baris[0]).map(([k, v]) => [k, Number(v)]));
    assert.deepEqual(r, {
      ansi_nulls: 1,
      ansi_padding: 1,
      ansi_warnings: 1,
      arithabort: 1,
      concat_null: 1,
      quoted_identifier: 1,
      numeric_roundabort: 0,
    });
  });
});

describe("GroupMember (indeks unik terfilter)", () => {
  it("menolak pemilik aktif kedua dan tetap satu pemilik aktif", async () => {
    const s = await buatSkenario();
    const orangKetiga = await buatUser();
    await harusDitolak(
      () => buatAnggota(s.grup.id, orangKetiga.id, { role: "OWNER" }),
      "UX_GroupMember_OneActiveOwner",
      "pemilik aktif kedua",
    );
    const n = await prisma.groupMember.count({
      where: { groupId: s.grup.id, role: "OWNER", status: "ACTIVE" },
    });
    assert.equal(n, 1);
  });

  it("menerima pemilik baru setelah pemilik lama berstatus LEFT", async () => {
    const lama = await buatUser();
    const baru = await buatUser();
    const grup = await buatGrup(lama.id);
    await buatAnggota(grup.id, lama.id, { role: "OWNER", status: "LEFT", leftAt: new Date() });
    await buatAnggota(grup.id, baru.id, { role: "OWNER" });
    const n = await prisma.groupMember.count({
      where: { groupId: grup.id, role: "OWNER", status: "ACTIVE" },
    });
    assert.equal(n, 1);
  });
});

describe("LedgerEntry (tambah-saja, CHECK, indeks terfilter)", () => {
  it("menerima CHARGE dan REVERSAL pertama, menolak REVERSAL kedua", async () => {
    const s = await buatSkenario();
    const charge = await buatLedger(s.grup.id, dataCharge(s));
    await buatLedger(s.grup.id, dataReversal(s, charge));
    await harusDitolak(
      () => buatLedger(s.grup.id, dataReversal(s, charge)),
      "UX_LedgerEntry_Reverses",
      "REVERSAL kedua",
    );
  });

  it("menolak UPDATE dan DELETE serta membiarkan data utuh", async () => {
    const s = await buatSkenario();
    const charge = await buatLedger(s.grup.id, dataCharge(s));
    await harusDitolak(
      () => prisma.ledgerEntry.update({ where: { id: charge.id }, data: { amount: 1n } }),
      "LedgerEntry bersifat tambah-saja",
      "UPDATE ledger",
    );
    await harusDitolak(
      () => prisma.ledgerEntry.delete({ where: { id: charge.id } }),
      "LedgerEntry bersifat tambah-saja",
      "DELETE ledger",
    );
    const sesudah = await prisma.ledgerEntry.findUnique({ where: { id: charge.id } });
    assert.equal(sesudah.amount, 23333n);
  });

  it("menolak baris yang melanggar CHECK", async () => {
    const s = await buatSkenario();
    await harusDitolak(
      () => buatLedger(s.grup.id, dataCharge(s, { sign: -1 })),
      "CK_LedgerEntry_shape",
      "CHARGE bertanda minus",
    );
    await harusDitolak(
      () => buatLedger(s.grup.id, dataCharge(s, { debtorUserId: s.pemilik.id })),
      "CK_LedgerEntry_parties",
      "pengutang sama dengan kreditur",
    );
    await harusDitolak(
      () => buatLedger(s.grup.id, dataCharge(s, { amount: 0n })),
      "CK_LedgerEntry_amount",
      "nominal nol",
    );
  });
});

describe("AuditLog (tambah-saja, JSON)", () => {
  it("menerima baris sah, menolak UPDATE, DELETE, dan newValue bukan JSON", async () => {
    const s = await buatSkenario();
    const data = {
      groupId: s.grup.id,
      actorId: s.pemilik.id,
      entity: "Tes",
      action: "TEST",
      newValue: '{"a":1}',
    };
    const log = await prisma.auditLog.create({ data });
    await harusDitolak(
      () => prisma.auditLog.update({ where: { id: log.id }, data: { reason: "ubah" } }),
      "AuditLog bersifat tambah-saja",
      "UPDATE audit",
    );
    await harusDitolak(
      () => prisma.auditLog.delete({ where: { id: log.id } }),
      "AuditLog bersifat tambah-saja",
      "DELETE audit",
    );
    await harusDitolak(
      () => prisma.auditLog.create({ data: { ...data, newValue: "bukan json" } }),
      "CK_AuditLog_newValue",
      "newValue bukan JSON",
    );
  });
});

describe("ReceiptExtraction (tambah-saja, hapus hanya saat DRAFT)", () => {
  it("menerima ekstraksi, menolak UPDATE, dan menolak DELETE saat transaksi ACTIVE", async () => {
    const s = await buatSkenario();
    const e = await prisma.receiptExtraction.create({
      data: { transactionId: s.transaksi.id, version: 1, source: "AI" },
    });
    await harusDitolak(
      () => prisma.receiptExtraction.update({ where: { id: e.id }, data: { merchant: "ubah" } }),
      "ReceiptExtraction bersifat tambah-saja",
      "UPDATE ekstraksi",
    );
    await harusDitolak(
      () => prisma.receiptExtraction.delete({ where: { id: e.id } }),
      "hanya dapat dihapus selama transaksi berstatus DRAFT",
      "DELETE ekstraksi (ACTIVE)",
    );
  });

  it("menghapus ekstraksi saat transaksi masih DRAFT", async () => {
    const u = await buatUser();
    const grup = await buatGrup(u.id);
    await buatAnggota(grup.id, u.id, { role: "OWNER" });
    const transaksi = await buatTransaksi(grup.id, u.id);
    const e = await prisma.receiptExtraction.create({
      data: { transactionId: transaksi.id, version: 1, source: "AI" },
    });
    await prisma.receiptExtraction.deleteMany({ where: { id: e.id } });
    const sisa = await prisma.receiptExtraction.findUnique({ where: { id: e.id } });
    assert.equal(sisa, null);
  });
});
