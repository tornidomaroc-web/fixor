// ASSUMED-PATH: src/routes/orders.ts
import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/orders/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).single();
  if (error) {
    res.status(404).json({ error: error.message });
    return;
  }
  res.json(data);
});

export default router;
