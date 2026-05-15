// ASSUMED-PATH: src/routes/orders.ts

import { Router, Request, Response } from "express";
import { dataSource } from "../db/datasource";
import { Order } from "../entities/Order";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/:id", async (req: Request, res: Response) => {
  const orderRepo = dataSource.getRepository(Order);
  const order = await orderRepo.findOne({
    where: { id: req.params.id },
    relations: ["items", "shippingAddress"],
  });

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  return res.json(order);
});

router.patch("/:id/cancel", async (req: Request, res: Response) => {
  const orderRepo = dataSource.getRepository(Order);
  const order = await orderRepo.findOne({
    where: { id: req.params.id },
  });

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  if (order.status === "shipped") {
    return res.status(409).json({ error: "Cannot cancel a shipped order" });
  }

  order.status = "cancelled";
  order.cancelledAt = new Date();
  await orderRepo.save(order);

  return res.json(order);
});

export default router;
