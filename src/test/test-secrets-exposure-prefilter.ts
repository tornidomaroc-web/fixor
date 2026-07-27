/**
 * F-004 stage 2 sub-step 2b.5 - the FREE deterministic gate for secrets-exposure.
 *
 * secrets-exposure is the ONLY shipping detector with no model-reaching bucket at
 * all. `registry.ts` constructs `new SecretsExposureDetector()` with no options,
 * so `llmValidation` resolves to false and `analyzeFile` returns from the Option G
 * bypass BEFORE the single `callClaude` call site is reachable. Every fixture in
 * the corpus therefore terminates on one of exactly two paths:
 *
 *   (a) dropped pre-model by a detect() gate (unsupported language, SKIP_PATH_RE,
 *       server-only marker) or by a zero-trigger prefilter  -> 10 fixtures
 *   (b) decided by the Option G per-pattern bypass: the earliest surviving regex
 *       trigger emits the finding from its hand-authored explanation, and
 *       callClaude is NEVER invoked                          -> 15 fixtures
 *
 * THIS GATE IS NOW THE SOLE AUTOMATED GUARD ON THIS DETECTOR. `test-secrets-
 * exposure.ts` was retired (PR C3): it asserted only a per-fixture `flagged`
 * boolean rolled up into three aggregate bars, which this gate already subsumes
 * per fixture and far more strictly (exact finding count, preFilterReason,
 * flagged, type, severity, confidence AND ruleId, plus 0 LLM calls). It also
 * could not reach the model under shipped defaults, so it measured no live
 * accuracy despite being key-gated. Nothing was lost; the duplicate went. If
 * live secrets accuracy is ever wanted (i.e. FIXOR_SECRETS_LLM_OPT_IN=true),
 * build it on `runStabilityHarness` like the other five detectors - do NOT
 * resurrect the retired file, which was single-shot and hardcoded its
 * denominators.
 *
 * There is no bucket (c). admin-check needed TWO gates because 30 of its fixtures
 * reach the model; secrets-exposure needs ONE, because none do. A replay gate is
 * not merely unnecessary here, it is structurally impossible: with no callClaude
 * request there is no request key to record a response under, and `runReplayGate`
 * asserts recordings cover the manifest exactly.
 *
 * MEASURED, NOT READ. The manifest below was produced by executing this detector
 * keylessly over the corpus, not by reading fixture names or META.md. The tracker
 * records two separate occasions where a corpus count derived by reading was
 * refuted by execution (auth-bypass "~39" that was 37; idor "29 recordable" that
 * was 26). Regenerating this manifest by inspection WILL get it wrong.
 *
 * WHY THE patternId IS PINNED PER FIXTURE (the load-bearing assertion):
 * `prefilterRegex` keeps every match, `analyzeFile` drops redaction-shaped ones,
 * and the EARLIEST survivor alone decides the finding. So a fixture containing a
 * given pattern can still emit under a different one that matched earlier. This
 * is not hypothetical, it is measured here:
 *   - positive/06-aws-keys-hardcoded.js is named for the AWS key pair, but
 *     `aws_access_key` matches earlier and `aws_secret_literal` never fires.
 *   - positive/08-postgres-password-client.ts is named for the Postgres URL, but
 *     `password_literal` matches earlier and `postgres_url_password` never fires.
 * Asserting only "a finding was emitted" would pass while the wrong pattern
 * produced it. Pinning the ruleId is what catches that shadowing. Those two
 * shadowed patterns are now covered independently by positive/14 and positive/15,
 * which reproduce the pattern with the shadowing pattern removed from the file.
 *
 * HONEST SCOPE - WHAT A GREEN RUN HERE DOES *NOT* MEAN:
 *
 * 1. This gate now exercises all 15 of the 15 PREFILTER_PATTERNS, re-measured
 *    keylessly (not read) after adding the five fixtures below. The five that
 *    2b.5 measured as guarded by NOTHING are now each covered by a fixture whose
 *    EARLIEST surviving trigger is the intended pattern:
 *      formerly SHADOWED (had matched a fixture but were never the winner, so an
 *      added assertion alone could not reach them; each needed a NEW fixture with
 *      the shadowing pattern removed so the intended one wins):
 *        aws_secret_literal        -> positive/14-aws-secret-literal.ts
 *        postgres_url_password     -> positive/15-postgres-url-password.ts
 *      formerly ABSENT (matched by no fixture at all):
 *        google_api_key            -> positive/11-google-api-key-hardcoded.ts
 *        stripe_live_publishable   -> positive/12-stripe-publishable-live.ts
 *        private_key_literal       -> positive/13-private-key-hardcoded.ts
 *    A green check now does mean all 15 prefilter patterns emit under their own
 *    ruleId. It still says nothing about detection QUALITY; that is stage 3.
 *
 * 2. NO fixture in this corpus is redaction-shaped. The Day 13 redaction-shape
 *    exemption (`REDACTION_VALUE_PATTERNS`, see META.md and D8a in
 *    docs/detector-test-rules.md) was validated against 21 ad-hoc cases that were
 *    never committed as fixtures. Neither the full-exemption drop nor the partial
 *    `redactionSkipCount` path is exercised by anything here. Rather than assert
 *    over an empty manifest, which would LOOK like coverage while providing none,
 *    this gate pins the measured fact that the corpus does not reach those paths
 *    (see the corpus invariants below). If someone adds a redaction-shaped fixture
 *    or widens REDACTION_VALUE_PATTERNS so an existing fixture starts skipping,
 *    that invariant fails and the change becomes deliberate instead of silent.
 *
 * 3. Like every other deterministic gate in this repo, this is a
 *    wiring-and-parsing gate. It verifies that the regex bypass emits the finding
 *    it claims to emit. It does NOT verify detection quality; that is stage 3.
 *
 * F-010 AND FIXTURE HONESTY (read before "fixing" a failure here):
 * F-010 is an OPEN, known false positive on this detector: it flags an obvious
 * self-identifying placeholder. Every expectation pinned below is a WIRING
 * SAMPLE, never an endorsement that the verdict is correct. As measured, no
 * fixture in this corpus exhibits F-010's self-identifying-placeholder shape
 * (the values here are realistic high-entropy strings), so no pin below is
 * believed to encode that bug. If a future F-010 fix flips one of these
 * expectations, the correct response is to UPDATE THE PIN and record why, never
 * to conclude this gate was wrong. Note also that unlike the replay gates there
 * is nothing to re-record here: this sub-step has no requests, no responses, and
 * no recordings.
 *
 * Run via: npm run test:secrets-exposure-prefilter
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { SecretsExposureDetector } from "../analysis-engine/detectors/secrets-exposure.detector";
import { snapshotLlmCoverage } from "../lib/llm-coverage";
import {
  assertEnvFlagUnset,
  assertEscalationUnset,
  buildSyntheticDiff,
  loadFixture,
  OPT_IN_GUARD,
} from "./replay-harness";

const FIXTURES_DIR = "fixtures/secrets-exposure";

/** Bucket (b): fixture -> the patternId whose regex match MUST produce the finding. */
const BYPASS_EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["positive/01-supabase-service-role-client.tsx", "next_public_service_role"],
  ["positive/02-next-public-openai.ts", "next_public_suspicious"],
  ["positive/03-firebase-admin-in-component.tsx", "firebase_admin_import"],
  ["positive/04-stripe-secret-hardcoded.ts", "stripe_live_secret"],
  ["positive/05-anthropic-key-fallback.ts", "anthropic_key"],
  ["positive/06-aws-keys-hardcoded.js", "aws_access_key"],
  ["positive/07-config-route-leaks-service-role.ts", "supabase_service_role"],
  ["positive/08-postgres-password-client.ts", "password_literal"],
  ["positive/09-slack-webhook-hardcoded.py", "slack_webhook_hardcoded"],
  ["positive/10-jwt-secret-const.go", "jwt_secret_literal"],
  // The five patterns 2b.5 measured as unguarded, each now covered by a
  // fixture whose EARLIEST surviving trigger is the intended pattern (measured
  // keylessly, not read). The two formerly SHADOWED patterns are isolated by
  // omitting the shadowing pattern entirely: 14 carries no AKIA access-key id
  // (so aws_access_key cannot precede aws_secret_literal), 15 carries no
  // `password: "..."` field (so password_literal cannot precede
  // postgres_url_password).
  ["positive/11-google-api-key-hardcoded.ts", "google_api_key"],
  ["positive/12-stripe-publishable-live.ts", "stripe_live_publishable"],
  ["positive/13-private-key-hardcoded.ts", "private_key_literal"],
  ["positive/14-aws-secret-literal.ts", "aws_secret_literal"],
  ["positive/15-postgres-url-password.ts", "postgres_url_password"],
];

