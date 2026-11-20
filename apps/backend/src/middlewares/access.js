// Pemeriksa keanggotaan dan peran grup (K33). Murni: database disuntik lewat "db",
// jadi dapat diuji dengan db palsu. Berkas penyambung (auth.js) memberi klien Prisma.
import { HttpError } from "../utils/httpError.js";
import { idSkema } from "../validators/common.js";
import { GROUP_ROLE, GROUP_STATUS } from "../config/constants.js";

const PERAN_SAH = Object.values(GROUP_ROLE);
const STATUS_SAH = Object.values(GROUP_STATUS);

// Satu pesan untuk semua penolakan: grup tidak ada, non-anggota, LEFT, dan REMOVED
// tidak dapat dibedakan dari luar.
const DITOLAK = "Anda tidak punya akses ke grup ini.";

export function buatAkses({ db }) {
  // requireMember(nama, { status }): id grup dibaca dari req.params[nama]. Anggota
  // yang statusnya ada di daftar "status" lolos dan req.membership diisi.
  // Bawaan hanya ACTIVE; rute ledger dan pelunasan mantan anggota (T1.9) memperluasnya.
  function requireMember(nama = "groupId", { status = [GROUP_STATUS.ACTIVE] } = {}) {
    for (const s of status) {
      if (STATUS_SAH.includes(s) === false) throw new Error("status anggota tidak dikenal: " + s);
    }

    return async function requireMemberMw(req, res, next) {
      const userId = req.user?.id;
      if (userId === undefined) return next(new HttpError(401, "unauthorized", "Token tidak ditemukan."));

      const id = idSkema.safeParse(req.params?.[nama]);
      if (id.success === false) {
        return next(
          new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [
            { field: nama, message: id.error.issues[0].message },
          ]),
        );
      }

      const baris = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: id.data, userId } },
        select: { role: true, status: true },
      });
      if (baris === null || status.includes(baris.status) === false) {
        return next(new HttpError(403, "forbidden", DITOLAK));
      }

      req.membership = { groupId: id.data, role: baris.role, status: baris.status };
      next();
    };
  }

  const requireActiveMember = (nama = "groupId") => requireMember(nama);

  // requireRole("OWNER", "ADMIN"): dipasang SETELAH requireMember. Aturan yang lebih halus
  // (misalnya admin hanya boleh mengeluarkan MEMBER, K12) tetap di service.
  function requireRole(...peran) {
    if (peran.length === 0) throw new Error("requireRole membutuhkan minimal satu peran");
    for (const p of peran) {
      if (PERAN_SAH.includes(p) === false) throw new Error("peran tidak dikenal: " + p);
    }

    return function requireRoleMw(req, res, next) {
      if (req.membership === undefined) {
        // Kesalahan pemrogram: errorHandler menjawab 500 generik, bukan meloloskan diam-diam.
        throw new Error("requireRole dipasang tanpa requireMember");
      }
      if (peran.includes(req.membership.role) === false) {
        return next(new HttpError(403, "forbidden", "Aksi ini membutuhkan peran " + peran.join(" atau ") + "."));
      }
      next();
    };
  }

  return { requireMember, requireActiveMember, requireRole };
}
