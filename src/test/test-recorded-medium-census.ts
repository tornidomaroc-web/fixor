/**
 * Keyless gate: the recorded MEDIUM lane per corpus. Zero spend.
 *
 * Run via: npm run test:recorded-medium-census
 *
 * WHAT IT GUARDS. The scoring gate's per-fixture declarations are seeded from
 * this census. If a re-record moves which fixtures land in the MEDIUM lane, the
 * declarations silently go stale and the scoring gate starts asserting against
 * evidence that no longer exists. This gate freezes the coupling: change the
 * recordings and it fails, forcing a declaration review rather than allowing a
 * quiet drift.
 *
 * It also serves as the PRE-FLIGHT check before any paid stage-3 dispatch: the
 * MEDIUM set predicts which fixtures the suppression branch will swallow, and
 * therefore whether a gate can pass at all before money is spent.
 *
 * NEGATIVE CONTROL. Case B builds a synthetic corpus in a temp directory
 * (fixtures/replay is frozen evidence and is never written by a test) holding one
 * `vuln/medium`, one `safe/medium` and one `vuln/high`. Only the first belongs in
 * the lane. Dropping either half of the predicate changes that count, so case B
 * fails for exactly that reason: dropping the `isVulnerable` half admits the
 * safe/medium, dropping the confidence half admits the vuln/high.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { censusCorpus, recordedMediumFixtures } from "./lib/recorded-medium-census";

let passed = 0;
let failed = 0;
const pass = (m: string): void => { passed++; process.stdout.write(`  PASS  ${m}\n`); };
const fail = (m: string): void => { failed++; process.stdout.write(`  FAIL  ${m}\n`); };
const check = (c: boolean, m: string): void => { c ? pass(m) : fail(m); };

const REPLAY_ROOT = join(process.cwd(), "fixtures", "replay");

// Frozen expectation. Every entry is backed by a tracked artifact:
//   webhook negatives 14/15 -> fixtures/webhook-unverified/META.md step 3
//   webhook positive/10     -> docs/detector-capabilities.md (documented miss)
//   env-exposure trio       -> live run 30903038957, unanimous 5/5
const EXPECTED_MEDIUM: Record<string, string[]> = {
  "admin-check-multi": [],
  "auth-bypass-multi": [],
  "idor-multi": [],
  "env-exposure-multi": [
    "negative/03-fastify-redacted-logs.ts",
    "positive/03-fastify-logs-env.ts",
    "positive/11-redacted-diagnostics.js",
  ],
  "webhook-unverified-multi": [
    "negative/14-app-router-apple-cross-file-verifier-helper.ts",
    "negative/15-app-router-graph-clientstate-challenge.ts",
    "positive/10-go-github-eq-compare.go",
  ],
};

// Recording count per corpus must equal model-reaching calls per sample from
// `measure:stage3-calls`. If these drift apart the census is no longer complete
// coverage and must not be cited as such.
const EXPECTED_RECORDINGS: Record<string, number> = {
  "admin-check-multi": 30,
  "auth-bypass-multi": 37,
  "idor-multi": 26,
  "env-exposure-multi": 17,
  "webhook-unverified-multi": 34,
};

// --- Case A: the real corpus -------------------------------------------------
process.stdout.write("\nCase A: frozen replay corpus\n");
for (const [corpus, expected] of Object.entries(EXPECTED_MEDIUM)) {
  const c = censusCorpus(REPLAY_ROOT, corpus);
  check(
    c.recordings === EXPECTED_RECORDINGS[corpus],
    `${corpus}: ${c.recordings} recordings (expect ${EXPECTED_RECORDINGS[corpus]})`,
  );
  check(c.unparseable === 0, `${corpus}: every recording carries a parseable verdict`);
  const got = c.medium.map((m) => m.sourceFixture).sort();
  check(
    JSON.stringify(got) === JSON.stringify([...expected].sort()),
    `${corpus}: MEDIUM lane = [${got.join(", ") || "none"}]`,
  );
  check(
    c.fingerprints.length === 1,
    `${corpus}: exactly one prompt fingerprint across recordings (got ${c.fingerprints.length})`,
  );
}

// The two facts the scoring commit's declarations actually rest on.
{
  const w = recordedMediumFixtures(REPLAY_ROOT, "webhook-unverified-multi");
  check(
    w.includes("negative/14-app-router-apple-cross-file-verifier-helper.ts") &&
      w.includes("negative/15-app-router-graph-clientstate-challenge.ts"),
    "webhook negatives 14 and 15 are in the MEDIUM lane (the two declared exceptions)",
  );
  check(
    w.includes("positive/10-go-github-eq-compare.go"),
    "webhook positive/10 is in the MEDIUM lane (a POSITIVE: suppression-induced FN, NOT declarable)",
  );
  const e = recordedMediumFixtures(REPLAY_ROOT, "env-exposure-multi");
  check(
    e.includes("negative/03-fastify-redacted-logs.ts"),
    "env-exposure negative/03 is in the MEDIUM lane (masked FP: stays at default, must FAIL)",
  );
  check(
    recordedMediumFixtures(REPLAY_ROOT, "auth-bypass-multi").length === 0,
    "auth-bypass needs ZERO declarations (its default is demonstrated, not assumed)",
  );
}

// --- Case B: NEGATIVE CONTROL, predicate isolation --------------------------
process.stdout.write("\nCase B: synthetic corpus (predicate isolation)\n");
{
  const root = mkdtempSync(join(tmpdir(), "fixor-census-"));
  const corpus = "synthetic-multi";
  mkdirSync(join(root, corpus), { recursive: true });

  const rec = (name: string, src: string, isVulnerable: boolean, confidence: string): void => {
    writeFileSync(
      join(root, corpus, `${name}.json`),
      JSON.stringify({
        key: name,
        meta: { sourceFixture: src, systemPromptFingerprint: "deadbeef0000" },
        request: {},
        // Must mirror the REAL replay shape (`response.toolInput`). A synthetic
        // fixture in a shape the corpus does not use makes this control test
        // fiction: it would pass against a reader that finds nothing in the real
        // corpus, which is precisely the failure caught while writing this gate.
        response: { toolInput: { isVulnerable, confidence, reasoning: "x" }, text: null },
      }),
    );
  };

  rec("a", "negative/in-lane.ts", true, "medium");   // the ONLY one in the lane
  rec("b", "negative/safe-medium.ts", false, "medium"); // isVulnerable half excludes
  rec("c", "positive/vuln-high.ts", true, "high");      // confidence half excludes

  const c = censusCorpus(root, corpus);
  check(c.recordings === 3, `synthetic: 3 recordings (got ${c.recordings})`);
  check(c.medium.length === 1, `synthetic: exactly 1 in the MEDIUM lane (got ${c.medium.length})`);
  check(
    c.medium[0]?.sourceFixture === "negative/in-lane.ts",
    "synthetic: the one in the lane is the vuln/medium",
  );
  check(
    !c.medium.some((m) => m.sourceFixture === "negative/safe-medium.ts"),
    "synthetic: safe/medium is EXCLUDED (the isVulnerable half of the predicate)",
  );
  check(
    !c.medium.some((m) => m.sourceFixture === "positive/vuln-high.ts"),
    "synthetic: vuln/high is EXCLUDED (the confidence half of the predicate)",
  );
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write("FAIL\n");
  process.exit(1);
}
process.stdout.write("PASS\n");
