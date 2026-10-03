import * as groupService from "../services/group.service.js";
import { HttpError } from "../utils/httpError.js";

export async function create(req, res) {
  const group = await groupService.createGroup(req.user.id, req.body);
  res.status(201).json({ group });
}

export async function join(req, res) {
  const group = await groupService.joinGroup(req.user.id, req.body);
  res.json({ group });
}

export async function list(req, res) {
  const groups = await groupService.listMyGroups(req.user.id);
  res.json({ groups });
}

export async function detail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "invalid-id", "ID grup tidak valid");
  }
  const group = await groupService.getGroup(req.user.id, id);
  res.json({ group });
}
