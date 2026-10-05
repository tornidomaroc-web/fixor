import type { Request, Response } from "express";
import { userService } from "../services/user-service";

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await userService.list();
  res.json(users);
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  await userService.remove(String(req.params.id));
  res.status(204).end();
}
