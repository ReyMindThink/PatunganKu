import test from "node:test";
import assert from "node:assert/strict";
import { decideReceipt } from "../../src/utils/receiptDecision.js";

const ok = { isReceipt: true, total: 100000, confidence: 0.9 };

test("struk valid dan total cocok: VERIFIED", () => {
  assert.deepEqual(decideReceipt(ok, 100000), { status: "VERIFIED", reason: "ok" });
});

test("total berbeda: REJECTED total-mismatch", () => {
  assert.equal(decideReceipt(ok, 99999).reason, "total-mismatch");
});

test("bukan struk: REJECTED not-a-receipt", () => {
  assert.equal(decideReceipt({ ...ok, isReceipt: false }, 100000).reason, "not-a-receipt");
});

test("keyakinan rendah dan total tak terbaca ditolak", () => {
  assert.equal(decideReceipt({ ...ok, confidence: 0.3 }, 100000).reason, "low-confidence");
  assert.equal(decideReceipt({ ...ok, total: null }, 100000).reason, "total-unreadable");
});
