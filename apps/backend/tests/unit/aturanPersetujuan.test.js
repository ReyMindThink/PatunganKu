import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bolehMemilih, kuorumDibutuhkan, penentuTunggal, pilihAturan, tentukanKeputusan } from "../../src/utils/aturanPersetujuan.js";

describe("kuorumDibutuhkan (20 persen, dibulatkan ke atas, dibatasi 1 sampai 5)", () => {
  it("n = 1, 2, 3, 5, 6, 25, 40 dan batas sekitarnya", () => {
    const harapan = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 10: 2, 11: 3, 20: 4, 21: 5, 25: 5, 26: 5, 40: 5, 49: 5 };
    for (const [n, h] of Object.entries(harapan)) assert.equal(kuorumDibutuhkan(Number(n)), h, "n = " + n);
  });

  it("selalu antara 1 dan n (CK_Approval_counts) dan tidak pernah turun saat n naik", () => {
    let sebelumnya = 0;
    for (let n = 1; n <= 49; n++) {
      const k = kuorumDibutuhkan(n);
      assert.ok(k >= 1 && k <= n && k >= sebelumnya, "n = " + n);
      sebelumnya = k;
    }
  });

  it("masukan bukan bilangan bulat positif adalah galat pemrogram", () => {
    for (const n of [0, -1, 1.5, NaN, "3", null, undefined]) assert.throws(() => kuorumDibutuhkan(n), /bilangan bulat positif/);
  });
});

describe("pilihAturan", () => {
  const A = (...pasang) => pasang.map(([userId, role]) => ({ userId, role }));
  it("tanpa anggota lain: null (langsung berlaku)", () => {
    assert.equal(pilihAturan({ pengajuId: 1, pengajuRole: "OWNER", anggota: A([1, "OWNER"]) }), null);
    assert.equal(pilihAturan({ pengajuId: 1, pengajuRole: "OWNER", anggota: [] }), null);
  });
  it("pengaju MEMBER: ADMIN_ANY dengan semua admin (OWNER dan ADMIN) sebagai pemilih", () => {
    const anggota = A([1, "MEMBER"], [2, "OWNER"], [3, "ADMIN"], [4, "MEMBER"]);
    assert.deepEqual(pilihAturan({ pengajuId: 1, pengajuRole: "MEMBER", anggota }), { rule: "ADMIN_ANY", eligibleCount: 2, required: 1 });
  });
  it("pengaju MEMBER tanpa admin lain: galat pemrogram, bukan persetujuan otomatis", () => {
    assert.throws(() => pilihAturan({ pengajuId: 1, pengajuRole: "MEMBER", anggota: A([1, "MEMBER"], [2, "MEMBER"]) }), /grup tanpa admin aktif/);
  });
  it("pengaju admin dengan admin lain: ADMIN_OTHER atas admin lain saja", () => {
    assert.deepEqual(pilihAturan({ pengajuId: 1, pengajuRole: "OWNER", anggota: A([1, "OWNER"], [2, "ADMIN"], [3, "MEMBER"]) }), { rule: "ADMIN_OTHER", eligibleCount: 1, required: 1 });
    assert.deepEqual(pilihAturan({ pengajuId: 2, pengajuRole: "ADMIN", anggota: A([1, "OWNER"], [2, "ADMIN"]) }), { rule: "ADMIN_OTHER", eligibleCount: 1, required: 1 });
  });
  it("admin tunggal: QUORUM_20 atas semua anggota lain", () => {
    const anggota = (n) => [{ userId: 1, role: "OWNER" }, ...Array.from({ length: n }, (_, i) => ({ userId: i + 2, role: "MEMBER" }))];
    for (const [n, k] of [[1, 1], [2, 1], [5, 1], [6, 2], [25, 5], [40, 5]]) {
      assert.deepEqual(pilihAturan({ pengajuId: 1, pengajuRole: "OWNER", anggota: anggota(n) }), { rule: "QUORUM_20", eligibleCount: n, required: k }, "n = " + n);
    }
  });
  it("peran pengaju diambil dari argumen, bukan dari daftar", () => {
    const anggota = A([1, "MEMBER"], [2, "OWNER"]);
    assert.equal(pilihAturan({ pengajuId: 1, pengajuRole: "MEMBER", anggota }).rule, "ADMIN_ANY");
    assert.equal(pilihAturan({ pengajuId: 1, pengajuRole: "ADMIN", anggota }).rule, "ADMIN_OTHER");
  });
});

