import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { putuskanStruk } from "../../src/utils/keputusanStruk.js";

const baik = { isReceipt: true, total: 70000, confidence: 0.9 };

describe("putuskanStruk (api-contract 5.4)", () => {
  it("struk sah dan total sama dengan nominal: VERIFIED ok, tanpa warnings", () => {
    assert.deepEqual(putuskanStruk({ hasil: baik, nominal: 70000 }), { status: "VERIFIED", reason: "ok" });
  });

  it("bukan struk, keyakinan rendah, total tak terbaca, dan total berbeda: FAILED dengan alasan masing-masing", () => {
    assert.deepEqual(putuskanStruk({ hasil: { ...baik, isReceipt: false }, nominal: 70000 }), { status: "FAILED", reason: "not-a-receipt" });
    assert.deepEqual(putuskanStruk({ hasil: { ...baik, confidence: 0.59 }, nominal: 70000 }), { status: "FAILED", reason: "low-confidence" });
    assert.deepEqual(putuskanStruk({ hasil: { ...baik, total: null }, nominal: 70000 }), { status: "FAILED", reason: "total-unreadable" });
    assert.deepEqual(putuskanStruk({ hasil: { ...baik, total: 69999 }, nominal: 70000 }), { status: "FAILED", reason: "total-mismatch" });
  });

  it("ambang keyakinan 0,6 berlaku inklusif", () => {
    assert.equal(putuskanStruk({ hasil: { ...baik, confidence: 0.6 }, nominal: 70000 }).status, "VERIFIED");
    assert.equal(putuskanStruk({ hasil: { ...baik, confidence: 0 }, nominal: 70000 }).reason, "low-confidence");
  });

  it("urutan pemeriksaan: bukan struk mengalahkan keyakinan, total, dan duplikat", () => {
    const buruk = { isReceipt: false, total: null, confidence: 0.1 };
    assert.equal(putuskanStruk({ hasil: buruk, nominal: 5, duplikatId: 9 }).reason, "not-a-receipt");
    assert.equal(putuskanStruk({ hasil: { isReceipt: true, total: null, confidence: 0.1 }, nominal: 5, duplikatId: 9 }).reason, "low-confidence");
    assert.equal(putuskanStruk({ hasil: { isReceipt: true, total: null, confidence: 0.9 }, nominal: 5, duplikatId: 9 }).reason, "total-unreadable");
    assert.equal(putuskanStruk({ hasil: { isReceipt: true, total: 4, confidence: 0.9 }, nominal: 5, duplikatId: 9 }).reason, "total-mismatch");
  });

  it("isi mirip struk lain hanya berlaku bila struk lolos semua pemeriksaan: NEEDS_REVIEW membawa existingTransactionId", () => {
    assert.deepEqual(putuskanStruk({ hasil: baik, nominal: 70000, duplikatId: 33 }), {
      status: "NEEDS_REVIEW", reason: "possible-duplicate", warnings: [{ code: "possible-duplicate", existingTransactionId: 33 }],
    });
    assert.equal(putuskanStruk({ hasil: baik, nominal: 70000, duplikatId: null }).status, "VERIFIED");
  });
});
