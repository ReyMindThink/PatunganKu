export function computeBalances(memberIds, transactions, payments) {
  const balances = new Map(memberIds.map((id) => [id, 0]));
  const add = (id, delta) => {
    if (balances.has(id)) balances.set(id, balances.get(id) + delta);
  };

  for (const tx of transactions) {
    add(tx.payerId, tx.amount);
    for (const s of tx.splits) add(s.userId, -s.amount);
  }
  for (const p of payments) {
    add(p.senderId, p.amount);
    add(p.receiverId, -p.amount);
  }
  return balances;
}

export function suggestSettlements(balances) {
  const debtors = [];
  const creditors = [];
  for (const [userId, amount] of balances) {
    if (amount < 0) debtors.push({ userId, amount: -amount });
    else if (amount > 0) creditors.push({ userId, amount });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const result = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    result.push({ from: debtors[i].userId, to: creditors[j].userId, amount: pay });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return result;
}
