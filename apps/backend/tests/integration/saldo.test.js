// Saldo di SQL Server nyata (T1.9a): router, layanan, ledger, requireMember, dan daftar grup asli.
// Entri ledger dan pelunasan dibuat lewat factory (modul pelunasan baru ada di T1.9b). Tabel
// tambah-saja (LedgerEntry, AuditLog) tidak di-UPDATE atau DELETE.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../helpers/db.js";
import { buatUser, buatGrup, buatAnggota, buatTransaksi, buatLedger } from "../helpers/factories.js";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { buatLayananGrup } from "../../src/services/grup.js";
import { buatLayananLedger } from "../../src/services/ledger.js";
import { buatLayananSaldo } from "../../src/services/saldoGrup.js";
import { buatRouterGrup } from "../../src/routes/grup.router.js";
import { buatRouterSaldoGrup, buatRouterSaldoSaya } from "../../src/routes/saldo.router.js";

const SECRET = "rahasia-integrasi-saldo-yang-cukup-panjang-abcdef";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

describe("saldo di SQL Server", () => {
  let server;
  before(async () => {
    const requireAuth = buatRequireAuth({ secret: SECRET });
    const akses = buatAkses({ db: prisma });
    const ledger = buatLayananLedger({ db: prisma });
    const saldo = buatLayananSaldo({ db: prisma, ledger });
    server = await mulaiAplikasi((app) => {
      app.use("/api/groups", buatRouterGrup({ layanan: buatLayananGrup({ db: prisma, ledger }), requireAuth, requireActiveMember: akses.requireActiveMember, idempoten: buatIdempotensi({ db: prisma }).idempoten }));
      app.use("/api/groups", buatRouterSaldoGrup({ layanan: saldo, requireAuth, requireMember: akses.requireMember }));
      app.use("/api/me", buatRouterSaldoSaya({ layanan: saldo, requireAuth }));
    });
  });
  after(async () => {
    await server.tutup();
    await prisma.$disconnect();
  });

  async function ambil(path, user) {
    const res = await fetch(server.url + "/api" + path, { headers: user ? { authorization: "Bearer " + token(user.id) } : {} });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  }

  // Grup dengan anggota berurutan; anggota pertama OWNER. Setiap pengguna bernama unik.
  async function buatRuang(daftar) {
    const user = [];
    for (const d of daftar) user.push(await buatUser({ name: d.nama }));
    const grup = await buatGrup(user[0].id, { name: "Grup " + randomUUID().slice(0, 8) });
    for (let i = 0; i < daftar.length; i++) await buatAnggota(grup.id, user[i].id, { role: i === 0 ? "OWNER" : "MEMBER", status: daftar[i].status ?? "ACTIVE" });
    const transaksi = await buatTransaksi(grup.id, user[0].id, { amount: 100000 });
    return { user, grup, transaksi, base: "/groups/" + grup.id + "/balances" };
  }
  const charge = (r, debitur, kreditur, jumlah) =>
    buatLedger(r.grup.id, { type: "CHARGE", sign: 1, amount: BigInt(jumlah), debtorUserId: debitur.id, creditorUserId: kreditur.id, category: "GROUP", transactionId: r.transaksi.id, createdBy: kreditur.id });
  async function lunasi(r, pengirim, penerima, jumlah) {
    const bayar = await prisma.paymentConfirmation.create({
      data: { groupId: r.grup.id, senderId: pengirim.id, receiverId: penerima.id, amount: jumlah, methodType: "CASH", status: "CONFIRMED" },
    });
    return buatLedger(r.grup.id, { type: "SETTLEMENT", sign: -1, amount: BigInt(jumlah), debtorUserId: pengirim.id, creditorUserId: penerima.id, paymentId: bayar.id, createdBy: penerima.id });
  }
  const pihak = (u, nama, membership = "ACTIVE") => ({ kind: "USER", id: u.id, name: nama, membership });

  it("K25 lewat API: A menanggung 50.000 untuk B dan B 20.000 untuk A menjadi Rp30.000; pelunasan sebagian dan penuh mengurangi sampai nol", async () => {
    const r = await buatRuang([{ nama: "Aqi" }, { nama: "Bintang" }, { nama: "Citra" }]);
    const [a, b, c] = r.user;
    await charge(r, b, a, 50000);
    await charge(r, a, b, 20000);

    const ringkas = await ambil(r.base, c);
    assert.equal(ringkas.status, 200);
    assert.deepEqual(ringkas.body.data.members, [
      { party: pihak(a, "Aqi"), owes: 0, owed: 30000, balance: 30000 },
      { party: pihak(b, "Bintang"), owes: 30000, owed: 0, balance: -30000 },
      { party: pihak(c, "Citra"), owes: 0, owed: 0, balance: 0 },
    ]);
    assert.equal(ringkas.body.data.members.reduce((t, m) => t + m.balance, 0), 0);

    const rincianB = await ambil(r.base + "/" + b.id, b);
    assert.deepEqual(rincianB.body.data, {
      party: pihak(b, "Bintang"),
      owes: 30000,
      owed: 0,
      counterparties: [{ party: pihak(a, "Aqi"), amount: 30000, direction: "X_OWES", breakdown: { group: 30000, individual: 0, settled: 0 }, pendingPayments: 0, payable: 30000 }],
    });

    await lunasi(r, b, a, 10000);
    const sebagian = (await ambil(r.base + "/" + b.id, b)).body.data.counterparties[0];
    assert.deepEqual([sebagian.amount, sebagian.direction, sebagian.breakdown, sebagian.payable], [20000, "X_OWES", { group: 30000, individual: 0, settled: -10000 }, 20000]);
    const sudutA = (await ambil(r.base + "/" + a.id, a)).body.data.counterparties[0];
    assert.deepEqual([sudutA.amount, sudutA.direction, sudutA.breakdown, sudutA.payable], [20000, "X_IS_OWED", { group: -30000, individual: 0, settled: 10000 }, 0]);

    await lunasi(r, b, a, 20000);
    assert.deepEqual((await ambil(r.base + "/" + b.id, b)).body.data.counterparties, []);
    assert.deepEqual((await ambil(r.base, a)).body.data.members.map((m) => m.balance), [0, 0, 0]);
  });

  it("pelunasan PENDING mengurangi payable hanya bagi pemanggil sendiri; REJECTED dan CANCELLED tidak dihitung; pemanggil lain melihat null", async () => {
    const r = await buatRuang([{ nama: "Aqi" }, { nama: "Bintang" }]);
    const [a, b] = r.user;
    await charge(r, b, a, 30000);
    const dasar = { groupId: r.grup.id, senderId: b.id, receiverId: a.id, methodType: "CASH" };
    await prisma.paymentConfirmation.create({ data: { ...dasar, amount: 4000, status: "PENDING" } });
    await prisma.paymentConfirmation.create({ data: { ...dasar, amount: 6000, status: "PENDING" } });
    await prisma.paymentConfirmation.create({ data: { ...dasar, amount: 5000, status: "REJECTED" } });
    await prisma.paymentConfirmation.create({ data: { ...dasar, amount: 7000, status: "CANCELLED" } });

    const milikB = (await ambil(r.base + "/" + b.id, b)).body.data.counterparties[0];
    assert.deepEqual([milikB.amount, milikB.pendingPayments, milikB.payable], [30000, 10000, 20000]);
    const dilihatA = (await ambil(r.base + "/" + b.id, a)).body.data.counterparties[0];
    assert.deepEqual([dilihatA.amount, dilihatA.pendingPayments, dilihatA.payable], [30000, null, null]);
    const sudutA = (await ambil(r.base + "/" + a.id, a)).body.data.counterparties[0];
    assert.deepEqual([sudutA.direction, sudutA.pendingPayments, sudutA.payable], ["X_IS_OWED", 0, 0]);
  });

  it("mantan anggota: LEFT bersaldo tampil bagi anggota ACTIVE; mantan hanya melihat dirinya; REMOVED tanpa saldo tidak muncul; ringkasan saya mengikuti", async () => {
    const r = await buatRuang([{ nama: "Aqi" }, { nama: "Bintang" }, { nama: "Dewi", status: "LEFT" }, { nama: "Eko", status: "REMOVED" }]);
    const [a, b, d, e] = r.user;
    await charge(r, d, a, 10000);

    const dilihatA = (await ambil(r.base, a)).body.data.members;
    assert.deepEqual(dilihatA, [
      { party: pihak(a, "Aqi"), owes: 0, owed: 10000, balance: 10000 },
      { party: pihak(b, "Bintang"), owes: 0, owed: 0, balance: 0 },
      { party: pihak(d, "Dewi", "LEFT"), owes: 10000, owed: 0, balance: -10000 },
    ]);

    const milikD = await ambil(r.base, d);
    assert.equal(milikD.status, 200);
    assert.deepEqual(milikD.body.data.members, [{ party: pihak(d, "Dewi", "LEFT"), owes: 10000, owed: 0, balance: -10000 }]);
    const rincianD = (await ambil(r.base + "/" + d.id, d)).body.data;
    assert.deepEqual([rincianD.party.membership, rincianD.owes, rincianD.counterparties[0].payable], ["LEFT", 10000, 10000]);
    const lain = await ambil(r.base + "/" + a.id, d);
    assert.equal(lain.status, 403);
    assert.equal(lain.body.code, "forbidden");

    const milikE = await ambil(r.base, e);
    assert.deepEqual(milikE.body.data.members, [{ party: pihak(e, "Eko", "REMOVED"), owes: 0, owed: 0, balance: 0 }]);
    assert.deepEqual((await ambil(r.base + "/" + e.id, e)).body.data.counterparties, []);

    const sayaD = (await ambil("/me/balances", d)).body.data;
    assert.deepEqual(sayaD.groups.map((g) => [g.group.id, g.owes, g.balance]), [[r.grup.id, 10000, -10000]]);
    assert.deepEqual((await ambil("/me/balances", e)).body.data, { totals: { owes: 0, owed: 0, balance: 0 }, groups: [] });
  });

  it("akses: tanpa token 401; bukan anggota dan grup tak ada 403; fund 400; target bukan anggota 404; id tak sah 400", async () => {
    const r = await buatRuang([{ nama: "Aqi" }, { nama: "Bintang" }]);
    const orangLain = await buatUser({ name: "Asing" });
    for (const p of [r.base, r.base + "/" + r.user[0].id, "/me/balances"]) assert.equal((await ambil(p)).status, 401, p);
    for (const p of [r.base, r.base + "/" + r.user[0].id]) {
      const h = await ambil(p, orangLain);
      assert.equal(h.status, 403, p);
      assert.equal(h.body.code, "forbidden");
    }
    assert.equal((await ambil("/groups/2147483000/balances", r.user[0])).status, 403);

    const dana = await ambil(r.base + "/fund", r.user[0]);
    assert.equal(dana.status, 400);
    assert.equal(dana.body.code, "validation-failed");
    assert.equal(dana.body.errors[0].field, "userId");
    const asing = await ambil(r.base + "/" + orangLain.id, r.user[0]);
    assert.equal(asing.status, 404);
    assert.equal(asing.body.code, "not-found");
    for (const id of ["abc", "0", "Fund"]) assert.equal((await ambil(r.base + "/" + id, r.user[0])).status, 400, "userId " + id);
  });

  it("daftar grup memuat balance nyata per pemanggil dan ringkasan saya menjumlahkan lintas grup (urut grup terbaru)", async () => {
    const satu = await buatRuang([{ nama: "Aqi" }, { nama: "Bintang" }, { nama: "Citra" }]);
    const [a, b, c] = satu.user;
    await charge(satu, b, a, 30000);
    const grupDua = await buatGrup(b.id, { name: "Dua " + randomUUID().slice(0, 8) });
    await buatAnggota(grupDua.id, b.id, { role: "OWNER", status: "ACTIVE" });
    await buatAnggota(grupDua.id, c.id, { role: "MEMBER", status: "ACTIVE" });
    const trxDua = await buatTransaksi(grupDua.id, b.id, { amount: 10000 });
    await buatLedger(grupDua.id, { type: "CHARGE", sign: 1, amount: 5000n, debtorUserId: c.id, creditorUserId: b.id, category: "GROUP", transactionId: trxDua.id, createdBy: b.id });

    const saldoDi = async (user, groupId) => (await ambil("/groups", user)).body.data.find((g) => g.id === groupId).balance;
    assert.equal(await saldoDi(b, satu.grup.id), -30000);
    assert.equal(await saldoDi(a, satu.grup.id), 30000);
    assert.equal(await saldoDi(c, satu.grup.id), 0);
    assert.equal(await saldoDi(b, grupDua.id), 5000);
    assert.equal(await saldoDi(c, grupDua.id), -5000);

    const saya = (await ambil("/me/balances", b)).body.data;
    assert.deepEqual(saya.totals, { owes: 30000, owed: 5000, balance: -25000 });
    assert.deepEqual(saya.groups.map((g) => [g.group.id, g.owes, g.owed, g.balance]), [
      [grupDua.id, 0, 5000, 5000],
      [satu.grup.id, 30000, 0, -30000],
    ]);
    assert.equal(saya.groups.find((g) => g.group.id === satu.grup.id).group.name, satu.grup.name);
  });
});
