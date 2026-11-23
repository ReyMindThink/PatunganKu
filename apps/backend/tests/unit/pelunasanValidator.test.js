import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daftarPelunasanQuery, kirimPelunasanSchema, kursorPelunasanSkema, pelunasanParams, tolakPelunasanSchema } from "../../src/validators/pelunasan.validator.js";

const sah = { receiverId: "5", amount: "10000", methodType: "CASH" };
const medan = (h) => h.error.issues.map((i) => i.path.join(".")).sort();

describe("kirimPelunasanSchema", () => {
  it("menerima teks (multipart) maupun angka (JSON) dan menghasilkan number", () => {
    assert.deepEqual(kirimPelunasanSchema.parse(sah), { receiverId: 5, amount: 10000, methodType: "CASH" });
    assert.deepEqual(kirimPelunasanSchema.parse({ receiverId: 5, amount: 10000, methodType: "CASH" }), { receiverId: 5, amount: 10000, methodType: "CASH" });
  });

  it("catatan dipangkas; kosong atau spasi saja dianggap tidak ada; maksimal 500 inklusif", () => {
    assert.equal(kirimPelunasanSchema.parse({ ...sah, note: " halo " }).note, "halo");
    assert.equal(kirimPelunasanSchema.parse({ ...sah, note: "" }).note, undefined);
    assert.equal(kirimPelunasanSchema.parse({ ...sah, note: "   " }).note, undefined);
    assert.equal(kirimPelunasanSchema.safeParse({ ...sah, note: "x".repeat(500) }).success, true);
    assert.equal(kirimPelunasanSchema.safeParse({ ...sah, note: "x".repeat(501) }).success, false);
  });

  it("receiverId dan amount: bilangan bulat positif, batas Int 2147483647 inklusif", () => {
    for (const nama of ["receiverId", "amount"]) {
      for (const buruk of ["0", "-5", "1.5", "abc", "", " ", "01", "2147483648", null, undefined, true, 1.5, 0, -1, NaN, "1e3"]) {
        const h = kirimPelunasanSchema.safeParse({ ...sah, [nama]: buruk });
        assert.equal(h.success, false, nama + "=" + String(buruk));
        assert.deepEqual(medan(h), [nama], nama + "=" + String(buruk));
      }
      assert.equal(kirimPelunasanSchema.parse({ ...sah, [nama]: "2147483647" })[nama], 2147483647);
      assert.equal(kirimPelunasanSchema.parse({ ...sah, [nama]: "1" })[nama], 1);
    }
  });

  it("receiverId dan amount wajib ada", () => {
    assert.deepEqual(medan(kirimPelunasanSchema.safeParse({ methodType: "CASH" })), ["amount", "receiverId"]);
  });

  it("BANK dan EWALLET wajib methodId (bilangan bulat positif); CASH tidak boleh membawanya", () => {
    for (const jenis of ["BANK", "EWALLET"]) {
      assert.deepEqual(kirimPelunasanSchema.parse({ ...sah, methodType: jenis, methodId: "3" }), { receiverId: 5, amount: 10000, methodType: jenis, methodId: 3 });
      assert.deepEqual(kirimPelunasanSchema.parse({ ...sah, methodType: jenis, methodId: 3, note: " x " }), { receiverId: 5, amount: 10000, methodType: jenis, methodId: 3, note: "x" });
      assert.deepEqual(medan(kirimPelunasanSchema.safeParse({ ...sah, methodType: jenis })), ["methodId"]);
      for (const buruk of ["0", "-1", "abc", "1.5", "", null, "2147483648"]) {
        const h = kirimPelunasanSchema.safeParse({ ...sah, methodType: jenis, methodId: buruk });
        assert.deepEqual(medan(h), ["methodId"], jenis + " " + String(buruk));
      }
    }
    assert.equal(kirimPelunasanSchema.safeParse({ ...sah, methodType: "CASH", methodId: "3" }).success, false);
  });

  it("methodType selain BANK, EWALLET, CASH, atau kosong: galat di field methodType", () => {
    for (const jenis of ["cash", "QRIS", "", null, undefined, 1]) {
      const h = kirimPelunasanSchema.safeParse({ ...sah, methodType: jenis, methodId: "3" });
      assert.deepEqual(medan(h), ["methodType"], String(jenis));
      assert.equal(h.error.issues[0].message, "methodType harus BANK, EWALLET, atau CASH");
    }
  });

  it("kunci asing ditolak (methodId, onBehalfOfFund, id, senderId, status)", () => {
    for (const ekstra of [{ methodId: "3" }, { onBehalfOfFund: "true" }, { id: 1 }, { senderId: 2 }, { status: "CONFIRMED" }, { proof: "x" }]) {
      assert.equal(kirimPelunasanSchema.safeParse({ ...sah, ...ekstra }).success, false, JSON.stringify(ekstra));
    }
    for (const ekstra of [{ onBehalfOfFund: "true" }, { id: 1 }, { senderId: 2 }, { status: "CONFIRMED" }, { proof: "x" }, { proofUrl: "x" }, { methodProvider: "x" }]) {
      assert.equal(kirimPelunasanSchema.safeParse({ ...sah, methodType: "BANK", methodId: "3", ...ekstra }).success, false, "BANK " + JSON.stringify(ekstra));
    }
  });
});

