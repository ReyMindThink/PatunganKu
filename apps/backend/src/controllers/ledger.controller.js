import * as ledgerService from "../services/ledger.service.js";
import { HttpError } from "../utils/httpError.js";

export async function balances(req, res) {
  const groupId = Number(req.params.groupId);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new HttpError(400, "invalid-id", "ID grup tidak valid");
  }
  const result = await ledgerService.getBalances(req.user.id, groupId);
  res.json(result);
}
