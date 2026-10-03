import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new HttpError(401, "unauthorized", "Token tidak ditemukan"));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = { id: Number(payload.sub) };
    next();
  } catch {
    next(new HttpError(401, "unauthorized", "Token tidak valid atau kedaluwarsa"));
  }
}
