import * as paymentService from "../services/payment.service.js";
import { HttpError } from "../utils/httpError.js";

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "invalid-id", `ID ${label} tidak valid`);
  }
  return id;
}

export async function create(req, res) {
  const payment = await paymentService.createPayment(req.user.id, parseId(req.params.groupId, "grup"), req.body);
  res.status(201).json({ payment });
}

export async function decide(req, res) {
  const payment = await paymentService.decidePayment(
    req.user.id,
    parseId(req.params.groupId, "grup"),
    parseId(req.params.paymentId, "pelunasan"),
    req.body.decision,
  );
  res.json({ payment });
}

export async function list(req, res) {
  const payments = await paymentService.listPayments(req.user.id, parseId(req.params.groupId, "grup"));
  res.json({ payments });
}
