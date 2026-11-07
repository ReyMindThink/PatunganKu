import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daftarApprovalQuery, kursorApprovalSkema, suaraSchema } from "../../src/validators/approval.validator.js";

describe("validator approval", () => {
  it("suara: APPROVE dan REJECT sah; lainnya, kosong, dan field tambahan ditolak", () => {
    assert.equal(suaraSchema.safeParse({ vote: "APPROVE" }).success, true);
    assert.equal(suaraSchema.safeParse({ vote: "REJECT" }).success, true);
    for (const b of [{}, { vote: "approve" }, { vote: "ABSTAIN" }, { vote: 1 }, { vote: "APPROVE", x: 1 }, null, "APPROVE"]) assert.equal(suaraSchema.safeParse(b).success, false, JSON.stringify(b));
  });
  it("daftar: bawaan limit 20; status sah; mine menjadi boolean", () => {
    assert.deepEqual(daftarApprovalQuery.parse({}), { limit: 20 });
    assert.equal(daftarApprovalQuery.parse({ mine: "true" }).mine, true);
    assert.equal(daftarApprovalQuery.parse({ mine: "false" }).mine, false);
    for (const status of ["OPEN", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED"]) assert.equal(daftarApprovalQuery.parse({ status }).status, status);
  });
  it("daftar: status liar, mine bukan true atau false, limit di atas 100 ditolak", () => {
    for (const q of [{ status: "open" }, { status: "DONE" }, { mine: "yes" }, { mine: "1" }, { limit: "101" }, { limit: "0" }]) assert.equal(daftarApprovalQuery.safeParse(q).success, false, JSON.stringify(q));
  });
  it("kursor: createdAt ISO dan id bilangan bulat positif", () => {
    assert.equal(kursorApprovalSkema.safeParse({ t: "2026-11-05T10:00:00.000Z", id: 3 }).success, true);
    for (const k of [{ t: "bukan tanggal", id: 3 }, { t: "2026-11-05T10:00:00.000Z", id: 0 }, { t: "2026-11-05T10:00:00.000Z", id: 1.5 }, { id: 3 }]) assert.equal(kursorApprovalSkema.safeParse(k).success, false);
  });
});
