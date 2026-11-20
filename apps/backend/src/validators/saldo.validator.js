import { z } from "zod";
import { idSkema } from "./common.js";

// :userId boleh "fund" (Dana Kelompok, kontrak 10.2); layanan menjawab 400 "belum didukung".
export const rincianParams = z.object({ groupId: idSkema, userId: z.union([idSkema, z.literal("fund")]) });
