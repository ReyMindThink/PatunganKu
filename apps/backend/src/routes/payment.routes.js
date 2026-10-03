import { Router } from "express";
import * as paymentController from "../controllers/payment.controller.js";
import { validate } from "../middlewares/validate.js";
import { requireAuth } from "../middlewares/auth.js";
import { createPaymentSchema, decidePaymentSchema } from "../validators/payment.validator.js";

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.post("/", validate(createPaymentSchema), paymentController.create);
router.get("/", paymentController.list);
router.patch("/:paymentId", validate(decidePaymentSchema), paymentController.decide);

export default router;
