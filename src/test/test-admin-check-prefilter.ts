/**
 * F-004 stage 2b.3, PR 1 of 2 - the FREE deterministic gate for admin-check.
 *
 * admin-check is a MIXED detector. Over its 45-file corpus (24 positives + 21
 * negatives), the shipped default configuration (`llmValidation = false`, from
 * `new AdminCheckDetector()` in registry.ts) resolves each fixture down exactly
 * one of three terminal paths, BEFORE any model call:
 *
 *   (a) dropped pre-model by a detect() gate (unsupported language, SKIP_PATH_RE,
 *       server-only marker) or by a zero-trigger prefilter  ->  3 fixtures
 *   (b) decided by the Option G per-pattern bypass: the first trigger is a
 *       literal-tier pattern with a hand-authored explanation, so the finding is
 *       emitted from the regex match alone and callClaude is NEVER invoked
 *                                                             -> 12 fixtures
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
 *   - positive/08-flask-endswith-domain.py is Python, spelled `email.endswith`,
 *     yet it fires `email_endswith_at`, whose regex body is camelCase. The `/i`
 *     flag is what bridges the two spellings - see below.
 * Asserting only "a finding was emitted" would pass while the wrong pattern
 * produced it. Pinning the ruleId is what catches that shadowing.
 *
 * THIS GATE IS THE STANDING GUARD ON A LOAD-BEARING REGEX FLAG:
 * `email_endswith_at` is written camelCase (`email.endsWith`) but carries `/i`,
 * and that flag is the ONLY reason admin-check detects the same bug in Python,
 * where `email.endswith("@corp.com")` is the idiomatic spelling. positive/08 is
 * Python and is pinned to that pattern id below, so if anyone "tidies up" the
 * regex by dropping `/i`, positive/08 matches nothing at all, drops pre-model
 * instead of bypassing, and THIS TEST FAILS. That is deliberate. Do not relax
 * the pin, and do not delete positive/08.
 *
 * HONEST SCOPE - WHAT A GREEN RUN HERE DOES *NOT* MEAN:
 * This gate exercises 10 of the 10 literal-tier patterns. Positives 22, 23 and 24
 * were added specifically to reach `email_eq_literal`, `role_fallback_admin` and
 * `body_role_check`, each shaped so the intended pattern is the EARLIEST match
 * (an assertion alone would not have reached the latter two: they were shadowed
 * in the fixtures originally meant to exercise them).
 *
 * 10 of 10 is full literal-tier coverage, and it is NOT a rounding-up of the old
 * "10 of 11". The eleventh, `py_email_endswith_at`, was DELETED in PR C2 rather
 * than counted: it held the identical regex in Python casing, also `/i`, so it
 * accepted exactly the same strings at exactly the same index as
 * `email_endswith_at`, which sits earlier in PREFILTER_PATTERNS. Since
 * prefilterRegex breaks ties with a STRICT `<` (`m.index < earliest.idx`), the
 * earlier entry always kept the slot and the Python twin was unreachable by any
 * input. Keeping it alive to report "11 of 11" would have been coverage theatre.
 * Deletion was verified behaviour-preserving by simulating prefilterRegex with
 * and without it over all 45 corpus fixtures plus 14 synthetic shapes built to
 * fire it: zero inputs where it won, zero changes in winning patternId or index.
 * Still do not read a green check as "detection quality is verified".
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
  // LOAD-BEARING PIN. This fixture is Python (`email.endswith`) matched by a
  // camelCase regex; only the `/i` on `email_endswith_at` bridges the spellings.
  // If that flag is ever removed this line fails first. Do not "fix" it by
  // relaxing the expected id - restore the flag.
  ["positive/08-flask-endswith-domain.py", "email_endswith_at"],
  ["positive/09-flask-default-admin-email.py", "default_admin_email"],
  ["positive/10-go-admin-domain-suffix.go", "strings_hassuffix_email"],
  // Added by PR C1 to reach three literal-tier patterns the corpus had never
  // exercised. Each fixture is SHAPED so the intended pattern is the earliest
  // match: 22 carries no ADMIN_EMAIL constant before the comparison, 23 uses no
  // `role ===` compare, and 24 defines no route so `express_route_def` cannot
  // pre-empt `body_role_check` the way it does in positive/06.
  ["positive/22-hardcoded-admin-email-equality.js", "email_eq_literal"],
  ["positive/23-role-nullish-fallback-admin.js", "role_fallback_admin"],
  ["positive/24-client-supplied-role-no-route-def.js", "body_role_check"],
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

  process.stdout.write("Bucket (b): Option G deterministic bypass, 12 positives\n");
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
    `\nRESULT: PASS (${total}/${total} fixtures: 12 Option G bypass, 3 pre-model drops)\n` +
      "NOTE: deterministic wiring gate only. Detection quality is not verified here.\n" +
      "NOTE: guards 10 of 10 literal-tier patterns (full literal-tier coverage).\n" +
      "      The old 11th, py_email_endswith_at, was deleted as unreachable dead\n" +
      "      code rather than counted; see the header.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
