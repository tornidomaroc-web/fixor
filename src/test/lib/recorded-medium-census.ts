/**
 * Recorded-verdict census over the frozen replay corpus. Keyless, zero spend.
 *
 * WHY THIS EXISTS. Declarations for the scoring gate must rest on evidence, and
 * the binding rule is that an exception is declared only where a live run or a
 * tracked spec already documents the behaviour. Before this module the only such
 * evidence was `fixtures/webhook-unverified/META.md` (two fixtures) plus one paid
 * run. Everything else would have been guesswork.
 *
 * `fixtures/replay/**` already holds ONE recorded response per model-reaching
 * fixture, per corpus, carrying the verdict the model actually returned. Counts
 * line up exactly with `measure:stage3-calls` (env-exposure 17, webhook 34,
 * auth-bypass 37, admin-check 30, idor family 26), so this is COMPLETE corpus
 * coverage at n=1, not a sample.
 *
 * IT IS A DEMONSTRATED PREDICTOR, ONCE. The env-exposure recordings name exactly
 * the three fixtures that paid run 30903038957 found in the MEDIUM lane:
 * `negative/03-fastify-redacted-logs.ts`, `positive/03-fastify-logs-env.ts`,
 * `positive/11-redacted-diagnostics.js`. That is one corpus of corroboration, not
 * a law, and this header is the place that says so.
 *
 * THE HONEST LIMIT, so it is not over-read. A recording is n=1. It proves a
 * verdict shape EXISTS for a fixture; it does NOT prove the shape recurs 5/5.
 * Sound for seeding declarations and for predicting an unsatisfiable gate before
 * spending. NOT a substitute for stability data, and it must never be cited as one.
 *
 * VALIDITY IS TIED TO THE PROMPT. Each recording carries the
 * `systemPromptFingerprint` it was made under. A prompt change moves the request
 * key and the replay gate stops matching, so a stale recording cannot silently
 * describe a prompt that no longer ships. The census reports the fingerprint set
 * per corpus so that tie is visible rather than assumed.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RecordedVerdict {
  sourceFixture: string;
  /** 1 for the five flat detectors; one per source/sink pair for IDOR. */
  verdictCount: number;
  /** Verdicts that are isVulnerable AND medium. >0 puts the fixture in the lane. */
  mediumCount: number;
  /** Distinct `{vuln,safe}/{confidence}` shapes present in this recording. */
  classes: string[];
  expectedFlagged?: boolean;
  systemPromptFingerprint?: string;
}

export interface CorpusCensus {
  corpus: string;
  recordings: number;
  /** Recordings whose response carried no parseable verdict. */
  unparseable: number;
  all: RecordedVerdict[];
  /** isVulnerable === true AND confidence === "medium". The suppression lane. */
  medium: RecordedVerdict[];
  fingerprints: string[];
}

/**
 * Pull the verdict out of a recorded response.
 *
 * The replay format stores the PARSED tool input at `response.toolInput`, not the
 * raw Anthropic `content[]` block array. This reader is written against the shape
 * the corpus actually uses; a reader written against the SDK's wire shape finds
 * nothing here and reports every corpus as an empty MEDIUM lane, which reads
 * exactly like a clean result. That false-clean was caught in development only
 * because the `unparseable === 0` assertion exists, so it stays.
 */
function extractVerdicts(response: unknown): Array<{ isVulnerable: boolean; confidence: string }> {
  const ti = (response as { toolInput?: Record<string, unknown> } | undefined)?.toolInput;
  if (!ti) return [];
  const one = (o: Record<string, unknown>): { isVulnerable: boolean; confidence: string } | null => {
    const iv = o["isVulnerable"];
    const cf = o["confidence"];
    return typeof iv === "boolean" && typeof cf === "string"
      ? { isVulnerable: iv, confidence: cf.toLowerCase() }
      : null;
  };
  // IDOR batches one verdict per source/sink pair under `verdicts[]`; the other
  // five detectors return a single flat verdict. Both are read, because a corpus
  // this reader cannot parse reports an EMPTY medium lane, which is
  // indistinguishable from a clean one.
  const arr = ti["verdicts"];
  if (Array.isArray(arr)) {
    return arr
      .map((x) => (x && typeof x === "object" ? one(x as Record<string, unknown>) : null))
      .filter((x): x is { isVulnerable: boolean; confidence: string } => x !== null);
  }
  const flat = one(ti);
  return flat ? [flat] : [];
}

export function censusCorpus(replayRoot: string, corpus: string): CorpusCensus {
  const dir = join(replayRoot, corpus);
  const out: CorpusCensus = {
    corpus,
    recordings: 0,
    unparseable: 0,
    all: [],
    medium: [],
    fingerprints: [],
  };
  if (!existsSync(dir)) return out;

  const fps = new Set<string>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    out.recordings++;
    let parsed: {
      meta?: { sourceFixture?: string; expectedFlagged?: boolean; systemPromptFingerprint?: string };
      response?: unknown;
    };
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      out.unparseable++;
      continue;
    }
    const vs = extractVerdicts(parsed.response);
    if (vs.length === 0) {
      out.unparseable++;
      continue;
    }
    if (parsed.meta?.systemPromptFingerprint) fps.add(parsed.meta.systemPromptFingerprint);
    const rec: RecordedVerdict = {
      sourceFixture: parsed.meta?.sourceFixture ?? `(unnamed:${name.slice(0, 12)})`,
      verdictCount: vs.length,
      mediumCount: vs.filter((v) => v.isVulnerable && v.confidence === "medium").length,
      classes: [...new Set(vs.map((v) => `${v.isVulnerable ? "vuln" : "safe"}/${v.confidence}`))].sort(),
      expectedFlagged: parsed.meta?.expectedFlagged,
      systemPromptFingerprint: parsed.meta?.systemPromptFingerprint,
    };
    out.all.push(rec);
    if (rec.mediumCount > 0) out.medium.push(rec);
  }
  out.medium.sort((a, b) => a.sourceFixture.localeCompare(b.sourceFixture));
  out.fingerprints = [...fps].sort();
  return out;
}

/** Sorted `sourceFixture` names in the MEDIUM lane for one corpus. */
export function recordedMediumFixtures(replayRoot: string, corpus: string): string[] {
  return censusCorpus(replayRoot, corpus).medium.map((m) => m.sourceFixture).sort();
}
