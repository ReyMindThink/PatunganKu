// Layanan grup (api-contract 11.1 sampai 11.3, K32, K33). Pabrik murni: db disuntik.
// Fungsi tulis menerima tx (klien transaksi dari pembungkus idempotensi) sehingga
// Group, GroupMember, dan AuditLog selalu ter-commit atau batal bersama.
import { GRUP } from "../config/constants.js";
import { HttpError } from "../utils/httpError.js";
import { catatAudit } from "../utils/audit.js";
import { buatKodeGrup } from "../utils/kodeGrup.js";

const PILIH_GRUP = { id: true, name: true, code: true, createdAt: true };

// codeHidden dan joinRequiresApproval: kolomnya baru ada di Tahap 2, sementara selalu false.
const objekGrup = (g, role, status, jumlah) => ({
  id: g.id,
  name: g.name,
  code: g.code,
  codeHidden: false,
  joinRequiresApproval: false,
  myRole: role,
  membership: status,
  memberCount: jumlah,
  memberLimit: GRUP.BATAS_ANGGOTA,
  createdAt: g.createdAt,
});

export function buatLayananGrup({ db, kode = buatKodeGrup }) {
  // Tabrakan kode dikenali dengan membaca ulang. Dua pembuat yang memilih kode sama persis
  // pada saat yang sama (peluang sekitar 1 banding satu miliar) gagal di constraint unik.
  async function kodeBebas(tx) {
    for (let i = 0; i < GRUP.PERCOBAAN_KODE_MAKS; i++) {
      const calon = kode();
      if ((await tx.group.findUnique({ where: { code: calon }, select: { id: true } })) === null) return calon;
    }
    throw new Error("Tidak dapat membuat kode grup yang unik");
  }

  async function buat(tx, userId, { name }) {
    const grup = await tx.group.create({ data: { name, code: await kodeBebas(tx), createdBy: userId }, select: PILIH_GRUP });
    await tx.groupMember.create({ data: { groupId: grup.id, userId, role: "OWNER", status: "ACTIVE" } });
    await catatAudit(tx, { groupId: grup.id, actorId: userId, entity: "Group", entityId: grup.id, action: "GROUP_CREATE", newValue: { name } });
    return objekGrup(grup, "OWNER", "ACTIVE", 1);
  }

  async function daftarSaya(userId) {
    const baris = await db.groupMember.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: { groupId: "desc" },
      select: { role: true, status: true, group: { select: { id: true, name: true } } },
    });
    const ids = baris.map((b) => b.group.id);
    const aktif = ids.length === 0 ? [] : await db.groupMember.findMany({ where: { groupId: { in: ids }, status: "ACTIVE" }, select: { groupId: true } });
    const hitung = new Map();
    for (const a of aktif) hitung.set(a.groupId, (hitung.get(a.groupId) ?? 0) + 1);
    // balance menunggu ledger (T1.6); pendingJoinRequests menunggu permintaan gabung (Tahap 2).
    return baris.map((b) => ({
      id: b.group.id,
      name: b.group.name,
      membership: b.status,
      myRole: b.role,
      memberCount: hitung.get(b.group.id) ?? 0,
      balance: 0,
      pendingJoinRequests: b.role === "MEMBER" ? null : 0,
    }));
  }

  async function detail(groupId, { role, status }) {
    const grup = await db.group.findUnique({ where: { id: groupId }, select: PILIH_GRUP });
    const jumlah = await db.groupMember.count({ where: { groupId, status: "ACTIVE" } });
    return objekGrup(grup, role, status, jumlah);
  }

  async function anggota(groupId) {
    const baris = await db.groupMember.findMany({
      where: { groupId, status: "ACTIVE" },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      select: { role: true, joinedAt: true, user: { select: { id: true, name: true } } },
    });
    return baris.map((b) => ({ user: { id: b.user.id, name: b.user.name }, role: b.role, joinedAt: b.joinedAt }));
  }

  async function gabung(tx, userId, { code }) {
    const grup = await tx.group.findUnique({ where: { code }, select: { id: true, name: true } });
    if (grup === null) throw new HttpError(404, "not-found", "Kode grup tidak ditemukan.");
    // Kunci baris Group (K33): update tanpa perubahan nilai menahan penggabung lain sampai
    // transaksi ini selesai, sehingga hitungan anggota di bawah tidak bisa dilampaui.
    await tx.group.update({ where: { id: grup.id }, data: { name: grup.name } });
    const ada = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: grup.id, userId } }, select: { id: true, status: true } });
    if (ada && ada.status === "ACTIVE") throw new HttpError(409, "already-member", "Anda sudah menjadi anggota grup ini.");
    if (ada && ada.status === "REMOVED") throw new HttpError(409, "invalid-state", "Bergabung kembali membutuhkan persetujuan admin.");
    const jumlah = await tx.groupMember.count({ where: { groupId: grup.id, status: "ACTIVE" } });
    if (jumlah >= GRUP.BATAS_ANGGOTA) throw new HttpError(409, "group-full", "Grup sudah penuh (maksimal " + GRUP.BATAS_ANGGOTA + " anggota).");
    if (ada === null) {
      await tx.groupMember.create({ data: { groupId: grup.id, userId, role: "MEMBER", status: "ACTIVE" } });
    } else {
      await tx.groupMember.update({ where: { id: ada.id }, data: { status: "ACTIVE", role: "MEMBER", leftAt: null, leftReason: null } });
    }
    await catatAudit(tx, { groupId: grup.id, actorId: userId, entity: "Group", entityId: grup.id, action: "GROUP_JOIN", newValue: { rejoin: Boolean(ada) } });
    return { outcome: "JOINED", group: { id: grup.id, name: grup.name }, requestId: null };
  }

  return { buat, daftarSaya, detail, anggota, gabung };
}
