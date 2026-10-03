import { verifyWithGemini } from "./gemini.js";

const providers = { gemini: verifyWithGemini };

export function verifyReceipt(buffer, mimeType) {
  const name = process.env.RECEIPT_VERIFIER || "gemini";
  const fn = providers[name];
  if (!fn) throw new Error(`RECEIPT_VERIFIER tidak dikenal: ${name}`);
  return fn(buffer, mimeType);
}
