import { z } from "zod";

export const createPaymentSchema = z.object({
  receiverId: z.number().int().positive(),
  amount: z.number().int("Nominal harus bilangan bulat").positive("Nominal harus lebih dari 0"),
});

export const decidePaymentSchema = z.object({
  decision: z.enum(["CONFIRMED", "REJECTED"], { message: "decision harus CONFIRMED atau REJECTED" }),
});
