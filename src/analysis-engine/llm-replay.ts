/**
 * F-004 stage 2 - deterministic replay gate for detector LLM calls.
 *
 * SCOPE AND LIMITS (read before trusting a green run):
 *   This gate verifies detector WIRING, tool-input PARSING, and LANE logic
 *   against a FROZEN recorded model response. It does NOT verify detection
 *   quality or model behavior. A replayed response is ONE frozen sample, not
 *   repeated sampling (the F-008 lesson). A model-judgment regression is caught
 *   only by the opt-in live gate (stage 3), never here. A green replay gate is
 *   NOT "detection verified".
 *
 * How it plugs in: `callClaude` calls into this module at the top of the
 * function. When neither FIXOR_REPLAY nor FIXOR_RECORD is set, none of this
 * runs and `callClaude` behaves exactly as before (see test-llm-replay-guard).
 *
 *   - FIXOR_REPLAY=1 : return a recorded response for the request key. Runs
 *     BEFORE any client is constructed, so it never touches the network and
 *     spends nothing. A missing fixture is a LOUD failure (ReplayFixtureMissing),
 *     never a silent fall-through to a real call or to the no_api_key path.
 *   - FIXOR_RECORD=1 : after a real successful call, persist the response keyed
 *     by the request hash. This is the only path that spends API budget, and it
 *     is run locally by the owner with their own key, never in CI.
 *
 * The request key is a SHA-256 over canonical (recursively key-sorted) JSON of
 * the response-shaping request fields only. Because request construction is a
 * pure function of the fixture input (verified: no time/random/nonce/path in
 * any detector), the same fixture maps to the same key on every machine. A
 * prompt or tool change moves the key, so the old fixture stops matching and
 * replay fails loud - the key IS the staleness detector.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Message, Tool } from "@anthropic-ai/sdk/resources/messages";

import { MODEL_DEFAULTS } from "../config/models";
import type { MessagesCallOptions } from "./anthropic-client";

/**
 * Root for recorded fixtures. Read per call (not cached at module load) and
 * overridable via FIXOR_REPLAY_ROOT so tests can isolate to a temp dir.
 */
function replayRoot(): string {
  return process.env.FIXOR_REPLAY_ROOT ?? "fixtures/replay";
}

export type ReplayMode = "live" | "replay" | "record";

/** Thrown in replay mode when no fixture matches the request key. Fail loud. */
export class ReplayFixtureMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayFixtureMissing";
  }
}

/**
 * Resolve the active mode from env. Throws if both flags are set, so an
 * ambiguous configuration fails loud instead of silently picking one.
 */
export function resolveReplayMode(): ReplayMode {
  const replay = process.env.FIXOR_REPLAY === "1";
  const record = process.env.FIXOR_RECORD === "1";
  if (replay && record) {
    throw new Error(
      "FIXOR_REPLAY and FIXOR_RECORD are both set; set at most one.",
    );
  }
  if (replay) return "replay";
  if (record) return "record";
  return "live";
}

/** Recursively sort object keys so property order cannot perturb the hash. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Normalize the system block to plain text (drop cache_control metadata). */
function normalizeSystem(system: MessagesCallOptions["system"]): string {
  if (typeof system === "string") return system;
  return system.map((block) => block.text).join("\n");
}

/**
 * Short (12-hex) fingerprint of the normalized system prompt. Detector-agnostic:
 * because normalizeSystem(cachedSystem(SYSTEM_PROMPT)) === SYSTEM_PROMPT, this
 * equals a detector's own SYSTEM_PROMPT_FINGERPRINT (sha256(SYSTEM_PROMPT)[:12]).
 */
function systemPromptFingerprint(system: MessagesCallOptions["system"]): string {
  return createHash("sha256")
    .update(normalizeSystem(system))
    .digest("hex")
    .slice(0, 12);
}

/**
 * The response-shaping request fields, resolved and normalized. Operational
 * fields (callerId, coverage, timeoutMs) are excluded: they do not shape the
 * model response, so they must not perturb the key.
 */
function requestShape(opts: MessagesCallOptions): unknown {
  const defaults = MODEL_DEFAULTS[opts.model];
  const tool: Tool | undefined = opts.tool;
  return {
    model: opts.model,
    system: normalizeSystem(opts.system),
    messages: opts.messages,
    tool: tool
      ? {
          name: tool.name,
          description: tool.description ?? null,
          input_schema: tool.input_schema,
        }
      : null,
    max_tokens: opts.maxTokens ?? defaults.maxTokens,
    temperature: opts.temperature ?? defaults.temperature ?? null,
  };
}

/** Stable SHA-256 hex of the canonical request shape. */
export function computeReplayKey(opts: MessagesCallOptions): string {
  const canonical = JSON.stringify(canonicalize(requestShape(opts)));
  return createHash("sha256").update(canonical).digest("hex");
}