/** Bucket (a): fixture -> the exact preFilterReason detect()/analyzeFile records. */
const PREMODEL_DROP_EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["negative/01-supabase-service-role-server-only.ts", "server-only marker"],
  ["negative/02-public-config-vars.ts", "no regex match"],
  ["negative/03-firebase-admin-server-lib.ts", "server-only marker"],
  ["negative/04-stripe-in-getserverside.tsx", "no regex match"],
  ["negative/05-stripe-test-keys-fixtures.ts", "path filter"],
  ["negative/06-aws-keys-from-env.js", "no regex match"],
  ["negative/07-anthropic-server-only.ts", "server-only marker"],
  ["negative/08-secrets-decrypted-from-kms.ts", "server-only marker"],
  ["negative/09-slack-webhook-from-env.py", "no regex match"],
  ["negative/10-jwt-secret-from-env.go", "no regex match"],
];

let failures = 0;

function pass(msg: string): void {
  process.stdout.write(`  PASS  ${msg}\n`);
}

function fail(msg: string): void {
  failures++;
  process.stdout.write(`  FAIL  ${msg}\n`);
}

/**
 * Run one fixture through the real detect() with the shipped-default detector.
 *
 * Zero-model-call proof, layer 2: FIXOR_REPLAY=1 against an EMPTY fixture root
 * means any callClaude short-circuits inside loadReplayFixture and throws
 * ReplayFixtureMissing BEFORE a client is constructed. So "this fixture reached
 * the model" surfaces as a loud, named failure rather than as a silent spend or
 * a confusing empty verdict.
 */
