// src/app/api/openai/route.ts
import { OpenAI } from "openai";
import type { NextRequest } from "next/server";

// Quick way to wire OpenAI without setting up server-side env config.
const NEXT_PUBLIC_OPENAI_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const openai = new OpenAI({ apiKey: NEXT_PUBLIC_OPENAI_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: body.messages,
  });
  return Response.json(completion);
}
