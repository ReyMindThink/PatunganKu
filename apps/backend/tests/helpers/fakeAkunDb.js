// Basis data palsu di memori untuk tes unit layanan akun. BUKAN bukti SQL Server.
export function buatDbAkun() {
  const user = [];
  const audit = [];
  const s = { gagalCreateUser: false, gagalAudit: false, sebelumCreate: null };
  let uid = 0;
  let aid = 0;
  const salin = (b) => (b === undefined ? null : { ...b });
  const cari = (where) => user.find((u) => (where.id === undefined ? u.email === where.email : u.id === where.id));
  const tambahUser = (data) => {
    const u = { id: ++uid, notifyByEmail: false, createdAt: new Date(1700000000000), ...data };
    user.push(u);
    return u;
  };

  function klien(undo) {
    return {
      user: {
        findUnique: async ({ where }) => salin(cari(where)),
        create: async ({ data }) => {
          if (s.sebelumCreate) {
            const f = s.sebelumCreate;
            s.sebelumCreate = null;
            f();
          }
          if (s.gagalCreateUser) throw new Error("db mati");
          if (user.some((u) => u.email === data.email)) throw new Error("email unik");
          const u = tambahUser(data);
          undo.push(() => user.splice(user.indexOf(u), 1));
          return salin(u);
        },
        update: async ({ where, data }) => {
          const u = cari(where);
          const lama = { ...u };
          Object.assign(u, data);
          undo.push(() => Object.assign(u, lama));
          return salin(u);
        },
      },
      auditLog: {
        create: async ({ data }) => {
          if (s.gagalAudit) throw new Error("audit gagal");
          const b = { id: ++aid, ...data };
          audit.push(b);
          undo.push(() => audit.splice(audit.indexOf(b), 1));
          return { id: b.id };
        },
      },
    };
  }

  async function $transaction(fn) {
    const undo = [];
    try {
      return await fn(klien(undo));
    } catch (e) {
      for (const u of undo.reverse()) u();
      throw e;
    }
  }

  return { user, audit, s, tambahUser, db: { user: klien([]).user, $transaction } };
}
