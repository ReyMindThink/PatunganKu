import test from "node:test";
import assert from "node:assert/strict";
import { splitEqual } from "../../src/utils/splitMoney.js";

const sum = (arr) => arr.reduce((s, x) => s + x.amount, 0);

test("100000 untuk 3 orang: total tepat, sisa ke peserta pertama", () => {
  const r = splitEqual(100000, [1, 2, 3]);
  assert.deepEqual(r.map((x) => x.amount), [33334, 33333, 33333]);
  assert.equal(sum(r), 100000);
});

test("habis dibagi: semua sama", () => {
  const r = splitEqual(90000, [1, 2, 3]);
  assert.deepEqual(r.map((x) => x.amount), [30000, 30000, 30000]);
});

test("satu peserta menanggung seluruhnya", () => {
  assert.deepEqual(splitEqual(5000, [7]), [{ userId: 7, amount: 5000 }]);
});

test("nominal kecil dari jumlah peserta: total tetap tepat", () => {
  const r = splitEqual(2, [1, 2, 3]);
  assert.deepEqual(r.map((x) => x.amount), [1, 1, 0]);
  assert.equal(sum(r), 2);
});
