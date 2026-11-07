// Memastikan objek pengaman skema v2 benar-benar ada di SQL Server.
// Objek diperiksa berdasarkan nama (bukan jumlah persis) supaya penambahan tabel
// di tahap berikutnya tidak membuat tes ini merah tanpa sebab.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../helpers/db.js";

after(async () => {
  await prisma.$disconnect();
});

const TABEL = [
  "User", "Group", "GroupMember", "Transaction", "TransactionShare",
  "PaymentConfirmation", "LedgerEntry", "AuditLog", "ReceiptExtraction", "ReceiptItem",
  "Approval", "ApprovalVote", "Notification", "PaymentMethod", "IdempotencyKey",
];

const CHECK = [
  "CK_GroupMember_role", "CK_GroupMember_status", "CK_Transaction_mode", "CK_Transaction_status",
  "CK_Transaction_receiptStatus", "CK_Transaction_amount", "CK_Transaction_version",
  "CK_TransactionShare_consent", "CK_TransactionShare_amount", "CK_PaymentConfirmation_methodType",
  "CK_PaymentConfirmation_status", "CK_PaymentConfirmation_amount", "CK_PaymentConfirmation_parties",
  "CK_PaymentConfirmation_proof", "CK_LedgerEntry_type", "CK_LedgerEntry_sign",
  "CK_LedgerEntry_amount", "CK_LedgerEntry_category", "CK_LedgerEntry_parties",
  "CK_LedgerEntry_shape", "CK_ReceiptExtraction_source", "CK_ReceiptExtraction_taxMode",
  "CK_ReceiptExtraction_confidence", "CK_ReceiptExtraction_version", "CK_ReceiptItem_values",
  "CK_Approval_subjectType", "CK_Approval_rule", "CK_Approval_status", "CK_Approval_counts",
  "CK_ApprovalVote_vote", "CK_Notification_payload", "CK_AuditLog_oldValue",
  "CK_AuditLog_newValue", "CK_PaymentMethod_kind", "CK_PaymentMethod_details",
  "CK_IdempotencyKey_state", "CK_IdempotencyKey_completed",
];

const TRIGGER = [
  "TR_LedgerEntry_AppendOnly", "TR_AuditLog_AppendOnly", "TR_ReceiptExtraction_AppendOnly",
];

const INDEKS = ["UX_GroupMember_OneActiveOwner", "UX_LedgerEntry_Reverses"];

describe("skema v2 di SQL Server", () => {
  it("memuat 15 tabel model dan tabel riwayat migration", async () => {
    const baris = await prisma.$queryRaw`SELECT name FROM sys.tables`;
    const ada = new Set(baris.map((b) => b.name));
    for (const tabel of [...TABEL, "_prisma_migrations"]) {
      assert.ok(ada.has(tabel), "tabel tidak ditemukan: " + tabel);
    }
  });

  it("mencatat migration baseline sebagai selesai", async () => {
    const baris = await prisma.$queryRaw`
      SELECT migration_name AS nama, finished_at AS selesai, rolled_back_at AS batal
      FROM _prisma_migrations`;
    const m = baris.find((b) => b.nama === "20261013221100_v2_tahap1");
    assert.ok(m, "migration baseline tidak tercatat");
    assert.ok(m.selesai, "migration baseline belum selesai");
    assert.equal(m.batal, null);
  });

  it("memuat 37 CHECK bernama dan semuanya aktif", async () => {
    const baris = await prisma.$queryRaw`SELECT name, is_disabled AS mati FROM sys.check_constraints`;
    const peta = new Map(baris.map((b) => [b.name, Boolean(b.mati)]));
    for (const nama of CHECK) {
      assert.ok(peta.has(nama), "CHECK tidak ditemukan: " + nama);
      assert.equal(peta.get(nama), false, "CHECK nonaktif: " + nama);
    }
  });

  it("memuat tiga trigger tambah-saja dan semuanya aktif", async () => {
    const baris = await prisma.$queryRaw`
      SELECT name, is_disabled AS mati FROM sys.triggers WHERE parent_class = 1`;
    const peta = new Map(baris.map((b) => [b.name, Boolean(b.mati)]));
    for (const nama of TRIGGER) {
      assert.ok(peta.has(nama), "trigger tidak ditemukan: " + nama);
      assert.equal(peta.get(nama), false, "trigger nonaktif: " + nama);
    }
  });

  it("memuat dua indeks unik terfilter yang aktif", async () => {
    const baris = await prisma.$queryRaw`
      SELECT name, is_unique AS uniknya, is_disabled AS mati
      FROM sys.indexes WHERE has_filter = 1`;
    const peta = new Map(baris.map((b) => [b.name, b]));
    for (const nama of INDEKS) {
      const i = peta.get(nama);
      assert.ok(i, "indeks terfilter tidak ditemukan: " + nama);
      assert.equal(Boolean(i.uniknya), true, "indeks tidak unik: " + nama);
      assert.equal(Boolean(i.mati), false, "indeks nonaktif: " + nama);
    }
  });

  it("tidak memiliki kunci asing berantai (semua NoAction)", async () => {
    const baris = await prisma.$queryRaw`
      SELECT COUNT(*) AS n FROM sys.foreign_keys
      WHERE delete_referential_action <> 0 OR update_referential_action <> 0`;
    assert.equal(Number(baris[0].n), 0);
  });
});
