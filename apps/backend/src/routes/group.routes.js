import { Router } from "express";
import * as groupController from "../controllers/group.controller.js";
import { validate } from "../middlewares/validate.js";
import { requireAuth } from "../middlewares/auth.js";
import { createGroupSchema, joinGroupSchema } from "../validators/group.validator.js";

const router = Router();

router.use(requireAuth);

router.post("/", validate(createGroupSchema), groupController.create);
router.post("/join", validate(joinGroupSchema), groupController.join);
router.get("/", groupController.list);
router.get("/:id", groupController.detail);

export default router;
