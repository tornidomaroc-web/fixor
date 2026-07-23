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
import { currentInstallationId } from "../lib/cost-context";
import { calculateCost } from "../services/cost-tracking.service";
import { recordCost } from "../services/cost-store";
import { logger } from "../lib/logger";
import * as Sentry from "@sentry/node";
import {
  MAX_RETRIES,
  backoffDelayMs,
  extractRetryAfter,
  extractStatus,
  isRetryable,
  sleep,
} from "../lib/anthropic-retry";
import { recordLlmDetectionCall } from "../lib/llm-coverage";
import { recordLlmCall } from "../lib/llm-call-ledger";
import {
  resolveReplayMode,
  loadReplayFixture,
  saveReplayFixture,
} from "./llm-replay";

let _client: Anthropic | null = null;

/** Returns a lazily-initialized SDK client, or null if no API key is set. */
export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (_client) return _client;
  _client = new Anthropic({
    apiKey,
    defaultHeaders: { "anthropic-version": ANTHROPIC_API_VERSION },
    // SDK retries are disabled because callClaude implements its own
    // retry loop (5A-9) with Sentry breadcrumbs and Retry-After honor.
    // Leaving SDK retries on would multiply the attempt count.
    maxRetries: 0,
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
  /** Stable id of the calling analyzer/detector, for coverage attribution. */
  callerId?: string;
  /**
   * "detection" calls count toward scan-coverage integrity (llm-coverage
   * tally); "auxiliary" calls (fix generation, risk explainer) do not —
   * their failures surface via visible fallbacks instead. Defaults to
   * "detection": an untagged future call site can only over-warn about
   * degraded coverage, never silently skip the tally.
   */
  coverage?: "detection" | "auxiliary";
};

export type MessagesCallResult =
  | { ok: true; message: Message; toolInput?: unknown; text: string }
  | { ok: false; reason: "no_api_key" | "timeout" | "http_error" | "parse_error"; error?: unknown };

/**
 * DB-free cost observability for the most recent successful callClaude.
 *
 * The production cost ledger (cost-store) is Postgres-backed and only fires
 * when an installationId is present in the async context. An offline tool (the
 * F-004 recording harness) has neither, so we ALSO expose the per-call USD
 * computed straight from `message.usage`. Pure arithmetic, no I/O, independent
 * of installationId. Set on every successful call; stays null on failures and
 * on the replay path (which never reaches a real call).
 */
export interface CallCostDiag {
  model: ClaudeModelId;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
}
export let lastCallCost: CallCostDiag | null = null;
export function resetLastCallCost(): void {
  lastCallCost = null;
}

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
  opts: MessagesCallOptions,
): Promise<MessagesCallResult> {
  // Coverage tally: one entry per logical call (terminal outcome only —
  // internal retries are not separate attempts). This is the load-bearing
  // signal that keeps "LLM call failed" from masquerading as "no findings"
  // downstream; see src/lib/llm-coverage.ts.
  const tally = (reason?: "no_api_key" | "timeout" | "http_error"): void => {
    if (opts.coverage === "auxiliary") return;
    recordLlmDetectionCall(
      reason === undefined
        ? { ok: true }
        : {
            ok: false,
            failure: {
              caller: opts.callerId ?? "untagged",
              reason,
              model: opts.model,
            },
          },
    );
  };

  // [F-004 replay gate] Deterministic record/replay of model responses.
  // Inert unless FIXOR_REPLAY/FIXOR_RECORD is set: with neither, resolveReplayMode
  // returns "live" and callClaude behaves exactly as before (see
  // test-llm-replay-guard). Replay verifies detector wiring, tool-input parsing,
  // and lane logic against a FROZEN sample only - never detection quality or
  // model behavior (a replay is one sample, not repeated sampling).
  const replayMode = resolveReplayMode();
  if (replayMode === "replay") {
    // Runs before any client is constructed: zero network, zero spend. A missing
    // fixture throws ReplayFixtureMissing (fail loud) - it never falls through to
    // a real call and never returns the no_api_key empty-verdict path.
    const replayed = loadReplayFixture(opts);
    tally();
    // Unpriced: a replayed response carries no usage, so it counts toward
    // `calls` but not `pricedCalls`.
    recordLlmCall(null);
    return {
      ok: true,
      message: replayed.message,
      toolInput: replayed.toolInput,
      text: replayed.text,
    };
  }

  const client = getAnthropicClient();
  if (!client) {
    logger.error("callClaude failed: no_api_key (ANTHROPIC_API_KEY missing)");
    tally("no_api_key");
    recordLlmCall(null);
    return { ok: false, reason: "no_api_key" };
  }

  const defaults = MODEL_DEFAULTS[opts.model];
  const timeoutMs = opts.timeoutMs ?? defaults.timeoutMs;
  // SDK 0.32.x doesn't type cache_control on stable TextBlockParam,
  // but the API accepts it; cast to the SDK's expected shape.
  const systemForSdk = opts.system as unknown as string | TextBlockParam[];
  const resolvedTemperature = opts.temperature ?? defaults.temperature;

  let lastErr: unknown;
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const message = await client.messages.create(
        {
          model: opts.model,
          max_tokens: opts.maxTokens ?? defaults.maxTokens,
          ...(resolvedTemperature !== undefined
            ? { temperature: resolvedTemperature }
            : {}),
          system: systemForSdk,
          messages: opts.messages,
          ...(opts.tool
            ? {
                tools: [opts.tool],
                tool_choice: { type: "tool" as const, name: opts.tool.name },
              }
            : {}),
        },
        { signal: controller.signal },
      );

      const toolBlock = message.content.find(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      const text = message.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      // Compute per-call USD once from message.usage. Pure arithmetic, no I/O.
      // Exposed via lastCallCost (DB-free, always) AND persisted to the ledger
      // (only when an installationId is in context).
      const usage = message.usage as
        | (typeof message.usage & {
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            cacheCreationInputTokens?: number;
            cacheReadInputTokens?: number;
          })
        | undefined;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      const cacheCreationInputTokens =
        usage?.cache_creation_input_tokens ??
        usage?.cacheCreationInputTokens ??
        0;
      const cacheReadInputTokens =
        usage?.cache_read_input_tokens ?? usage?.cacheReadInputTokens ?? 0;
      const costUsd = calculateCost({
        model: opts.model,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      });
      lastCallCost = {
        model: opts.model,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
        costUsd,
      };

      const installationId = currentInstallationId();
      if (installationId !== undefined && usage) {
        try {
          await recordCost(installationId, costUsd);
        } catch (err) {
          // Cost-tracking is observability, not control flow. A DB
          // hiccup must not break the scan: we lose visibility on this
          // one call, not money.
          Sentry.captureException(err, {
            tags: { "fixor.phase": "record_cost" },
            extra: { installationId: String(installationId), costUsd },
          });
          logger.warn(
            { installationId: String(installationId), err },
            "recordCost failed",
          );
        }
      }

      if (attempts > 1) {
        Sentry.addBreadcrumb({
          category: "anthropic.retry",
          message: `Anthropic call succeeded on attempt ${attempts}`,
          level: "info",
          data: { model: opts.model, attempts },
        });
      }

      // [F-004 replay gate] In record mode, persist this real response keyed by
      // the request hash. Only runs when FIXOR_RECORD=1 (owner-local, with a key).
      if (replayMode === "record") {
        saveReplayFixture(opts, { toolInput: toolBlock?.input, text });
      }
      tally();
      // Priced ONLY when usage was present. `lastCallCost` is non-null on every
      // success (its token fields default to 0 when `usage` is absent), so a
      // success with no usage block would otherwise be counted as a priced call
      // at a fabricated $0.00, which reads downstream as a real MEASURED figure.
      // Guard on `usage` to match the sibling recordCost above, so pricedCalls
      // means "usage was present", not "the success path ran".
      recordLlmCall(usage ? lastCallCost : null);
      return {
        ok: true,
        message,
        toolInput: toolBlock?.input,
        text,
      };
    } catch (err: unknown) {
      lastErr = err;

      // AbortError = our own per-call timeout fired. Don't retry — the
      // caller's wall budget is already consumed.
      if (err instanceof Error && err.name === "AbortError") {
        Sentry.captureException(err, {
          tags: {
            "fixor.phase": "anthropic_call",
            "fixor.reason": "timeout",
          },
          extra: { model: opts.model, timeoutMs, attempts },
        });
        logger.error(
          { model: opts.model, timeoutMs, attempts },
          "callClaude timeout",
        );
        tally("timeout");
        recordLlmCall(null);
        return { ok: false, reason: "timeout", error: err };
      }

      if (attempt >= MAX_RETRIES || !isRetryable(err)) {
        break;
      }

      const retryAfter = extractRetryAfter(err);
      const delayMs = backoffDelayMs(attempt, retryAfter);
      const status = extractStatus(err);
      Sentry.addBreadcrumb({
        category: "anthropic.retry",
        message: `Anthropic call attempt ${attempt + 1} failed (status=${status ?? "n/a"}), retrying in ${delayMs}ms`,
        level: "warning",
        data: {
          model: opts.model,
          attempt: attempt + 1,
          status,
          retryAfter,
          delayMs,
        },
      });
      logger.warn(
        {
          model: opts.model,
          attempt: attempt + 1,
          status,
          retryAfter,
          delayMs,
        },
        "anthropic call failed; retrying",
      );
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }

  // Loop exited without success: either non-retryable error on first
  // attempt, or all retries exhausted.
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  Sentry.captureException(lastErr, {
    tags: { "fixor.phase": "anthropic_call", "fixor.reason": "http_error" },
    extra: { model: opts.model, attempts, status: extractStatus(lastErr) },
  });
  logger.error(
    {
      model: opts.model,
      err: msg,
      attempts,
      status: extractStatus(lastErr),
    },
    attempts > 1 ? "callClaude http_error after retries" : "callClaude http_error",
  );
  tally("http_error");
  recordLlmCall(null);
  return { ok: false, reason: "http_error", error: lastErr };
}
