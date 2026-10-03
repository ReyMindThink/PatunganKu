import { RECEIPT_STATUS } from "../config/constants.js";

export const MIN_CONFIDENCE = 0.6;

export function decideReceipt(result, amount) {
  if (!result.isReceipt) {
    return { status: RECEIPT_STATUS.REJECTED, reason: "not-a-receipt" };
  }
  if (result.confidence < MIN_CONFIDENCE) {
    return { status: RECEIPT_STATUS.REJECTED, reason: "low-confidence" };
  }
  if (result.total === null) {
    return { status: RECEIPT_STATUS.REJECTED, reason: "total-unreadable" };
  }
  if (result.total !== amount) {
    return { status: RECEIPT_STATUS.REJECTED, reason: "total-mismatch" };
  }
  return { status: RECEIPT_STATUS.VERIFIED, reason: "ok" };
}
