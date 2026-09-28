// ASSUMED-PATH: src/routes/admin.ts
import type { FastifyInstance } from "fastify";
import { accounts } from "../services/accounts";

export async function adminRoutes(server: FastifyInstance) {
  server.get("/admin/accounts", { preHandler: [server.authenticate, server.requireAdmin] }, async () => {
    return accounts.listAll();
  });

  server.post("/admin/accounts/:id/tier", { preHandler: [server.authenticate, server.requireAdmin] }, async (request) => {
    const { id } = request.params as { id: string };
    const { tier } = request.body as { tier: string };
    await accounts.setTier(id, tier);
    return { ok: true };
  });

  server.delete("/admin/accounts/:id", { preHandler: [server.authenticate, server.requireAdmin] }, async (request) => {
    const { id } = request.params as { id: string };
    await accounts.remove(id);
    return { ok: true };
  });
}
