import { prisma } from "./db";

export const userRepo = {
  findAll: () => prisma.user.findMany(),
};
