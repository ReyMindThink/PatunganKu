import { z } from "zod";
import { APPROVAL } from "../config/constants.js";
import { kursorSkema, limitSkema } from "./common.js";

export const suaraSchema = z.object({ vote: z.enum(APPROVAL.SUARA) }).strict();

// Isi kursor daftar Approval: posisi baris terakhir (createdAt ISO dan id), terbaru lebih dulu.
export const kursorApprovalSkema = z.object({
  t: z.string().refine((s) => Number.isNaN(Date.parse(s)) === false),
  id: z.number().int().positive(),
});

export const daftarApprovalQuery = z.object({
  limit: limitSkema,
  cursor: kursorSkema,
  status: z.enum(APPROVAL.STATUS).optional(),
  mine: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
