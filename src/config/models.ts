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
  /**
   * Stronger second-opinion model for the H8 MEDIUM-verdict escalation
   * (Phase H Tier 3). ONLY reached on a MEDIUM-confidence verdict when the
   * FIXOR_ESCALATE_MEDIUM flag is on (off by default). Detection stays on
   * DETECTION (Sonnet 4.6); this is a bounded, flagged second pass.
   */
  ESCALATION: "claude-opus-4-8",
  /** Low-latency fallback for trivial transformations. */
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/**
 * Per-model generation defaults.
 *
 * `temperature` is OPTIONAL. Anthropic deprecated the parameter on the
 * Claude 4-era reasoning/haiku models (Opus 4.7, Haiku 4.5), and sending
 * it now returns HTTP 400 "temperature is deprecated for this model".
 * Sonnet 4.6 still accepts it; we keep `temperature: 0` there until
 * Anthropic deprecates it Sonnet-side too.
 */
export interface ModelDefaults {
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
}

export const MODEL_DEFAULTS: Record<ClaudeModelId, ModelDefaults> = {
  [CLAUDE_MODELS.DETECTION]: {
    maxTokens: 8192,
    temperature: 0,
    timeoutMs: 45_000,
  },
  [CLAUDE_MODELS.REASONING]: {
    // Opus 4.7 deprecated `temperature`; rely on the API server-side default.
    maxTokens: 4096,
    timeoutMs: 60_000,
  },
  [CLAUDE_MODELS.ESCALATION]: {
    // Opus 4.8 also deprecates `temperature` (same family as 4.7) — omit it
    // and rely on the server-side default. NOTE: this means the escalation
    // verdict is NOT run-to-run deterministic; the H8 anchor gate replays
    // each anchor K times and treats any flip as a failure. The structured
    // answer is small (one decision + reasoning), so a tight token cap.
    maxTokens: 1024,
    timeoutMs: 60_000,
  },
  [CLAUDE_MODELS.HAIKU]: {
    // Haiku 4.5 deprecated `temperature` (same Claude 4 era as Opus 4.7).
    maxTokens: 2048,
    timeoutMs: 20_000,
  },
};

/** `anthropic-version` header. Bump deliberately. */
export const ANTHROPIC_API_VERSION = "2023-06-01";
