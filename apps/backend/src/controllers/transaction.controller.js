import * as transactionService from "../services/transaction.service.js";
import { HttpError } from "../utils/httpError.js";

function parseGroupId(req) {
  const id = Number(req.params.groupId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "invalid-id", "ID grup tidak valid");
  }
  return id;
}

export async function create(req, res) {
  const transaction = await transactionService.createTransaction(req.user.id, parseGroupId(req), req.body);
  res.status(201).json({ transaction });
}

export async function list(req, res) {
  const transactions = await transactionService.listTransactions(req.user.id, parseGroupId(req));
  res.json({ transactions });
}
