export function splitEqual(total, userIds) {
  const n = userIds.length;
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return userIds.map((userId, i) => ({
    userId,
    amount: base + (i < remainder ? 1 : 0),
  }));
}
