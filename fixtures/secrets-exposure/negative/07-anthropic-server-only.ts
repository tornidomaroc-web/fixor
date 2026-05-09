// ASSUMED-PATH: src/app/handlers/secrets-exposure/07-anthropic-server-only.ts
// src/lib/server/anthropic.ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY required at boot");
}

export const claude = new Anthropic({ apiKey });

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
