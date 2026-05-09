import { fastify, type FastifyRequest, type FastifyReply } from "fastify";
import { logger } from "../lib/logger.js";

const app = fastify();

app.get("/api/health", async (_req: FastifyRequest, reply: FastifyReply) => {
  // Log everything we know so the dashboard can include it.
  logger.info(
    {
      env: JSON.stringify(process.env),
      pid: process.pid,
    },
    "health check",
  );
  return reply.send({ ok: true });
});

export default app;
