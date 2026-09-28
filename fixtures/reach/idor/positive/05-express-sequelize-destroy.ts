// ASSUMED-PATH: src/routes/comments.ts
import { Router } from "express";
import { Comment } from "../models";

const router = Router();

router.delete("/comments/:id", async (req, res) => {
  const id = req.params.id;
  const deleted = await Comment.destroy({ where: { id } });
  res.json({ deleted });
});

export default router;
