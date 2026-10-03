import { Router } from "express";
import * as ledgerController from "../controllers/ledger.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, ledgerController.balances);

export default router;
