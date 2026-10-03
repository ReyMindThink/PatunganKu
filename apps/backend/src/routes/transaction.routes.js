import { Router } from "express";
import * as transactionController from "../controllers/transaction.controller.js";
import { validate } from "../middlewares/validate.js";
import { requireAuth } from "../middlewares/auth.js";
import { createTransactionSchema } from "../validators/transaction.validator.js";

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.post("/", validate(createTransactionSchema), transactionController.create);
router.get("/", transactionController.list);

export default router;
