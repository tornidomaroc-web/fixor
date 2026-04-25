/**
 * Centralized Anthropic SDK wrapper.
 *
 * Every Claude call in Fixor goes through this file, so the rules live in
 * one place:
 *   - API key resolution + "no key -> null result" fallback
 *   - Prompt caching on system prompts (cheap + every request is idempotent)
 *   - AbortController wiring so `Promise.race` timeouts actually cancel the
 *     underlying fetch (no leaked requests)
 *   - Tool-use helper that enforces a single expected tool + returns typed
 *     input, eliminating brittle JSON-parsing of free-form text
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import {
  ANTHROPIC_API_VERSION,
  MODEL_DEFAULTS,
  type ClaudeModelId,
} from "../config/models";

let _client: Anthropic | null = null;

/** Returns a lazily-initialized SDK client, or null if no API key is set. */
export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (_client) return _client;
  _client = new Anthropic({
    apiKey,
    defaultHeaders: { "anthropic-version": ANTHROPIC_API_VERSION },
    maxRetries: 2,
  });
  return _client;
}

/**
 * A system prompt block. We widen the SDK's TextBlockParam with an optional
 * `cache_control` field because SDK 0.32.x keeps the cache_control types in
 * the beta namespace, while the stable `messages.create` endpoint has
 * accepted `cache_control` as GA for months.
 */
export type CacheableTextBlock = TextBlockParam & {
  cache_control?: { type: "ephemeral" };
};
export type SystemBlock = string | CacheableTextBlock[];

export type MessagesCallOptions = {
  model: ClaudeModelId;
  system: SystemBlock;
  messages: MessageParam[];
  /** Forces Claude to call exactly this tool; input is returned typed. */
  tool?: Tool;
  /** Overrides MODEL_DEFAULTS[model].maxTokens. */
  maxTokens?: number;
  /** Overrides MODEL_DEFAULTS[model].temperature. */
  temperature?: number;
  /** Overrides MODEL_DEFAULTS[model].timeoutMs. */
  timeoutMs?: number;
};

export type MessagesCallResult =
  | { ok: true; message: Message; toolInput?: unknown; text: string }
  | { ok: false; reason: "no_api_key" | "timeout" | "http_error" | "parse_error"; error?: unknown };

/**
 * Wraps the system prompt in a cache-eligible block.
 *
 * Anthropic prompt caching costs 25% more to write but 90% less to read, so
 * as long as the system prompt is reused within ~5 minutes (which it is for
 * every batch of PRs), the aggregate savings are substantial.
 */
export function cachedSystem(text: string): CacheableTextBlock[] {
  return [
    {
      type: "text",
      text,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Thin wrapper around messages.create that:
 *   - returns null-shaped result if no API key is present (callers fall back)
 *   - enforces tool_choice when a tool is supplied
 *   - attaches an AbortController tied to the per-model timeout
 *   - extracts the first tool_use input OR concatenated text blocks
 */
export async function callClaude(
  opts: MessagesCallOptions
): Promise<MessagesCallResult> {
  const client = getAnthropicClient();
  if (!client) {
    console.error("[Anthropic] callClaude failed: no_api_key (ANTHROPIC_API_KEY missing).");
    return { ok: false, reason: "no_api_key" };
  }

  const defaults = MODEL_DEFAULTS[opts.model];
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? defaults.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // SDK 0.32.x doesn't type cache_control on stable TextBlockParam,
    // but the API accepts it; cast to the SDK's expected shape.
    const systemForSdk = opts.system as unknown as string | TextBlockParam[];
    const message = await client.messages.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens ?? defaults.maxTokens,
        temperature: opts.temperature ?? defaults.temperature,
        system: systemForSdk,
        messages: opts.messages,
        ...(opts.tool
          ? {
              tools: [opts.tool],
              tool_choice: { type: "tool" as const, name: opts.tool.name },
            }
          : {}),
      },
      { signal: controller.signal }
    );

    const toolBlock = message.content.find(
      (b): b is ToolUseBlock => b.type === "tool_use"
    );
    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      ok: true,
      message,
      toolInput: toolBlock?.input,
      text,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error(
        `[Anthropic] callClaude timeout after ${opts.timeoutMs ?? defaults.timeoutMs}ms (model=${opts.model}).`
      );
      return { ok: false, reason: "timeout", error: err };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[Anthropic] callClaude http_error (model=${opts.model}): ${msg}`
    );
    return { ok: false, reason: "http_error", error: err };
  } finally {
    clearTimeout(timer);
  }
}