describe("tolakPelunasanSchema", () => {
  it("badan kosong sah; alasan dipangkas; spasi saja dianggap tidak ada; maksimal 500 inklusif", () => {
    assert.deepEqual(tolakPelunasanSchema.parse({}), {});
    assert.equal(tolakPelunasanSchema.parse({ reason: " tidak sesuai " }).reason, "tidak sesuai");
    assert.equal(tolakPelunasanSchema.parse({ reason: "   " }).reason, undefined);
    assert.equal(tolakPelunasanSchema.safeParse({ reason: "x".repeat(500) }).success, true);
    assert.equal(tolakPelunasanSchema.safeParse({ reason: "x".repeat(501) }).success, false);
  });

  it("kunci asing dan alasan bukan teks ditolak", () => {
    assert.equal(tolakPelunasanSchema.safeParse({ foo: 1 }).success, false);
    assert.equal(tolakPelunasanSchema.safeParse({ reason: 5 }).success, false);
    assert.equal(tolakPelunasanSchema.safeParse({ reason: null }).success, false);
  });
});

describe("daftarPelunasanQuery", () => {
  it("bawaan limit 20; role dan status opsional dengan nilai terbatas", () => {
    assert.deepEqual(daftarPelunasanQuery.parse({}), { limit: 20 });
    assert.deepEqual(daftarPelunasanQuery.parse({ role: "sent", status: "PENDING", limit: "5", cursor: "abc" }), { limit: 5, cursor: "abc", role: "sent", status: "PENDING" });
    for (const role of ["received", "sent"]) assert.equal(daftarPelunasanQuery.safeParse({ role }).success, true);
    for (const status of ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"]) assert.equal(daftarPelunasanQuery.safeParse({ status }).success, true);
  });

  it("role dan status tidak dikenal ditolak; limit di atas 100 ditolak", () => {
    assert.deepEqual(medan(daftarPelunasanQuery.safeParse({ role: "all" })), ["role"]);
    assert.deepEqual(medan(daftarPelunasanQuery.safeParse({ status: "DONE" })), ["status"]);
    assert.deepEqual(medan(daftarPelunasanQuery.safeParse({ status: "pending" })), ["status"]);
    assert.equal(daftarPelunasanQuery.safeParse({ limit: "100" }).success, true);
    assert.equal(daftarPelunasanQuery.safeParse({ limit: "101" }).success, false);
  });
});

describe("kursorPelunasanSkema dan param", () => {
  it("kursor berisi waktu sah dan id positif", () => {
    assert.equal(kursorPelunasanSkema.safeParse({ t: "2026-11-22T10:00:00.000Z", id: 5 }).success, true);
    for (const buruk of [{ t: "bukan-waktu", id: 5 }, { t: "2026-11-22T10:00:00.000Z", id: 0 }, { t: "2026-11-22T10:00:00.000Z", id: 1.5 }, { t: "2026-11-22T10:00:00.000Z" }, { id: 5 }, { t: 5, id: 5 }]) {
      assert.equal(kursorPelunasanSkema.safeParse(buruk).success, false, JSON.stringify(buruk));
    }
  });

  it("groupId dan paymentId adalah id bilangan bulat positif", () => {
    assert.deepEqual(pelunasanParams.parse({ groupId: "3", paymentId: "801" }), { groupId: 3, paymentId: 801 });
    for (const v of ["0", "abc", "1.5", "-1", "01"]) assert.equal(pelunasanParams.safeParse({ groupId: "3", paymentId: v }).success, false, v);
    assert.equal(pelunasanParams.safeParse({ groupId: "3" }).success, false);
  });
});
