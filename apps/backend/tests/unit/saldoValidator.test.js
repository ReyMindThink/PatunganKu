import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rincianParams } from "../../src/validators/saldo.validator.js";

describe("validator saldo", () => {
  it("rincian: id bilangan bulat positif menjadi number; fund tetap string", () => {
    assert.deepEqual(rincianParams.parse({ groupId: "7", userId: "12" }), { groupId: 7, userId: 12 });
    assert.deepEqual(rincianParams.parse({ groupId: "7", userId: "fund" }), { groupId: 7, userId: "fund" });
  });
  it("rincian: id nol, desimal, berawalan nol, huruf lain, dan Fund huruf besar ditolak", () => {
    for (const userId of ["0", "1.5", "007", "abc", "Fund", "FUND", "-1", "", "2147483648"]) {
      assert.equal(rincianParams.safeParse({ groupId: "7", userId }).success, false, "userId " + userId);
    }
    for (const groupId of ["0", "fund", "abc", "1.5"]) assert.equal(rincianParams.safeParse({ groupId, userId: "2" }).success, false, "groupId " + groupId);
  });
});
