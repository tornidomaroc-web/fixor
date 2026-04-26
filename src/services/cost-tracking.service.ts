/**
 * Pure cost calculation from Anthropic SDK Message.usage.
 *
 * Pricing is per 1M tokens, USD. Cache writes cost 25% more than base
 * input tokens; cache reads cost 90% less. Output tokens have their
 * own rate.
 *
 * Source: https://www.anthropic.com/pricing (Claude 4 family).
 */

import type { ClaudeModelId } from "../config/models";
import { logger } from "../lib/logger";

export interface ModelPricing {
  /** USD per 1M input tokens (base, no caching). */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const MODEL_PRICING: Record<ClaudeModelId, ModelPricing> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
};

/** Subset of Anthropic SDK's Usage type - only what we need to price. */
export interface UsageRecord {
  model: ClaudeModelId;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Compute USD cost for one Claude call. Returns 0 for unknown models so
 * a missing rate never blocks scanning - but logs a warning so we
 * notice and add the rate.
 */
export function calculateCost(usage: UsageRecord): number {
  const pricing = MODEL_PRICING[usage.model];
  if (!pricing) {
    logger.warn({ model: usage.model }, "no pricing for model, counting as $0");
    return 0;
  }

  const baseInput = (usage.inputTokens ?? 0) * pricing.input;
  const cacheWrite = (usage.cacheCreationInputTokens ?? 0) * pricing.input * 1.25;
  const cacheRead = (usage.cacheReadInputTokens ?? 0) * pricing.input * 0.10;
  const output = (usage.outputTokens ?? 0) * pricing.output;

  return (baseInput + cacheWrite + cacheRead + output) / 1_000_000;
}
