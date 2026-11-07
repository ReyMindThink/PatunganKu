// Aturan persetujuan transaksi (architecture 7.2, T1.8). Murni: tanpa database. Pemilih adalah
// anggota ACTIVE selain pengaju. Jalur minimum hanya melayani struk gagal AI atau perlu tinjau:
// pengaju MEMBER: ADMIN_ANY; pengaju admin dan ada admin lain: ADMIN_OTHER; admin tunggal:
// QUORUM_20; tanpa pemilih sama sekali: tanpa Approval (null).
import { APPROVAL, GROUP_ROLE } from "../config/constants.js";

const adalahAdmin = (role) => role === GROUP_ROLE.OWNER || role === GROUP_ROLE.ADMIN;

// Kuorum 20 persen dari n pemilih, dibulatkan ke atas, dibatasi 1 sampai 5 (K7: bilangan bulat).
export function kuorumDibutuhkan(n) {
  if (Number.isInteger(n) === false || n < 1) throw new Error("kuorumDibutuhkan: n harus bilangan bulat positif");
  return Math.min(APPROVAL.KUORUM_MAKS, Math.ceil(n / APPROVAL.KUORUM_PEMBAGI));
}

// anggota: semua anggota ACTIVE grup, termasuk pengaju ([{ userId, role }]).
// Mengembalikan { rule, eligibleCount, required } atau null bila tidak ada pemilih.
export function pilihAturan({ pengajuId, pengajuRole, anggota }) {
  const lain = anggota.filter((a) => (a.userId === pengajuId) === false);
  if (lain.length === 0) return null;
  const adminLain = lain.filter((a) => adalahAdmin(a.role));
  if (adalahAdmin(pengajuRole) === false) {
    if (adminLain.length === 0) throw new Error("pilihAturan: grup tanpa admin aktif selain pengaju");
    return { rule: APPROVAL.RULE.ADMIN_ANY, eligibleCount: adminLain.length, required: 1 };
  }
  if (adminLain.length > 0) return { rule: APPROVAL.RULE.ADMIN_OTHER, eligibleCount: adminLain.length, required: 1 };
  return { rule: APPROVAL.RULE.QUORUM_20, eligibleCount: lain.length, required: kuorumDibutuhkan(lain.length) };
}

// Aturan ADMIN_*: satu suara langsung memutuskan.
export const penentuTunggal = (rule) => APPROVAL.RULE_ADMIN.includes(rule);

// Hak memilih menurut rule (matriks 7.4). Syarat lain (anggota ACTIVE, bukan pengaju, belum
// memilih) diperiksa pemanggil.
export const bolehMemilih = ({ rule, role }) => (penentuTunggal(rule) ? adalahAdmin(role) : true);

// Hasil setelah suara terakhir dihitung: "APPROVED", "REJECTED", atau null (masih terbuka).
// QUORUM_20 dan MAJORITY: disetujui bila suara setuju mencapai required; ditolak bila
// persetujuan mustahil tercapai lagi (suara tolak lebih besar dari eligibleCount - required).
export function tentukanKeputusan({ rule, required, eligibleCount, approve, reject }) {
  if (penentuTunggal(rule)) {
    if (approve >= 1) return "APPROVED";
    if (reject >= 1) return "REJECTED";
    return null;
  }
  if (approve >= required) return "APPROVED";
  if (reject > eligibleCount - required) return "REJECTED";
  return null;
}
