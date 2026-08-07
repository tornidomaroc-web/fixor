/**
 * F-004 stage 2b.0 - env-exposure expressed as a DetectorReplaySpec.
 *
 * This is the 2a env-exposure record/replay configuration lifted into one spec
 * the shared engines (replay-harness.ts) consume. Every VALUE here - the
 * detector id, the 17-fixture manifest, the EXPECTED_FLAGGED map, the
 * MEDIUM-ceiling notes, and the positive/negative layout - was carried over
 * UNCHANGED from the 2a files, so env-exposure's recorded keys and replayed
 * outcomes are byte-behavior identical through the generalized code.
 *
 * ONE id has changed since: `negative/03-fastify-redacted-logs.ts` is now
 * `positive/12-fastify-redacted-logs.ts` (R6 reclassification, see
 * fixtures/env-exposure/META.md). The RECORDING is untouched - the replay key
 * hashes the prompt, the prompt path comes from the fixture's ASSUMED-PATH
 * header, and that header was deliberately left reading `03-...` exactly as
 * positive/11 still reads `07-...` after the same move. Only the corpus id
 * moved; no re-record, no spend, no key drift.
 */

import {
  EnvExposureDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../../analysis-engine/detectors/env-exposure.detector";
import {
  flaggedOutcome,
  positiveNegativeLayout,
  type DetectorReplaySpec,
  type HarnessDetector,
} from "../replay-harness";

const DETECTOR_ID = "env-exposure-multi";
const SOURCE_DIR = "fixtures/env-exposure";
const REPLAY_DIR = "fixtures/replay/env-exposure-multi";

/**
 * Expected END-TO-END flagged outcome per fixture (folder is NOT the answer).
 * The THREE MEDIUM-ceiling positives are expected flagged:false: the LLM calls
 * them vulnerable at MEDIUM and the confidence ladder suppresses them.
 * Documented so it never reads as a mislabel later.
 *
 * "flagged:false is expected" is a statement about the SHIPPED LADDER, not an
 * endorsement of it. All three are real vulnerabilities the model caught and
 * the ladder discarded. The word "correctly" used to sit in the note below and
 * has been removed: it asserted a judgment the evidence does not support.
 */
const MEDIUM_CEILING_NOTE =
  "Positive-folder MEDIUM-ceiling case: the LLM verdict is isVulnerable:true at " +
  "confidence:medium, and the detector's confidence ladder suppresses it " +
  "(escalation off). Expected flagged=false; this is NOT a mismatch, it is a " +
  "suppression-induced false negative the ladder produces by design.";

const EXPECTED_FLAGGED: Record<string, boolean> = {
  "positive/01-debug-env-route.ts": true,
  "positive/02-error-handler-leaks-env.ts": true,
  "positive/03-fastify-logs-env.ts": false, // MEDIUM ceiling
  "positive/04-admin-runtime-no-prod-check.ts": true,
  "positive/05-healthz-config.js": true,
  "positive/06-diagnostics-send.js": true,
  "positive/07-error-includes-env.js": true,
  "positive/08-flask-diagnostics.py": true,
  "positive/09-fastapi-runtime.py": true,
  "positive/10-go-env-dump.go": true,
  "positive/11-redacted-diagnostics.js": false, // MEDIUM ceiling
  "positive/12-fastify-redacted-logs.ts": false, // MEDIUM ceiling (R6, was negative/03)
  "negative/04-dev-env-keys-only.ts": false,
  "negative/05-healthz-specific-fields.js": false,
  "negative/06-logger-only-env.js": false,
  "negative/08-flask-env-keys-only.py": false,
  "negative/09-fastapi-runtime-specific.py": false,
};

const NOTE: Record<string, string> = {
  "positive/03-fastify-logs-env.ts": MEDIUM_CEILING_NOTE,
  "positive/11-redacted-diagnostics.js": MEDIUM_CEILING_NOTE,
  "positive/12-fastify-redacted-logs.ts": MEDIUM_CEILING_NOTE,
};

/**
 * Completeness manifest: the 17 LLM-reaching source fixtures that MUST each
 * have a recording. The expectedFlagged VALUE is read from each recording's
 * meta at replay time (single source of truth); this list only guarantees all
 * 17 are present. (Same set as 2a's SOURCE_MANIFEST / EXPECTED_FLAGGED keys.)
 */
const SOURCE_MANIFEST: readonly string[] = Object.keys(EXPECTED_FLAGGED);

export const envExposureReplaySpec: DetectorReplaySpec = {
  detectorId: DETECTOR_ID,
  systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  sourceDir: SOURCE_DIR,
  replayDir: REPLAY_DIR,
  manifest: SOURCE_MANIFEST,
  layout: positiveNegativeLayout({ dir: SOURCE_DIR }),
  makeDetector: (): HarnessDetector => new EnvExposureDetector(),
  expectedFlagged: (id: string): boolean => {
    const v = EXPECTED_FLAGGED[id];
    if (typeof v !== "boolean") {
      throw new Error(`env-exposure: no expectedFlagged for id ${id}`);
    }
    return v;
  },
  note: (id: string): string | undefined => NOTE[id],
  assertOutcome: flaggedOutcome(),
};
