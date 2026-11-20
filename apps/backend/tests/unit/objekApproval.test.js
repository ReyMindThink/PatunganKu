import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { objekApproval } from "../../src/utils/objekApproval.js";

const SEKARANG = 1_000_000;
const dasar = (ubah = {}) => ({
  id: 31, groupId: 7, subjectType: "TRANSACTION", subjectId: 5, rule: "ADMIN_ANY", requestedBy: 2, eligibleCount: 2, required: 1,
  status: "OPEN", expiresAt: new Date(SEKARANG + 1), decidedAt: null, createdAt: new Date(0),
  requester: { id: 2, name: "Pengaju", email: "rahasia@tes.local" }, votes: [], ...ubah,
});
const subjek = { id: 5, description: "Makan", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "FAILED", payerId: 2, rahasia: "x" };
const admin = { userId: 1, role: "OWNER" };
const buat = (a, pemanggil = admin, s = subjek) => objekApproval(a, s, pemanggil, SEKARANG);

describe("objekApproval", () => {
  it("bentuk lengkap tanpa field lain (email pengaju dan kolom subjek tambahan tidak bocor)", () => {
    const o = buat(dasar());
    assert.deepEqual(Object.keys(o).sort(), [
      "approveCount", "canVote", "createdAt", "decidedAt", "eligibleCount", "expiresAt", "groupId", "id", "myVote", "rejectCount",
      "requestedBy", "required", "rule", "status", "subject", "subjectId", "subjectType",
    ]);
    assert.deepEqual(o.requestedBy, { id: 2, name: "Pengaju" });
    assert.deepEqual(o.subject, { transactionId: 5, description: "Makan", amount: 70000, mode: "EQUAL_ALL", receiptStatus: "FAILED" });
    assert.equal(o.decidedAt, null);
  });
  it("subjek tidak ada: subject null", () => {
    assert.equal(buat(dasar(), admin, null).subject, null);
    assert.equal(objekApproval(dasar(), undefined, admin, SEKARANG).subject, null);
  });
  it("decidedAt diteruskan setelah keputusan", () => {
    const waktu = new Date(SEKARANG - 10);
    assert.deepEqual(buat(dasar({ status: "APPROVED", decidedAt: waktu })).decidedAt, waktu);
  });
  it("hitungan suara dan myVote", () => {
    const votes = [{ userId: 1, vote: "APPROVE" }, { userId: 3, vote: "REJECT" }, { userId: 4, vote: "REJECT" }];
    const o = buat(dasar({ rule: "QUORUM_20", votes }), { userId: 3, role: "MEMBER" });
    assert.equal(o.approveCount, 1);
    assert.equal(o.rejectCount, 2);
    assert.equal(o.myVote, "REJECT");
    assert.equal(buat(dasar({ votes }), { userId: 9, role: "OWNER" }).myVote, null);
  });
  it("canVote: admin sah pada Approval terbuka", () => {
    assert.equal(buat(dasar()).canVote, true);
  });
  it("canVote false: pengaju sendiri, bukan admin pada ADMIN_*, sudah memilih", () => {
    assert.equal(buat(dasar(), { userId: 2, role: "OWNER" }).canVote, false);
    assert.equal(buat(dasar(), { userId: 1, role: "MEMBER" }).canVote, false);
    assert.equal(buat(dasar({ votes: [{ userId: 1, vote: "APPROVE" }] })).canVote, false);
  });
  it("canVote: QUORUM_20 terbuka untuk MEMBER", () => {
    assert.equal(buat(dasar({ rule: "QUORUM_20" }), { userId: 1, role: "MEMBER" }).canVote, true);
  });
  it("canVote false bila bukan OPEN atau tepat pada batas kedaluwarsa", () => {
    for (const status of ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"]) assert.equal(buat(dasar({ status })).canVote, false, status);
    assert.equal(buat(dasar({ expiresAt: new Date(SEKARANG) })).canVote, false);
    assert.equal(buat(dasar({ expiresAt: new Date(SEKARANG - 1) })).canVote, false);
    assert.equal(buat(dasar({ expiresAt: new Date(SEKARANG + 1) })).canVote, true);
  });
});
