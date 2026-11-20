import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { objekTransaksi } from "../../src/utils/objekTransaksi.js";

const share = (userId, amount, consent = "ACCEPTED") => ({ userId, amount, consent, user: { id: userId, name: "Pengguna " + userId } });
const dasar = (ubah = {}) => ({
  id: 5, groupId: 7, description: "Makan", amount: 70000, mode: "EQUAL_ALL", status: "ACTIVE", receiptStatus: "VERIFIED",
  receiptUrl: "https://rahasia/struk.jpg", version: 1, payer: { id: 1, name: "Rey" }, expiresAt: null, createdAt: new Date(0),
  shares: [share(1, 23334), share(2, 23333), share(3, 23333)], ...ubah,
});
const anggota = (userId, role = "MEMBER") => ({ userId, role });

describe("objekTransaksi: siapa melihat daftar peserta (9.5, K23)", () => {
  it("ACTIVE: semua anggota melihat daftar lengkap dan bagian sendiri", () => {
    const o = objekTransaksi(dasar(), anggota(4), { rinci: true });
    assert.equal(o.participants.length, 3);
    assert.deepEqual(o.participants[0], { user: { id: 1, name: "Pengguna 1" }, amount: 23334, consent: "ACCEPTED" });
    assert.equal(o.myShare, null);
    assert.deepEqual(objekTransaksi(dasar(), anggota(2), { rinci: true }).myShare, { amount: 23333, consent: "ACCEPTED" });
  });

  it("belum ACTIVE: penalang dan admin/owner melihat daftar lengkap", () => {
    const t = dasar({ status: "PENDING_APPROVAL" });
    assert.equal(objekTransaksi(t, anggota(1), { rinci: true }).participants.length, 3);
    assert.equal(objekTransaksi(t, anggota(9, "ADMIN"), { rinci: true }).participants.length, 3);
    assert.equal(objekTransaksi(t, anggota(9, "OWNER"), { rinci: true }).participants.length, 3);
  });

  it("belum ACTIVE: peserta biasa hanya bagian sendiri dan jumlah; anggota lain hanya jumlah", () => {
    const t = dasar({ status: "PENDING_APPROVAL" });
    const peserta = objekTransaksi(t, anggota(2), { rinci: true });
    assert.equal(peserta.participants, null);
    assert.deepEqual(peserta.myShare, { amount: 23333, consent: "ACCEPTED" });
    assert.equal(peserta.participantCount, 3);
    const lain = objekTransaksi(t, anggota(4), { rinci: true });
    assert.equal(lain.participants, null);
    assert.equal(lain.myShare, null);
    assert.equal(lain.participantCount, 3);
  });

  it("status ditolak, kedaluwarsa, dan takedown diperlakukan sebagai belum ACTIVE (konservatif)", () => {
    for (const status of ["REJECTED", "EXPIRED", "WITHDRAWN", "TAKEN_DOWN"]) {
      assert.equal(objekTransaksi(dasar({ status }), anggota(4), { rinci: true }).participants, null, status);
    }
  });

  it("daftar (bukan rinci): participants selalu null dan jumlah memakai jumlahShare", () => {
    const o = objekTransaksi(dasar({ shares: [share(2, 23333)], jumlahShare: 3 }), anggota(1), {});
    assert.equal(o.participants, null);
    assert.equal(o.participantCount, 3);
    assert.deepEqual(o.myShare, null);
  });

  it("DRAFT: penalang melihat daftar kosong, bukan null", () => {
    const o = objekTransaksi(dasar({ status: "DRAFT", shares: [], receiptStatus: "PENDING", receiptUrl: null }), anggota(1), { rinci: true });
    assert.deepEqual(o.participants, []);
    assert.equal(o.participantCount, 0);
    assert.equal(o.hasReceipt, false);
  });

  it("bentuk objek persis sesuai kontrak dan alamat struk tidak bocor", () => {
    const o = objekTransaksi(dasar(), anggota(1), { rinci: true });
    assert.deepEqual(Object.keys(o).sort(), [
      "amount", "approval", "createdAt", "description", "expiresAt", "groupId", "hasReceipt", "id", "itemsPhase", "mode", "myShare",
      "paidFromFund", "participantCount", "participants", "payer", "receiptStatus", "status", "version",
    ]);
    assert.equal(o.hasReceipt, true);
    assert.equal(o.itemsPhase, null);
    assert.equal(o.paidFromFund, false);
    assert.equal(o.approval, null);
    assert.deepEqual(o.payer, { id: 1, name: "Rey" });
    assert.equal(JSON.stringify(o).includes("rahasia"), false);
  });
});
