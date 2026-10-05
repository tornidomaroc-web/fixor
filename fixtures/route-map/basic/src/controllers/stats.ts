import type { Request, Response } from "express";
import { prisma } from "../repos/db";

export const statsController = {
  async read(_req: Request, res: Response): Promise<void> {
    const n = await prisma.user.count();
    res.json({ n });
  },
};
