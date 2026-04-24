/**
 * Centralized Claude model registry.
 *
 * Keep all model IDs here so we can upgrade in one place. Every code path
 * that talks to Anthropic MUST import from this file — no hard-coded model
 * strings elsewhere.
 */

export const CLAUDE_MODELS = {
  /** Fast, cheap detection pass — used for diff analysis. */
  DETECTION: "claude-sonnet-4-6",
  /** Heavier reasoning — used for fix generation and risk explanation. */
  REASONING: "claude-opus-4-7",
  /** Low-latency fallback for trivial transformations. */
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/** Per-model generation defaults. */
export const MODEL_DEFAULTS = {
  [CLAUDE_MODELS.DETECTION]: {
    maxTokens: 8192,
    temperature: 0,
    timeoutMs: 45_000,
  },
  [CLAUDE_MODELS.REASONING]: {
    maxTokens: 4096,
    temperature: 0,
    timeoutMs: 60_000,
  },
  [CLAUDE_MODELS.HAIKU]: {
    maxTokens: 2048,
    temperature: 0,
    timeoutMs: 20_000,
  },
} as const;

/** `anthropic-version` header. Bump deliberately. */
export const ANTHROPIC_API_VERSION = "2023-06-01";
