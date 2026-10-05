import { Router } from "express";
import { audit, requireRole } from "../auth";
import { deleteUser, listUsers } from "../controllers/users";

const router = Router();
router.use(audit);
router.get("/", listUsers);
router.delete("/:id", requireRole("admin"), deleteUser);

export { router as usersRouter };
