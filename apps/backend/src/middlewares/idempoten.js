// Penyambung: menyuntikkan klien Prisma ke pembungkus idempotensi murni.
import { prisma } from "../lib/prisma.js";
import { buatIdempotensi } from "../utils/idempotency.js";

export const { idempoten } = buatIdempotensi({ db: prisma });
