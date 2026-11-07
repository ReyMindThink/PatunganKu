// Saldo dari entri ledger (K25, K7). Murni: tidak mengenal Prisma. Entri berbentuk
// { type, sign, amount (BigInt), debtorUserId, creditorUserId, category }. Saldo pasangan tak
// berurut: N(A, B) = d(A ke B) dikurangi d(B ke A); positif berarti A berutang kepada B.
// Semua jumlah dihitung dalam BigInt dan baru menjadi Number di batas keluaran, dengan
// pemeriksaan bilangan bulat aman.
const TIPE = ["CHARGE", "REVERSAL", "SETTLEMENT"];
const KATEGORI = { GROUP: "group", INDIVIDUAL: "individual" };

function keNumber(nilai) {
  const n = Number(nilai);
  if (Number.isSafeInteger(n) === false) throw new Error("saldo: jumlah melebihi bilangan bulat aman");
  return n;
}

function periksa(e) {
  const ok = TIPE.includes(e?.type) && (e.sign === 1 || e.sign === -1);
  if (ok === false) throw new Error("saldo: type atau sign entri tidak sah");
  if (Number.isSafeInteger(e.debtorUserId) === false || Number.isSafeInteger(e.creditorUserId) === false) {
    throw new Error("saldo: pihak entri harus pengguna");
  }
  if (e.debtorUserId === e.creditorUserId) throw new Error("saldo: debitur sama dengan kreditur");
  const jumlah = typeof e.amount === "bigint" ? e.amount : BigInt(e.amount);
  if (jumlah <= 0n) throw new Error("saldo: amount harus positif");
  const perluKategori = e.type === "CHARGE" || e.type === "REVERSAL";
  if (perluKategori && KATEGORI[e.category] === undefined) throw new Error("saldo: category entri tidak sah");
  return jumlah;
}

// Per pasangan (lo < hi), dari sudut pandang lo sebagai debitur: group, individual, settled.
function kumpulkan(entri) {
  const peta = new Map();
  for (const e of entri) {
    const jumlah = periksa(e);
    const lo = Math.min(e.debtorUserId, e.creditorUserId);
    const hi = Math.max(e.debtorUserId, e.creditorUserId);
    const kunci = lo + ":" + hi;
    if (peta.has(kunci) === false) peta.set(kunci, { lo, hi, group: 0n, individual: 0n, settled: 0n });
    const p = peta.get(kunci);
    const nilai = BigInt(e.sign) * jumlah * (e.debtorUserId === lo ? 1n : -1n);
    const kolom = e.type === "SETTLEMENT" ? "settled" : KATEGORI[e.category];
    p[kolom] += nilai;
  }
  return peta;
}
const bersih = (p) => p.group + p.individual + p.settled;

// N(a, b) sebagai Number: positif berarti a berutang kepada b.
export function saldoPasangan(entri, a, b) {
  if (a === b) throw new Error("saldo: pasangan harus dua pengguna berbeda");
  const p = kumpulkan(entri).get(Math.min(a, b) + ":" + Math.max(a, b));
  if (p === undefined) return 0;
  return keNumber(a === p.lo ? bersih(p) : -bersih(p));
}

// Ringkasan semua pengguna yang muncul di entri, urut userId. balance = owed - owes.
export function ringkasanSaldo(entri) {
  const total = new Map();
  const ambil = (id) => {
    if (total.has(id) === false) total.set(id, { owes: 0n, owed: 0n });
    return total.get(id);
  };
  for (const p of kumpulkan(entri).values()) {
    ambil(p.lo);
    ambil(p.hi);
    const n = bersih(p);
    if (n > 0n) {
      ambil(p.lo).owes += n;
      ambil(p.hi).owed += n;
    } else if (n < 0n) {
      ambil(p.hi).owes -= n;
      ambil(p.lo).owed -= n;
    }
  }
  return [...total.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([userId, t]) => ({ userId, owes: keNumber(t.owes), owed: keNumber(t.owed), balance: keNumber(t.owed - t.owes) }));
}

// Rincian satu pengguna X ke tiap pihak lawan (api-contract 10.2). Breakdown dari sudut
// pandang X sebagai pengutang: positif menambah utang X. Hanya pihak bersaldo tidak nol.
export function rincianSaldo(entri, userId) {
  let owes = 0n;
  let owed = 0n;
  const lawan = [];
  for (const p of kumpulkan(entri).values()) {
    const milik = p.lo === userId || p.hi === userId;
    if (milik === false) continue;
    const tanda = p.lo === userId ? 1n : -1n;
    const net = bersih(p) * tanda;
    if (net === 0n) continue;
    if (net > 0n) owes += net;
    else owed -= net;
    lawan.push({
      userId: p.lo === userId ? p.hi : p.lo,
      amount: net > 0n ? net : -net,
      direction: net > 0n ? "X_OWES" : "X_IS_OWED",
      breakdown: { group: p.group * tanda, individual: p.individual * tanda, settled: p.settled * tanda },
    });
  }
  lawan.sort((x, y) => (x.amount === y.amount ? x.userId - y.userId : x.amount > y.amount ? -1 : 1));
  return {
    userId,
    owes: keNumber(owes),
    owed: keNumber(owed),
    counterparties: lawan.map((l) => ({
      userId: l.userId,
      amount: keNumber(l.amount),
      direction: l.direction,
      breakdown: { group: keNumber(l.breakdown.group), individual: keNumber(l.breakdown.individual), settled: keNumber(l.breakdown.settled) },
    })),
  };
}
