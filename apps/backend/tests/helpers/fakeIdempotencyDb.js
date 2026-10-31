// Basis data palsu di memori untuk tes unit idempotensi. BUKAN bukti SQL Server:
// hanya cukup setia untuk menguji logika pembungkus (transaksi dengan pembatalan, kunci unik).
export function buatDbPalsu(jam) {
  const tabel = [];
  const bisnis = [];
  const s = { create: 0, gagalCreate: false, gagalUpdate: false, jedaBaca: 0 };
  let urut = 0;
  const salin = (b) => (b === undefined ? null : { ...b });
  const cocok = (b, w) =>
    (w.id === undefined || b.id === w.id) &&
    (w.userId === undefined || b.userId === w.userId) &&
    (w.key === undefined || b.key === w.key) &&
    (w.state === undefined || b.state === w.state) &&
    (w.createdAt === undefined || b.createdAt.getTime() < w.createdAt.lt.getTime());

  const idempotencyKey = {
    async create({ data }) {
      s.create++;
      if (s.gagalCreate) throw new Error("db mati");
      if (tabel.some((b) => b.userId === data.userId && b.key === data.key)) throw new Error("kunci unik");
      const b = { id: ++urut, state: "IN_PROGRESS", statusCode: null, responseBody: null, completedAt: null, ...data, createdAt: new Date(jam.t) };
      tabel.push(b);
      return { id: b.id };
    },
    async findUnique({ where }) {
      const { userId, key } = where.userId_key;
      const b = salin(tabel.find((x) => x.userId === userId && x.key === key));
      if (s.jedaBaca > 0) await new Promise((r) => setTimeout(r, s.jedaBaca));
      return b;
    },
    async findMany({ where }) {
      return tabel.filter((b) => cocok(b, where)).map(salin);
    },
    async deleteMany({ where }) {
      const hapus = tabel.filter((b) => cocok(b, where));
      for (const b of hapus) tabel.splice(tabel.indexOf(b), 1);
      return { count: hapus.length };
    },
    async updateMany({ where, data }) {
      const kena = tabel.filter((b) => cocok(b, where));
      for (const b of kena) Object.assign(b, data);
      return { count: kena.length };
    },
  };

  // Penulisan lewat tx dicatat supaya dapat dibatalkan bila fn melempar.
  async function $transaction(fn) {
    const undo = [];
    const tx = {
      bisnis: {
        tambah(x) {
          bisnis.push(x);
          undo.push(() => bisnis.splice(bisnis.indexOf(x), 1));
        },
      },
      idempotencyKey: {
        async update({ where, data }) {
          if (s.gagalUpdate) throw new Error("update gagal");
          const b = tabel.find((x) => x.id === where.id);
          const lama = { ...b };
          Object.assign(b, data);
          undo.push(() => Object.assign(b, lama));
          return { ...b };
        },
      },
    };
    try {
      return await fn(tx);
    } catch (e) {
      for (const u of undo.reverse()) u();
      throw e;
    }
  }

  return { tabel, bisnis, s, idempotencyKey, $transaction };
}
