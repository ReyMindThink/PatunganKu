import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

const BCRYPT_COST = 10;
const DUMMY_HASH = bcrypt.hashSync("password-palsu", BCRYPT_COST);

function toPublicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id) }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

export async function register({ email, password, name, phone }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(409, "email-taken", "Email sudah terdaftar");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, name, phone },
    });
    return { user: toPublicUser(user), token: signToken(user) };
  } catch (err) {
    if (err?.code === "P2002") {
      throw new HttpError(409, "email-taken", "Email sudah terdaftar");
    }
    throw err;
  }
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !valid) {
    throw new HttpError(401, "invalid-credentials", "Email atau password salah");
  }
  return { user: toPublicUser(user), token: signToken(user) };
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new HttpError(404, "user-not-found", "User tidak ditemukan");
  }
  return toPublicUser(user);
}
