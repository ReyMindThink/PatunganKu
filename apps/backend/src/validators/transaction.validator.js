import { z } from "zod";

const id = z.number().int().positive();

const base = {
  description: z.string().trim().min(1, "Deskripsi wajib diisi").max(200),
  amount: z.number().int("Nominal harus bilangan bulat").positive("Nominal harus lebih dari 0"),
  payerId: id.optional(),
};

const equal = z.object({
  ...base,
  mode: z.literal("EQUAL"),
  participantIds: z.array(id).min(1, "Minimal 1 peserta"),
});

const custom = z.object({
  ...base,
  mode: z.literal("CUSTOM"),
  splits: z
    .array(z.object({ userId: id, amount: z.number().int().positive("Nominal split harus lebih dari 0") }))
    .min(1, "Minimal 1 peserta"),
});

export const createTransactionSchema = z
  .discriminatedUnion("mode", [equal, custom])
  .superRefine((data, ctx) => {
    const ids = data.mode === "EQUAL" ? data.participantIds : data.splits.map((s) => s.userId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Peserta tidak boleh ganda", path: ["participants"] });
    }
    if (data.mode === "EQUAL" && data.amount < ids.length) {
      ctx.addIssue({ code: "custom", message: "Nominal lebih kecil dari jumlah peserta", path: ["amount"] });
    }
    if (data.mode === "CUSTOM") {
      const total = data.splits.reduce((s, x) => s + x.amount, 0);
      if (total !== data.amount) {
        ctx.addIssue({ code: "custom", message: "Total split harus sama dengan nominal", path: ["splits"] });
      }
    }
  });
