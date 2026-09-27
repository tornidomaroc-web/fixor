// ASSUMED-PATH: packages/worker/src/api/routes/global/groups.ts
import Router from "@koa/router";
import * as controller from "../../controllers/global/groups";
import { requireAuth, adminOnly } from "../../../middleware/auth";

const router = new Router();

router
  .post(
    "/api/global/groups",
    requireAuth,
    adminOnly,
    controller.save
  )
  .get(
    "/api/global/groups",
    requireAuth,
    controller.fetch
  )
  .delete(
    "/api/global/groups/:groupId",
    requireAuth,
    adminOnly,
    controller.destroy
  )
  .get(
    "/api/global/groups/:groupId/users",
    requireAuth,
    controller.fetchUsers
  );

export default router;
