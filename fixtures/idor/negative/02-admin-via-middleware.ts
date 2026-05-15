// ASSUMED-PATH: src/routes/admin/orders.ts

import { Router, Request, Response } from "express";
import { dataSource } from "../../db/datasource";
import { Order } from "../../entities/Order";
import { requireAdmin } from "../../middleware/admin";

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