describe("tentukanKeputusan dan bolehMemilih", () => {
  it("ADMIN_ANY dan ADMIN_OTHER: satu suara langsung memutuskan", () => {
    for (const rule of ["ADMIN_ANY", "ADMIN_OTHER"]) {
      assert.equal(tentukanKeputusan({ rule, required: 1, eligibleCount: 3, approve: 1, reject: 0 }), "APPROVED");
      assert.equal(tentukanKeputusan({ rule, required: 1, eligibleCount: 3, approve: 0, reject: 1 }), "REJECTED");
      assert.equal(tentukanKeputusan({ rule, required: 1, eligibleCount: 3, approve: 0, reject: 0 }), null);
      assert.equal(penentuTunggal(rule), true);
    }
  });
  it("QUORUM_20: disetujui tepat saat suara setuju mencapai required", () => {
    const k = (approve, reject) => tentukanKeputusan({ rule: "QUORUM_20", required: 2, eligibleCount: 6, approve, reject });
    assert.equal(k(0, 0), null);
    assert.equal(k(1, 0), null);
    assert.equal(k(2, 0), "APPROVED");
    assert.equal(k(3, 1), "APPROVED");
  });
  it("QUORUM_20: ditolak tepat saat persetujuan mustahil lagi (tolak lebih dari eligible dikurangi required)", () => {
    const k = (reject) => tentukanKeputusan({ rule: "QUORUM_20", required: 2, eligibleCount: 6, approve: 0, reject });
    assert.equal(k(3), null);
    assert.equal(k(4), null);
    assert.equal(k(5), "REJECTED");
  });
  it("QUORUM_20 untuk n kecil: n = 1 satu penolakan cukup; n = 2 butuh dua penolakan", () => {
    assert.equal(tentukanKeputusan({ rule: "QUORUM_20", required: 1, eligibleCount: 1, approve: 0, reject: 1 }), "REJECTED");
    assert.equal(tentukanKeputusan({ rule: "QUORUM_20", required: 1, eligibleCount: 2, approve: 0, reject: 1 }), null);
    assert.equal(tentukanKeputusan({ rule: "QUORUM_20", required: 1, eligibleCount: 2, approve: 0, reject: 2 }), "REJECTED");
  });
  it("untuk semua n sampai 49: batas penolakan tepat di n - required + 1 (acak berbenih tidak diperlukan, semua n dicoba)", () => {
    for (let n = 1; n <= 49; n++) {
      const required = kuorumDibutuhkan(n);
      const k = (reject) => tentukanKeputusan({ rule: "QUORUM_20", required, eligibleCount: n, approve: 0, reject });
      assert.equal(k(n - required), null, "n = " + n);
      assert.equal(k(n - required + 1), "REJECTED", "n = " + n);
    }
  });
  it("hak memilih: ADMIN_* hanya OWNER dan ADMIN; QUORUM_20 dan MAJORITY semua anggota", () => {
    for (const rule of ["ADMIN_ANY", "ADMIN_OTHER"]) {
      assert.equal(bolehMemilih({ rule, role: "OWNER" }), true);
      assert.equal(bolehMemilih({ rule, role: "ADMIN" }), true);
      assert.equal(bolehMemilih({ rule, role: "MEMBER" }), false);
    }
    for (const rule of ["QUORUM_20", "MAJORITY"]) assert.equal(bolehMemilih({ rule, role: "MEMBER" }), true);
    assert.equal(penentuTunggal("QUORUM_20"), false);
  });
});
