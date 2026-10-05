import { prisma } from "../repos/db";

// Depth from the handler: deleteUser(0) -> userService.remove(1) -> removeDeep(2) -> deeper(3) -> deepest(4).
export function removeDeep(id: string) {
  return deeper(id);
}
function deeper(id: string) {
  return deepest(id);
}
function deepest(id: string) {
  return prisma.user.delete({ where: { id } });
}
