// ASSUMED-PATH: src/app/handlers/env-exposure/03-fastify-redacted-logs.ts
import { fastify } from "fastify";

const SECRET_KEYS = new Set([
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "JWT_SECRET",
]);

function redactedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    out[k] = SECRET_KEYS.has(k) ? "[redacted]" : (v ?? "");
  }
  return out;
}

const app = fastify({
  logger: {
    redact: [
      "env.DATABASE_URL",
      "env.STRIPE_SECRET_KEY",
      "env.ANTHROPIC_API_KEY",
      "env.JWT_SECRET",
    ],
  },
});

app.get("/api/health", async () => {
  return { ok: true, env: redactedEnv() };
});

export default app;
