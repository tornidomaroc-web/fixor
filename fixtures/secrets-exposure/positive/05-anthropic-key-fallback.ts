// ASSUMED-PATH: src/app/handlers/secrets-exposure/05-anthropic-key-fallback.ts
// src/services/claude.ts
import Anthropic from "@anthropic-ai/sdk";

// Falls back to the founder's personal key when env not set.
const ANTHROPIC_KEY =
  process.env.ANTHROPIC_API_KEY ??
  "sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkLmNoPqRsTuVwXyZ-AbCdEfGhI";

export const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

export async function summarize(text: string): Promise<string> {
  const r = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: `Summarize:\n${text}` }],
  });
  return r.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}
