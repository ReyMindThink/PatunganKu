import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatLayananGrup } from "../../src/services/grup.js";

// tx/db palsu di memori yang mencatat urutan panggilan. BUKAN bukti SQL Server.
function buatTx(awal = {}) {
  const s = { kodeTerpakai: [], grup: {}, anggota: {}, jumlahAktif: 0, ...awal };
  const log = [];
  const catat = (nama, arg) => log.push({ nama, arg });
  const tx = {
    log,
    group: {
      findUnique: async (arg) => {
        catat("group.findUnique", arg);
        if (arg.where.code === undefined) return s.grupById ? s.grupById(arg.where.id) : null;
        if (s.kodeTerpakai.includes(arg.where.code)) return { id: 1 };
        return s.grup[arg.where.code] ?? null;
      },
      create: async (arg) => {
        catat("group.create", arg);
        return { id: 7, name: arg.data.name, code: arg.data.code, createdAt: new Date(1700000000000) };
      },
      update: async (arg) => {
        catat("group.update", arg);
        return {};
      },
    },
    groupMember: {
      findUnique: async (arg) => {
        catat("groupMember.findUnique", arg);
        return s.anggota[arg.where.groupId_userId.groupId + ":" + arg.where.groupId_userId.userId] ?? null;
      },
      count: async (arg) => {
        catat("groupMember.count", arg);
        return s.jumlahAktif;
      },
      create: async (arg) => {
        catat("groupMember.create", arg);
        return { id: 99 };
      },
      update: async (arg) => {
        catat("groupMember.update", arg);
        return {};
      },
      findMany: async (arg) => {
        catat("groupMember.findMany", arg);
        return s.findMany ? s.findMany(arg) : [];
      },
    },
    auditLog: {
      create: async (arg) => {
        catat("auditLog.create", arg);
        return { id: 1 };
      },
    },
  };
  return tx;
}
const nama = (tx) => tx.log.map((l) => l.nama);
const tulis = (tx) => nama(tx).filter((n) => /create|update/.test(n) && n.startsWith("auditLog") === false);
const ambil = (tx, n) => tx.log.filter((l) => l.nama === n);
const galat = (status, code) => (e) => e.status === status && e.code === code;
const urutan = (tx, a, b) => nama(tx).indexOf(a) >= 0 && nama(tx).indexOf(a) < nama(tx).indexOf(b);

