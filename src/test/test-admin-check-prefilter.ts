/**
 * F-004 stage 2b.3, PR 1 of 2 - the FREE deterministic gate for admin-check.
 *
 * admin-check is a MIXED detector. Over its 42-file corpus (21 positives + 21
 * negatives), the shipped default configuration (`llmValidation = false`, from
 * `new AdminCheckDetector()` in registry.ts) resolves each fixture down exactly
 * one of three terminal paths, BEFORE any model call:
 *
 *   (a) dropped pre-model by a detect() gate (unsupported language, SKIP_PATH_RE,
 *       server-only marker) or by a zero-trigger prefilter  ->  3 fixtures
 *   (b) decided by the Option G per-pattern bypass: the first trigger is a
 *       literal-tier pattern with a hand-authored explanation, so the finding is
 *       emitted from the regex match alone and callClaude is NEVER invoked
 *                                                             ->  9 fixtures
 *   (c) reaches callClaude (judgment-tier first trigger: role_string_compare or
 *       one of the five route-def patterns)                   -> 30 fixtures
 *
 * This test guards (a) and (b). They are FREE: no key, no network, no recording,
 * no spend. A replay gate structurally CANNOT guard them - bucket (b) produces no
 * callClaude request, so there is no request key to record a response under, and
 * `runReplayGate` asserts recordings cover the manifest exactly. Bucket (c) is
 * PR 2 of 2 (the recorded replay gate) and is deliberately out of scope here.
 *
 * WHY THE patternId IS PINNED PER FIXTURE (the load-bearing assertion):
 * `prefilterRegex` keeps the EARLIEST match by character index across all
 * patterns and returns at most one hit; `analyzeFile` then branches on that one
 * trigger's tier. So a fixture containing a literal-tier pattern still goes to
 * the model when any judgment-tier pattern matches earlier in the file. This is
 * not hypothetical - it already happens:
 *   - positive/06-client-supplied-role.js is named for the literal-tier
 *     `body_role_check`, but an `express_route_def` match occurs earlier, so it
 *     lands in bucket (c) and `body_role_check` never fires.
 *   - positive/08-flask-endswith-domain.py fires the generic `email_endswith_at`,
 *     not the Python-specific `py_email_endswith_at`.
 * Asserting only "a finding was emitted" would pass while the wrong pattern
 * produced it. Pinning the ruleId is what catches that shadowing.
 *
 * HONEST SCOPE - WHAT A GREEN RUN HERE DOES *NOT* MEAN:
 * This gate exercises 7 of the 11 literal-tier patterns. Four are unexercised by
 * the current corpus and are guarded by NOTHING:
 *     email_eq_literal, py_email_endswith_at, role_fallback_admin, body_role_check
 * Two of those four (`py_email_endswith_at`, `body_role_check`) are shadowed by an
 * earlier match in the very fixtures intended to exercise them, so adding an
 * assertion alone would not reach them - they need new fixtures whose earliest
 * match is the intended pattern. That is deliberate follow-up work, NOT done here.
 * Do not read a green check as "all literal-tier patterns are guarded".
 *
 * Like every other deterministic gate in this repo, this is a wiring-and-parsing
 * gate. It verifies that the regex bypass emits the finding it claims to emit.
 * It does NOT verify detection quality; that is stage 3 (live).
 *
 * Run via: npm run test:admin-check-prefilter
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import { snapshotLlmCoverage } from "../lib/llm-coverage";
import {
  assertEnvFlagUnset,
  assertEscalationUnset,
  buildSyntheticDiff,
  loadFixture,
  OPT_IN_GUARD,
} from "./replay-harness";

const FIXTURES_DIR = "fixtures/admin-check";

/** Bucket (b): fixture -> the patternId whose regex match MUST produce the finding. */
const BYPASS_EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["positive/01-hardcoded-admin-email.ts", "admin_email_const"],
  ["positive/02-endswith-company-domain.ts", "email_endswith_at"],
  ["positive/03-email-includes-admin.ts", "email_includes_admin"],
  ["positive/04-default-admin-id-fallback.ts", "default_admin_id"],
  ["positive/05-admin-emails-array.js", "admin_emails_array"],
  ["positive/07-default-admin-id-helper.js", "default_admin_id"],
  ["positive/08-flask-endswith-domain.py", "email_endswith_at"],
  ["positive/09-flask-default-admin-email.py", "default_admin_email"],
  ["positive/10-go-admin-domain-suffix.go", "strings_hassuffix_email"],
];

