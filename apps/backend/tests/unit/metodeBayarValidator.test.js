import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anggotaParams, metodeParams, tambahMetodeSchema, ubahMetodeSchema } from "../../src/validators/metodeBayar.validator.js";

const bank = { kind: "BANK", provider: "BCA", accountNo: "1234567890", accountName: "Rasyid R." };
const medan = (hasil) => hasil.error.issues.map((i) => i.path.join(".")).sort();

describe("tambahMetodeSchema", () => {
  it("menerima BANK dan EWALLET lengkap dan memangkas spasi", () => {
    assert.deepEqual(tambahMetodeSchema.parse(bank), bank);
    const dana = { kind: "EWALLET", provider: " Dana ", accountNo: " 081200000000 ", accountName: " Aqi " };
    assert.deepEqual(tambahMetodeSchema.parse(dana), { kind: "EWALLET", provider: "Dana", accountNo: "081200000000", accountName: "Aqi" });
  });

  it("CASH hanya kind; kunci lain ditolak", () => {
    assert.deepEqual(tambahMetodeSchema.parse({ kind: "CASH" }), { kind: "CASH" });
    for (const ekstra of [{ provider: "x" }, { accountNo: "12345" }, { accountName: "x" }, { foo: 1 }]) {
      assert.equal(tambahMetodeSchema.safeParse({ kind: "CASH", ...ekstra }).success, false, JSON.stringify(ekstra));
    }
  });

  it("BANK dan EWALLET menolak kunci asing (id, userId, isActive)", () => {
    for (const ekstra of [{ id: 5 }, { userId: 2 }, { isActive: false }, { foo: 1 }]) {
      for (const kind of ["BANK", "EWALLET"]) {
        assert.equal(tambahMetodeSchema.safeParse({ ...bank, kind, ...ekstra }).success, false, kind + " " + JSON.stringify(ekstra));
      }
    }
  });

  it("kind tidak dikenal, kosong, atau bukan teks ditolak dengan galat di field kind", () => {
    for (const v of [{}, { kind: "CRYPTO" }, { kind: "cash" }, { kind: 1 }, { kind: null }]) {
      const h = tambahMetodeSchema.safeParse(v);
      assert.equal(h.success, false, JSON.stringify(v));
      assert.deepEqual(medan(h), ["kind"]);
    }
  });

  it("BANK dan EWALLET wajib provider, accountNo, accountName", () => {
    for (const kind of ["BANK", "EWALLET"]) {
      const h = tambahMetodeSchema.safeParse({ kind });
      assert.deepEqual(medan(h), ["accountName", "accountNo", "provider"]);
    }
  });

  it("batas panjang provider (50) dan nama (100) berlaku inklusif", () => {
    assert.equal(tambahMetodeSchema.safeParse({ ...bank, provider: "p".repeat(50) }).success, true);
    assert.equal(tambahMetodeSchema.safeParse({ ...bank, provider: "p".repeat(51) }).success, false);
    assert.equal(tambahMetodeSchema.safeParse({ ...bank, accountName: "n".repeat(100) }).success, true);
    assert.equal(tambahMetodeSchema.safeParse({ ...bank, accountName: "n".repeat(101) }).success, false);
    assert.equal(tambahMetodeSchema.safeParse({ ...bank, provider: "   " }).success, false);
    assert.equal(tambahMetodeSchema.safeParse({ ...bank, accountName: "   " }).success, false);
  });

  it("nomor: hanya angka, 5 sampai 30, batas inklusif", () => {
    const ok = (n) => tambahMetodeSchema.safeParse({ ...bank, accountNo: n }).success;
    assert.equal(ok("1234"), false);
    assert.equal(ok("12345"), true);
    assert.equal(ok("1".repeat(30)), true);
    assert.equal(ok("1".repeat(31)), false);
    for (const s of ["12 345", "12-345", "12345a", "+6281234", "١٢٣٤٥"]) assert.equal(ok(s), false, s);
    assert.equal(ok(12345), false);
    assert.equal(ok(" 12345\n"), true);
  });
});

describe("ubahMetodeSchema", () => {
  it("menerima satu atau lebih field dan memangkas spasi", () => {
    assert.deepEqual(ubahMetodeSchema.parse({ accountNo: "12345" }), { accountNo: "12345" });
    assert.deepEqual(ubahMetodeSchema.parse({ provider: " BNI ", accountName: " A " }), { provider: "BNI", accountName: "A" });
  });

  it("badan kosong ditolak; kind dan kunci asing ditolak", () => {
    assert.equal(ubahMetodeSchema.safeParse({}).success, false);
    assert.equal(ubahMetodeSchema.safeParse({ kind: "BANK" }).success, false);
    assert.equal(ubahMetodeSchema.safeParse({ provider: "BNI", isActive: true }).success, false);
  });

  it("aturan field yang sama dengan penambahan", () => {
    assert.equal(ubahMetodeSchema.safeParse({ accountNo: "12" }).success, false);
    assert.equal(ubahMetodeSchema.safeParse({ provider: "" }).success, false);
    assert.equal(ubahMetodeSchema.safeParse({ accountName: "n".repeat(101) }).success, false);
    assert.equal(ubahMetodeSchema.safeParse({ provider: undefined }).success, false);
  });
});

describe("param", () => {
  it("methodId, groupId, dan userId adalah id bilangan bulat positif", () => {
    assert.deepEqual(metodeParams.parse({ methodId: "12" }), { methodId: 12 });
    assert.deepEqual(anggotaParams.parse({ groupId: "3", userId: "9" }), { groupId: 3, userId: 9 });
    for (const v of ["0", "abc", "1.5", "-1", "01"]) assert.equal(metodeParams.safeParse({ methodId: v }).success, false, v);
    assert.equal(anggotaParams.safeParse({ groupId: "3", userId: "fund" }).success, false);
  });
});
