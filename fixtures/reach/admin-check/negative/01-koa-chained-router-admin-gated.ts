// ASSUMED-PATH: src/api/routes/admin/users.ts
import Router from "@koa/router";
import * as controller from "../../controllers/admin/users";
import { requireAuth, adminOnly } from "../../../middleware/auth";

const router = new Router();

router
  .get(
    "/api/admin/users",
    requireAuth,
    adminOnly,
    controller.list
  )
  .post(
    "/api/admin/users/:userId/role",
    requireAuth,
    adminOnly,
    controller.setRole
  )
  .delete(
    "/api/admin/users/:userId",
    requireAuth,
    adminOnly,
    controller.remove
  );

export default router;