async function runFixture(id: string): Promise<{
  findings: Awaited<ReturnType<SecretsExposureDetector["detect"]>>;
  preFilterReason: string;
  flagged: boolean;
  redactionSkipCount: number | undefined;
  reachedModel: boolean;
  attemptedDelta: number;
}> {
  const [cls, file] = id.split("/") as [string, string];
  const { assumedPath, content } = loadFixture(join(FIXTURES_DIR, cls, file));
  const diff = buildSyntheticDiff(assumedPath, content);

  const before = snapshotLlmCoverage().attempted;
  const detector = new SecretsExposureDetector();
  try {
    const findings = await detector.detect({ diff });
    const diag = detector.lastDiagnostics[0];
    return {
      findings,
      preFilterReason: diag?.preFilterReason ?? "(none)",
      flagged: diag?.flagged ?? false,
      redactionSkipCount: diag?.redactionSkipCount,
      reachedModel: false,
      attemptedDelta: snapshotLlmCoverage().attempted - before,
    };
  } catch (err) {
    if ((err as Error).name === "ReplayFixtureMissing") {
      return {
        findings: [],
        preFilterReason: "(threw)",
        flagged: false,
        redactionSkipCount: undefined,
        reachedModel: true,
        attemptedDelta: snapshotLlmCoverage().attempted - before,
      };
    }
    throw err;
  }
}

