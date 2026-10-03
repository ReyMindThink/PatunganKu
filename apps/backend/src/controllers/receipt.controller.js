import * as receiptService from "../services/receipt.service.js";
import { HttpError } from "../utils/httpError.js";

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "invalid-id", `ID ${label} tidak valid`);
  }
  return id;
}

export async function upload(req, res) {
  const transaction = await receiptService.attachReceipt(
    req.user.id,
    parseId(req.params.groupId, "grup"),
    parseId(req.params.transactionId, "transaksi"),
    req.file,
  );
  res.json({ transaction });
}

export async function verify(req, res) {
  const result = await receiptService.verifyTransactionReceipt(
    req.user.id,
    parseId(req.params.groupId, "grup"),
    parseId(req.params.transactionId, "transaksi"),
  );
  res.json(result);
}