/** Bucket (a): fixture -> the exact preFilterReason detect()/analyzeFile records. */
const PREMODEL_DROP_EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["negative/03-email-match-invite-only.ts", "no regex match"],
  ["negative/07-bootstrap-admins-script.js", "path filter"],
  ["negative/18-remix-action-factory-utility-module.ts", "no regex match"],
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
 * ReplayFixtureMissing BEFORE a client is constructed (anthropic-client.ts:181).
 * So "this fixture reached the model" surfaces as a loud, named failure rather
 * than as a silent spend or a confusing empty verdict.
 */
async function runFixture(id: string): Promise<{
  findings: Awaited<ReturnType<AdminCheckDetector["detect"]>>;
  preFilterReason: string;
  flagged: boolean;
  reachedModel: boolean;
  attemptedDelta: number;
}> {
  const [cls, file] = id.split("/") as [string, string];
  const { assumedPath, content } = loadFixture(join(FIXTURES_DIR, cls, file));
  const diff = buildSyntheticDiff(assumedPath, content);

  const before = snapshotLlmCoverage().attempted;
  const detector = new AdminCheckDetector();
  try {
    const findings = await detector.detect({ diff });
    const diag = detector.lastDiagnostics[0];
    return {
      findings,
      preFilterReason: diag?.preFilterReason ?? "(none)",
      flagged: diag?.flagged ?? false,
      reachedModel: false,
      attemptedDelta: snapshotLlmCoverage().attempted - before,
    };
  } catch (err) {
    if ((err as Error).name === "ReplayFixtureMissing") {
      return {
        findings: [],
        preFilterReason: "(threw)",
        flagged: false,
        reachedModel: true,
        attemptedDelta: snapshotLlmCoverage().attempted - before,
      };
    }
    throw err;
  }
}

async function main(): Promise<void> {
  // Preconditions. Both flags would silently invalidate the bucket partition:
  // the opt-in flag routes bucket (b) through the model; the escalation flag
  // adds a second callClaude on any MEDIUM verdict.
  assertEnvFlagUnset(...OPT_IN_GUARD.ADMIN_CHECK);
  assertEscalationUnset();

  // Zero-model-call proof, layer 1: strip the key from OUR process, then assert
  // no client can be constructed. Deleting rather than requiring-unset means a
  // developer with ANTHROPIC_API_KEY exported still runs a provably keyless test
  // instead of risking a real call on a regression.
  delete process.env.ANTHROPIC_API_KEY;
  process.env.FIXOR_REPLAY = "1";
  process.env.FIXOR_REPLAY_ROOT = mkdtempSync(join(tmpdir(), "fixor-nofix-"));

  process.stdout.write(
    "admin-check deterministic gate (buckets a + b).\n" +
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

  process.stdout.write("Bucket (b): Option G deterministic bypass, 9 positives\n");
  for (const [id, expectedPatternId] of BYPASS_EXPECTED) {
    const r = await runFixture(id);
    const expectedRuleId = `admin-check-${expectedPatternId}`;

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
    if (f.type !== "admin_check_risk") {
      problems.push(`type=${f.type} (want admin_check_risk)`);
    }
    if (f.severity !== "critical") {
      problems.push(`severity=${f.severity} (want critical)`);
    }
    if (f.ruleId !== expectedRuleId) {
      problems.push(`ruleId=${f.ruleId} (want ${expectedRuleId})`);
    }
    if (problems.length > 0) {
      fail(`${id}  ${problems.join("; ")}`);
    } else {
      pass(`${id}  bypass -> ${expectedRuleId} @critical, 0 LLM calls`);
    }
  }

  process.stdout.write(
    "\nBucket (a): dropped pre-model, 3 negatives (previously guarded by nothing)\n",
  );
  for (const [id, expectedReason] of PREMODEL_DROP_EXPECTED) {
    const r = await runFixture(id);

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
    `\nRESULT: PASS (${total}/${total} fixtures: 9 Option G bypass, 3 pre-model drops)\n` +
      "NOTE: deterministic wiring gate only. Detection quality is not verified here.\n" +
      "NOTE: guards 7 of 11 literal-tier patterns; see the header for the 4 unguarded.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
