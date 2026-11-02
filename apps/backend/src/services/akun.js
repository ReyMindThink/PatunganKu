// Layanan akun (api-contract 14, K43 sampai K45): daftar, masuk, profil, ganti password.
// Pabrik murni: db, rahasia JWT, dan fungsi hash disuntik, jadi tes unit tidak butuh
// env.js maupun prisma.js. Penulisan data dan catatan AuditLog selalu dalam satu transaksi.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { HttpError } from "../utils/httpError.js";
import { catatAudit } from "../utils/audit.js";

const PASSWORD_PALSU = "password-palsu-untuk-waktu-konstan";
const PILIH_PUBLIK = { id: true, email: true, name: true, notifyByEmail: true, createdAt: true };
const PILIH_LOGIN = { ...PILIH_PUBLIK, passwordHash: true };

const publik = (u) => ({ id: u.id, email: u.email, name: u.name, notifyByEmail: u.notifyByEmail, createdAt: u.createdAt });
const tidakSah = () => new HttpError(401, "unauthorized", "Sesi tidak valid. Silakan masuk kembali.");

export function buatLayananAkun({ db, jwtSecret, jwtExpiresIn, biayaBcrypt = 10, hash = bcrypt.hash, bandingkan = bcrypt.compare }) {
  // Hash palsu dibuat sekali di awal: login dengan email tak dikenal tetap menjalankan satu
  // perbandingan bcrypt, sehingga waktu responsnya tidak membedakan email terdaftar (K43).
  const hashPalsu = Promise.resolve(hash(PASSWORD_PALSU, biayaBcrypt));
  hashPalsu.catch(() => {});

  function terbitkanToken(userId) {
    const accessToken = jwt.sign({ sub: String(userId) }, jwtSecret, { algorithm: "HS256", expiresIn: jwtExpiresIn });
    const { iat, exp } = jwt.decode(accessToken);
    return { accessToken, refreshToken: null, refreshMode: "NONE", expiresIn: exp - iat };
  }

  const emailTerpakai = () => new HttpError(409, "email-taken", "Email sudah terdaftar.");

  async function daftar({ email, password, name }, { ip } = {}) {
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw emailTerpakai();
    const passwordHash = await hash(password, biayaBcrypt);
    try {
      const user = await db.$transaction(async (tx) => {
        const baru = await tx.user.create({ data: { email, passwordHash, name }, select: PILIH_PUBLIK });
        await catatAudit(tx, { groupId: null, actorId: baru.id, entity: "User", entityId: baru.id, action: "REGISTER", newValue: { ip: ip ?? null } });
        return baru;
      });
      return { user: publik(user), ...terbitkanToken(user.id) };
    } catch (galat) {
      // Pendaftar lain menang balapan: dikenali dengan membaca ulang, bukan dari kode galat.
      if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw emailTerpakai();
      throw galat;
    }
  }

  async function masuk({ email, password }) {
    const user = await db.user.findUnique({ where: { email }, select: PILIH_LOGIN });
    const cocok = await bandingkan(password, user === null ? await hashPalsu : user.passwordHash);
    if (user === null || cocok === false) {
      throw new HttpError(401, "invalid-credentials", "Email atau password salah.");
    }
    return { user: publik(user), ...terbitkanToken(user.id) };
  }

  async function profil(userId) {
    const user = await db.user.findUnique({ where: { id: userId }, select: PILIH_PUBLIK });
    if (user === null) throw tidakSah();
    return publik(user);
  }

  async function ubahProfil(userId, { name }, { ip } = {}) {
    return db.$transaction(async (tx) => {
      const lama = await tx.user.findUnique({ where: { id: userId }, select: PILIH_PUBLIK });
      if (lama === null) throw tidakSah();
      if (lama.name === name) return publik(lama);
      const baru = await tx.user.update({ where: { id: userId }, data: { name }, select: PILIH_PUBLIK });
      await catatAudit(tx, { groupId: null, actorId: userId, entity: "User", entityId: userId, action: "PROFILE_UPDATE", oldValue: { name: lama.name }, newValue: { name, ip: ip ?? null } });
      return publik(baru);
    });
  }

  async function gantiPassword(userId, { currentPassword, newPassword }, { ip } = {}) {
    const user = await db.user.findUnique({ where: { id: userId }, select: PILIH_LOGIN });
    if (user === null) throw tidakSah();
    if ((await bandingkan(currentPassword, user.passwordHash)) === false) {
      throw new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [{ field: "currentPassword", message: "Password saat ini salah" }]);
    }
    const passwordHash = await hash(newPassword, biayaBcrypt);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await catatAudit(tx, { groupId: null, actorId: userId, entity: "User", entityId: userId, action: "PASSWORD_CHANGE", newValue: { ip: ip ?? null } });
    });
    return terbitkanToken(userId);
  }

  return { daftar, masuk, profil, ubahProfil, gantiPassword };
}
