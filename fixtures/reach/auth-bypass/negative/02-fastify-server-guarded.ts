// ASSUMED-PATH: src/routes/documents.ts
import type { FastifyInstance } from "fastify";
import { documents } from "../services/documents";

export async function documentRoutes(server: FastifyInstance) {
  server.get("/documents", { preHandler: [server.authenticate] }, async (request) => {
    return documents.listForUser(request.user.id);
  });

  server.post("/documents", { preHandler: [server.authenticate] }, async (request) => {
    return documents.create(request.user.id, request.body);
  });

  server.delete("/documents/:id", { preHandler: [server.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    await documents.removeOwned(id, request.user.id);
    return { ok: true };
  });
}