function detectorDir(opts: MessagesCallOptions): string {
  return opts.callerId ?? "untagged";
}

function fixturePath(opts: MessagesCallOptions, key: string): string {
  return join(replayRoot(), detectorDir(opts), `${key}.json`);
}

export interface ReplayFixture {
  key: string;
  meta: {
    detectorId: string;
    model: string;
    /**
     * Short (12-hex) fingerprint of the normalized system prompt. Redundant
     * with the key (the key already covers the prompt), but human-legible: it
     * equals a detector's own SYSTEM_PROMPT_FINGERPRINT (e.g. env-exposure's
     * d2ca2f022d99) so a reviewer can eyeball prompt drift without recomputing
     * the sha. Written generically here, not hard-coded per detector.
     */
    systemPromptFingerprint: string;
    recordedAtIso: string;
    /**
     * Provenance added by the recording harness AFTER this file is written
     * (callClaude/saveReplayFixture do not know which fixture drove the call).
     * Optional so the generic writer stays detector-agnostic.
     */
    sourceFixture?: string;
    /** The detector's expected end-to-end flagged outcome for this fixture. */
    expectedFlagged?: boolean;
    /** Human note for non-obvious cases (e.g. a MEDIUM-ceiling positive). */
    note?: string;
  };
  /** Human-readable request summary for debugging; the key is authoritative. */
  request: {
    model: string;
    system: string;
    messages: unknown;
    tool: string | null;
  };
  response: {
    toolInput: unknown;
    text: string;
  };
}

export interface ReplayResult {
  message: Message;
  toolInput: unknown;
  text: string;
}

/** Build a minimal Message from a recorded response. Consumers read toolInput/text. */
function synthMessage(
  opts: MessagesCallOptions,
  toolInput: unknown,
  text: string,
): Message {
  const content: unknown[] = [];
  if (opts.tool && toolInput !== undefined) {
    content.push({
      type: "tool_use",
      id: "replay_tool_use",
      name: opts.tool.name,
      input: toolInput,
    });
  }
  if (text) content.push({ type: "text", text, citations: null });
  return {
    id: "replay_msg",
    type: "message",
    role: "assistant",
    model: opts.model,
    content,
    stop_reason: opts.tool ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Message;
}

/**
 * Replay: load the recorded response for this request. Throws
 * ReplayFixtureMissing if absent. Never touches the network.
 */
export function loadReplayFixture(opts: MessagesCallOptions): ReplayResult {
  const key = computeReplayKey(opts);
  const path = fixturePath(opts, key);
  if (!existsSync(path)) {
    throw new ReplayFixtureMissing(
      `no recorded response for key ${key} (detector ${detectorDir(opts)}). ` +
        `Re-record with FIXOR_RECORD=1 (a prompt or tool change moves the key).`,
    );
  }
  const fixture = JSON.parse(readFileSync(path, "utf8")) as ReplayFixture;
  const toolInput = fixture.response?.toolInput;
  const text = fixture.response?.text ?? "";
  return { message: synthMessage(opts, toolInput, text), toolInput, text };
}

/**
 * Reference to the fixture file most recently written by saveReplayFixture.
 * Set ONLY on the record path (FIXOR_RECORD=1), so it stays null during live
 * scans and replay. Lets the recording harness locate the just-written file to
 * augment its meta (sourceFixture, expectedFlagged, note) without threading
 * fixture provenance through callClaude's options.
 */
export interface RecordedFixtureRef {
  path: string;
  key: string;
}
export let lastRecordedFixture: RecordedFixtureRef | null = null;
export function resetLastRecordedFixture(): void {
  lastRecordedFixture = null;
}

/**
 * Record: persist a real response keyed by the request hash. Called only in
 * record mode after a successful live call.
 */
export function saveReplayFixture(
  opts: MessagesCallOptions,
  result: { toolInput: unknown; text: string },
): void {
  const key = computeReplayKey(opts);
  const dir = join(replayRoot(), detectorDir(opts));
  mkdirSync(dir, { recursive: true });
  const fixture: ReplayFixture = {
    key,
    meta: {
      detectorId: detectorDir(opts),
      model: opts.model,
      systemPromptFingerprint: systemPromptFingerprint(opts.system),
      recordedAtIso: new Date().toISOString(),
    },
    request: {
      model: opts.model,
      system: normalizeSystem(opts.system),
      messages: opts.messages,
      tool: opts.tool?.name ?? null,
    },
    response: {
      toolInput: result.toolInput ?? null,
      text: result.text ?? "",
    },
  };
  const path = fixturePath(opts, key);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  lastRecordedFixture = { path, key };
}
