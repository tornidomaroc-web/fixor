// ASSUMED-PATH: src/routes/admin/orders.ts

import { Router, Request, Response } from "express";
import { dataSource } from "../../db/datasource";
import { Order } from "../../entities/Order";
import { requireAdmin } from "../../middleware/admin";

// All routes in this file are admin-only. `requireAdmin` verifies the
// caller's role from the DB-backed `user_roles` table on every request
// and rejects with 403 if the user is not an admin. Admins are
// intentionally allowed to inspect or refund any order across all
// tenants for support and fraud-review purposes.

const router = Router();

router.use(requireAdmin);

router.get("/:id", async (req: Request, res: Response) => {
  const orderRepo = dataSource.getRepository(Order);
  const order = await orderRepo.findOne({
    where: { id: req.params.id },
    relations: ["items", "shippingAddress", "customer"],
  });

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  return res.json(order);
});

router.post("/:id/refund", async (req: Request, res: Response) => {
  const orderRepo = dataSource.getRepository(Order);
  const order = await orderRepo.findOne({
    where: { id: req.params.id },
  });

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  order.status = "refunded";
  order.refundedAt = new Date();
  await orderRepo.save(order);

  return res.json(order);
});

export default router;
