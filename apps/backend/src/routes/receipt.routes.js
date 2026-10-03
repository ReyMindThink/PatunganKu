import { Router } from "express";
import * as receiptController from "../controllers/receipt.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { uploadReceiptFile } from "../middlewares/upload.js";

const router = Router({ mergeParams: true });

router.post("/:transactionId/receipt", requireAuth, uploadReceiptFile, receiptController.upload);

router.post("/:transactionId/receipt/verify", requireAuth, receiptController.verify);

export default router;