async function main(): Promise<void> {
  // Preconditions. The opt-in flag would route every prefilter hit through the
  // model, collapsing bucket (b) and silently invalidating this manifest; the
  // escalation flag adds a second callClaude on any MEDIUM verdict.
  assertEnvFlagUnset(...OPT_IN_GUARD.SECRETS);
  assertEscalationUnset();

  // Zero-model-call proof, layer 1: strip the key from OUR process, then assert
  // no client can be constructed. Deleting rather than requiring-unset means a
  // developer with ANTHROPIC_API_KEY exported still runs a provably keyless test
  // instead of risking a real call on a regression.
  delete process.env.ANTHROPIC_API_KEY;
  process.env.FIXOR_REPLAY = "1";
  process.env.FIXOR_REPLAY_ROOT = mkdtempSync(join(tmpdir(), "fixor-nofix-"));

  process.stdout.write(
    "secrets-exposure deterministic gate (buckets a + b; there is no bucket c).\n" +
      "Mode: no key, no network, no DB, no recording, no spend.\n" +
      "Guards the Option G regex bypass and the pre-model drops. NOT detection quality.\n\n",
  );

  const client: ReturnType<typeof getAnthropicClient> = getAnthropicClient();
  if (client === null) {
    pass("no Anthropic client constructible (ANTHROPIC_API_KEY stripped)");
  } else {
    fail("an Anthropic client was constructed; this test must stay keyless");
  }

  // Fail loud if a fixture was renamed or deleted rather than silently shrinking.
  for (const [id] of [...BYPASS_EXPECTED, ...PREMODEL_DROP_EXPECTED]) {
    const [cls, file] = id.split("/") as [string, string];
    if (!existsSync(join(FIXTURES_DIR, cls, file))) {
      fail(`manifest fixture missing from disk: ${id}`);
    }
  }

  // Collected for the corpus invariants asserted after both buckets.
  const seenRedactionSkip: string[] = [];
  const seenRedactionDrop: string[] = [];
  const seenUnknownPatternId: string[] = [];

  function recordInvariants(
    id: string,
    r: { preFilterReason: string; redactionSkipCount: number | undefined },
  ): void {
    if (r.redactionSkipCount !== undefined) seenRedactionSkip.push(id);
    if (r.preFilterReason === "redaction-shape exemption") seenRedactionDrop.push(id);
    if (r.preFilterReason.startsWith("bypass: unknown patternId")) {
      seenUnknownPatternId.push(id);
    }
  }

  process.stdout.write("Bucket (b): Option G deterministic bypass, 15 positives\n");
  for (const [id, expectedPatternId] of BYPASS_EXPECTED) {
    const r = await runFixture(id);
    recordInvariants(id, r);
    const expectedRuleId = `secrets-exposure-${expectedPatternId}`;

    if (r.reachedModel) {
      fail(`${id}  reached callClaude; expected the Option G bypass`);
      continue;
    }
    if (r.attemptedDelta !== 0) {
      fail(`${id}  recorded ${r.attemptedDelta} LLM call attempt(s); expected 0`);
      continue;
    }
    if (r.findings.length !== 1) {
      fail(`${id}  emitted ${r.findings.length} finding(s); expected exactly 1`);
      continue;
    }
    const f = r.findings[0]!;
    const problems: string[] = [];
    if (r.preFilterReason !== "llm-bypass") {
      problems.push(`preFilterReason=${r.preFilterReason} (want llm-bypass)`);
    }
    if (!r.flagged) problems.push("flagged=false (want true)");
    if (f.type !== "secrets_exposure_risk") {
      problems.push(`type=${f.type} (want secrets_exposure_risk)`);
    }
    if (f.severity !== "critical") {
      problems.push(`severity=${f.severity} (want critical)`);
    }
    if (f.confidence !== "high") {
      problems.push(`confidence=${f.confidence} (want high)`);
    }
    if (f.ruleId !== expectedRuleId) {
      problems.push(`ruleId=${f.ruleId} (want ${expectedRuleId})`);
    }
    if (problems.length > 0) {
      fail(`${id}  ${problems.join("; ")}`);
    } else {
      pass(`${id}  bypass -> ${expectedRuleId} @critical/high, 0 LLM calls`);
    }
  }

  process.stdout.write(
    "\nBucket (a): dropped pre-model, 10 negatives (previously guarded by nothing)\n",
  );
  for (const [id, expectedReason] of PREMODEL_DROP_EXPECTED) {
    const r = await runFixture(id);
    recordInvariants(id, r);

    if (r.reachedModel) {
      fail(`${id}  reached callClaude; expected a pre-model drop`);
      continue;
    }
    if (r.attemptedDelta !== 0) {
      fail(`${id}  recorded ${r.attemptedDelta} LLM call attempt(s); expected 0`);
      continue;
    }
    const problems: string[] = [];
    if (r.preFilterReason !== expectedReason) {
      problems.push(`preFilterReason=${r.preFilterReason} (want ${expectedReason})`);
    }
    if (r.findings.length !== 0) {
      problems.push(`emitted ${r.findings.length} finding(s) (want 0)`);
    }
    if (r.flagged) problems.push("flagged=true (want false)");
    if (problems.length > 0) {
      fail(`${id}  ${problems.join("; ")}`);
    } else {
      pass(`${id}  dropped pre-model: ${expectedReason}, 0 LLM calls`);
    }
  }

  // Corpus invariants. These pin MEASURED facts about what this corpus does NOT
  // reach. They are deliberately not per-fixture assertion arms: no fixture here
  // is redaction-shaped, so an arm over those paths would assert nothing while
  // looking like coverage. Pinning the absence makes a future change deliberate.
  process.stdout.write("\nCorpus invariants (measured absences, not coverage)\n");

  if (seenRedactionDrop.length === 0) {
    pass("no fixture takes the redaction-shape full exemption (path unexercised)");
  } else {
    fail(
      `redaction-shape exemption fired on [${seenRedactionDrop.join(" ")}]. ` +
        "A redaction-shaped fixture now exists; give it its own manifest entry " +
        "and update the honest-scope header, which states the path is unexercised.",
    );
  }

  if (seenRedactionSkip.length === 0) {
    pass("no fixture sets redactionSkipCount (partial-skip path unexercised)");
  } else {
    fail(
      `redactionSkipCount set on [${seenRedactionSkip.join(" ")}]. ` +
        "A partial redaction skip now occurs; pin the expected count per fixture " +
        "and update the honest-scope header, which states the path is unexercised.",
    );
  }

  if (seenUnknownPatternId.length === 0) {
    pass("the 'bypass: unknown patternId' fail-safe stayed unreached");
  } else {
    fail(
      `'bypass: unknown patternId' fired on [${seenUnknownPatternId.join(" ")}]. ` +
        "A trigger carries a patternId absent from PREFILTER_PATTERNS, so the " +
        "finding was silently dropped. This is a lost finding, not a test problem.",
    );
  }

  // Zero-model-call proof, layer 3: nothing anywhere in this run tallied a call.
  const totalAttempted = snapshotLlmCoverage().attempted;
  process.stdout.write("\n");
  if (totalAttempted === 0) {
    pass("zero LLM call attempts recorded across the whole run");
  } else {
    fail(`${totalAttempted} LLM call attempt(s) recorded across the run; expected 0`);
  }

  const total = BYPASS_EXPECTED.length + PREMODEL_DROP_EXPECTED.length;
  if (failures > 0) {
    process.stdout.write(`\nRESULT: FAIL (${failures} failing assertion(s))\n`);
    process.exit(1);
  }
  process.stdout.write(
    `\nRESULT: PASS (${total}/${total} fixtures: ${BYPASS_EXPECTED.length} Option G bypass, ` +
      `${PREMODEL_DROP_EXPECTED.length} pre-model drops)\n` +
      "NOTE: deterministic wiring gate only. Detection quality is not verified here.\n" +
      "NOTE: guards all 15 prefilter patterns (was 10 of 15 before PR B).\n" +
      "NOTE: no redaction-shaped fixture exists; that path is pinned absent, not covered.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