describe("layanan grup: buat dan gabung", () => {
  it("buat memakai kode bebas pertama; Group, OWNER ACTIVE, dan audit GROUP_CREATE ditulis; objek tanpa email", async () => {
    const tx = buatTx({ kodeTerpakai: ["AAAAAA", "BBBBBB"] });
    const urut = ["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD"];
    let i = 0;
    const layanan = buatLayananGrup({ db: tx, kode: () => urut[i++] });
    const hasil = await layanan.buat(tx, 5, { name: "Kos" });
    assert.deepEqual(ambil(tx, "group.create")[0].arg.data, { name: "Kos", code: "CCCCCC", createdBy: 5 });
    assert.deepEqual(ambil(tx, "groupMember.create")[0].arg.data, { groupId: 7, userId: 5, role: "OWNER", status: "ACTIVE" });
    const audit = ambil(tx, "auditLog.create")[0].arg.data;
    assert.equal(audit.action, "GROUP_CREATE");
    assert.equal(audit.groupId, 7);
    assert.equal(audit.actorId, 5);
    assert.equal(audit.entity, "Group");
    assert.equal(audit.entityId, 7);
    assert.equal(audit.newValue, '{"name":"Kos"}');
    assert.deepEqual(hasil, {
      id: 7, name: "Kos", code: "CCCCCC", codeHidden: false, joinRequiresApproval: false,
      myRole: "OWNER", membership: "ACTIVE", memberCount: 1, memberLimit: 50, createdAt: new Date(1700000000000),
    });
    assert.equal(JSON.stringify(hasil).includes("@"), false);
  });

  it("buat: bila 5 calon kode semuanya terpakai, galat dan tidak ada Group dibuat", async () => {
    const tx = buatTx({ kodeTerpakai: ["AAAAAA"] });
    let dipanggil = 0;
    const layanan = buatLayananGrup({ db: tx, kode: () => { dipanggil++; return "AAAAAA"; } });
    await assert.rejects(() => layanan.buat(tx, 5, { name: "Kos" }), /kode grup yang unik/);
    assert.equal(dipanggil, 5);
    assert.equal(ambil(tx, "group.create").length, 0);
    assert.equal(ambil(tx, "groupMember.create").length, 0);
  });

  it("gabung: kode tak dikenal 404 not-found tanpa menulis apa pun", async () => {
    const tx = buatTx();
    const layanan = buatLayananGrup({ db: tx });
    await assert.rejects(() => layanan.gabung(tx, 2, { code: "ZZZZZZ" }), galat(404, "not-found"));
    assert.deepEqual(tulis(tx), []);
    assert.equal(ambil(tx, "auditLog.create").length, 0);
  });

  it("gabung: urutan baca grup, kunci baris Group, baca keanggotaan, hitung ACTIVE, lalu sisipkan", async () => {
    const tx = buatTx({ grup: { ABC234: { id: 7, name: "Kos" } }, jumlahAktif: 3 });
    const layanan = buatLayananGrup({ db: tx });
    await layanan.gabung(tx, 2, { code: "ABC234" });
    assert.ok(urutan(tx, "group.findUnique", "group.update"));
    assert.ok(urutan(tx, "group.update", "groupMember.findUnique"));
    assert.ok(urutan(tx, "groupMember.findUnique", "groupMember.count"));
    assert.ok(urutan(tx, "groupMember.count", "groupMember.create"));
    assert.deepEqual(ambil(tx, "group.update")[0].arg, { where: { id: 7 }, data: { name: "Kos" } });
    assert.deepEqual(ambil(tx, "groupMember.count")[0].arg.where, { groupId: 7, status: "ACTIVE" });
  });

  it("gabung: ACTIVE 409 already-member dan REMOVED 409 invalid-state, keduanya tanpa menulis", async () => {
    for (const [status, code] of [["ACTIVE", "already-member"], ["REMOVED", "invalid-state"]]) {
      const tx = buatTx({ grup: { ABC234: { id: 7, name: "Kos" } }, anggota: { "7:2": { id: 40, status } } });
      const layanan = buatLayananGrup({ db: tx });
      await assert.rejects(() => layanan.gabung(tx, 2, { code: "ABC234" }), galat(409, code));
      assert.equal(tulis(tx).filter((n) => n.startsWith("groupMember")).length, 0);
      assert.equal(ambil(tx, "auditLog.create").length, 0);
    }
  });

  it("gabung: 50 anggota aktif ditolak group-full, 49 lolos", async () => {
    const penuh = buatTx({ grup: { ABC234: { id: 7, name: "Kos" } }, jumlahAktif: 50 });
    await assert.rejects(() => buatLayananGrup({ db: penuh }).gabung(penuh, 2, { code: "ABC234" }), galat(409, "group-full"));
    assert.equal(ambil(penuh, "groupMember.create").length, 0);
    const hampir = buatTx({ grup: { ABC234: { id: 7, name: "Kos" } }, jumlahAktif: 49 });
    const hasil = await buatLayananGrup({ db: hampir }).gabung(hampir, 2, { code: "ABC234" });
    assert.equal(hasil.outcome, "JOINED");
    assert.equal(ambil(hampir, "groupMember.create").length, 1);
  });

  it("gabung anggota baru: MEMBER ACTIVE, audit GROUP_JOIN rejoin false, hasil JOINED", async () => {
    const tx = buatTx({ grup: { ABC234: { id: 7, name: "Kos" } }, jumlahAktif: 1 });
    const hasil = await buatLayananGrup({ db: tx }).gabung(tx, 2, { code: "ABC234" });
    assert.deepEqual(ambil(tx, "groupMember.create")[0].arg.data, { groupId: 7, userId: 2, role: "MEMBER", status: "ACTIVE" });
    const audit = ambil(tx, "auditLog.create")[0].arg.data;
    assert.equal(audit.action, "GROUP_JOIN");
    assert.equal(audit.groupId, 7);
    assert.equal(audit.actorId, 2);
    assert.equal(audit.newValue, '{"rejoin":false}');
    assert.deepEqual(hasil, { outcome: "JOINED", group: { id: 7, name: "Kos" }, requestId: null });
  });

  it("gabung kembali (LEFT): baris yang sama dihidupkan sebagai MEMBER, tanpa create, audit rejoin true", async () => {
    const tx = buatTx({ grup: { ABC234: { id: 7, name: "Kos" } }, anggota: { "7:2": { id: 40, status: "LEFT" } }, jumlahAktif: 1 });
    await buatLayananGrup({ db: tx }).gabung(tx, 2, { code: "ABC234" });
    assert.equal(ambil(tx, "groupMember.create").length, 0);
    assert.deepEqual(ambil(tx, "groupMember.update")[0].arg, {
      where: { id: 40 },
      data: { status: "ACTIVE", role: "MEMBER", leftAt: null, leftReason: null },
    });
    assert.equal(ambil(tx, "auditLog.create")[0].arg.data.newValue, '{"rejoin":true}');
  });
});

