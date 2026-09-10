// ASSUMED-PATH: src/app/handlers/secrets-exposure/16-openai-project-key-hardcoded.ts
// src/services/openai.ts
import OpenAI from "openai";

// Project key pasted inline for the demo; the env lookup was never wired.
const OPENAI_KEY =
  process.env.OPENAI_API_KEY ??
  "sk-proj-FAKEfixtureNOTrealFAKEfixtureNOTreal0000T3BlbkFJFAKEfixtureNOTrealFAKEfixtureNOTreal0000";

export const openai = new OpenAI({ apiKey: OPENAI_KEY });
