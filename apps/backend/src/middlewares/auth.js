// Penyambung: menyuntikkan konfigurasi dan database asli ke pemeriksa murni.
// Hanya berkas ini yang mengimpor env.js dan prisma.js; tes unit mengimpor
// requireAuth.js dan access.js langsung.
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { buatRequireAuth } from "./requireAuth.js";
import { buatAkses } from "./access.js";

export const requireAuth = buatRequireAuth({ secret: () => env.jwtSecret });
export const { requireMember, requireActiveMember, requireRole } = buatAkses({ db: prisma });
