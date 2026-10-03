import test from "node:test";
import assert from "node:assert/strict";
import { computeBalances, suggestSettlements } from "../../src/utils/ledger.js";

test("data tes Kos Mawar: Rasyid +20000, Aqidatul -20000", () => {
  const txs = [
    { payerId: 1, amount: 100001, splits: [{ userId: 1, amount: 50001 }, { userId: 2, amount: 50000 }] },
    { payerId: 2, amount: 50000, splits: [{ userId: 1, amount: 30000 }, { userId: 2, amount: 20000 }] },
  ];
  const b = computeBalances([1, 2], txs, []);
  assert.equal(b.get(1), 20000);
  assert.equal(b.get(2), -20000);
  assert.deepEqual(suggestSettlements(b), [{ from: 2, to: 1, amount: 20000 }]);
});

test("pelunasan yang dikonfirmasi menutup utang", () => {
  const txs = [{ payerId: 1, amount: 100, splits: [{ userId: 1, amount: 50 }, { userId: 2, amount: 50 }] }];
  const b = computeBalances([1, 2], txs, [{ senderId: 2, receiverId: 1, amount: 50 }]);
  assert.equal(b.get(1), 0);
  assert.equal(b.get(2), 0);
  assert.deepEqual(suggestSettlements(b), []);
});

test("tiga orang: jumlah saldo 0 dan transfer maksimal n-1", () => {
  const txs = [{ payerId: 1, amount: 90, splits: [{ userId: 1, amount: 30 }, { userId: 2, amount: 30 }, { userId: 3, amount: 30 }] }];
  const b = computeBalances([1, 2, 3], txs, []);
  assert.equal([...b.values()].reduce((s, x) => s + x, 0), 0);
  const s = suggestSettlements(b);
  assert.ok(s.length <= 2);
  assert.equal(s.reduce((t, x) => t + x.amount, 0), 60);
});