describe("layanan grup: baca", () => {
  it("daftarSaya: hanya keanggotaan ACTIVE urut grup terbaru, hitungan anggota, pending per peran, balance 0", async () => {
    const tx = buatTx();
    tx.findManyKe = 0;
    const jawaban = [
      [
        { role: "OWNER", status: "ACTIVE", group: { id: 9, name: "Trip" } },
        { role: "MEMBER", status: "ACTIVE", group: { id: 4, name: "Kos" } },
      ],
      [{ groupId: 9 }, { groupId: 9 }, { groupId: 9 }, { groupId: 4 }],
    ];
    tx.groupMember.findMany = async (arg) => {
      tx.log.push({ nama: "groupMember.findMany", arg });
      return jawaban[tx.findManyKe++];
    };
    const hasil = await buatLayananGrup({ db: tx }).daftarSaya(2);
    const kueri = ambil(tx, "groupMember.findMany");
    assert.equal(kueri.length, 2);
    assert.deepEqual(kueri[0].arg.where, { userId: 2, status: "ACTIVE" });
    assert.deepEqual(kueri[0].arg.orderBy, { groupId: "desc" });
    assert.deepEqual(kueri[1].arg.where, { groupId: { in: [9, 4] }, status: "ACTIVE" });
    assert.deepEqual(hasil, [
      { id: 9, name: "Trip", membership: "ACTIVE", myRole: "OWNER", memberCount: 3, balance: 0, pendingJoinRequests: 0 },
      { id: 4, name: "Kos", membership: "ACTIVE", myRole: "MEMBER", memberCount: 1, balance: 0, pendingJoinRequests: null },
    ]);

    const kosong = buatTx();
    const hasilKosong = await buatLayananGrup({ db: kosong }).daftarSaya(3);
    assert.deepEqual(hasilKosong, []);
    assert.equal(ambil(kosong, "groupMember.findMany").length, 1);
  });

  it("detail: menghitung hanya anggota ACTIVE dan memakai peran serta status pemanggil", async () => {
    const tx = buatTx({ grupById: () => ({ id: 7, name: "Kos", code: "ABC234", createdAt: new Date(1700000000000) }), jumlahAktif: 4 });
    const hasil = await buatLayananGrup({ db: tx }).detail(7, { role: "ADMIN", status: "ACTIVE" });
    assert.deepEqual(ambil(tx, "groupMember.count")[0].arg.where, { groupId: 7, status: "ACTIVE" });
    assert.equal(hasil.memberCount, 4);
    assert.equal(hasil.myRole, "ADMIN");
    assert.equal(hasil.membership, "ACTIVE");
    assert.equal(hasil.code, "ABC234");
  });

  it("anggota: urut joinedAt lalu id, hanya ACTIVE, email tidak bocor", async () => {
    const tx = buatTx({
      findMany: () => [{ role: "OWNER", joinedAt: new Date(1), user: { id: 1, name: "Rey", email: "rey@x.id" } }],
    });
    const hasil = await buatLayananGrup({ db: tx }).anggota(7);
    const arg = ambil(tx, "groupMember.findMany")[0].arg;
    assert.deepEqual(arg.where, { groupId: 7, status: "ACTIVE" });
    assert.deepEqual(arg.orderBy, [{ joinedAt: "asc" }, { id: "asc" }]);
    assert.deepEqual(hasil, [{ user: { id: 1, name: "Rey" }, role: "OWNER", joinedAt: new Date(1) }]);
    assert.equal(JSON.stringify(hasil).includes("@"), false);
  });
});
