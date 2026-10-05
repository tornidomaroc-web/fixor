import { Router } from "express";
import { statsController } from "../controllers/stats";

const router = Router();
router.get("/stats", statsController.read);

export default router;
