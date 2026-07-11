/**
 * F-004 stage 2b.4 - idor replay spec (the fifth detector; FOURTH gated).
 *
 * SHAPE, MEASURED NOT ASSUMED: idor is a PURE bucket-(c) detector. All 26 source
 * fixtures reach `callClaude`. Bucket (a) is EMPTY (no fixture is dropped by any
 * of the five pre-model gates: unsupported language, path filter, server-only
 * marker, no source/sink co-occurrence, proximity threshold - every
 * `preFilterReason` was null). Bucket (b) is EMPTY: idor has NO Option-G-style
 * deterministic bypass; `llm-bypass` does not appear in the detector. Therefore,
 * unlike admin-check (which needed a second, free deterministic gate for its 9
 * bypass positives + 3 pre-model drops), idor needs NO free deterministic gate.
 * The replay gate alone covers the whole corpus.
 *
 * This was measured by driving the compiled detector keylessly with `callClaude`
 * spied out, classifying by whether the request was issued. The SAME driver,
 * pointed at `fixtures/admin-check`, independently reproduced that corpus's
 * bucket (c) = 30, matching the merged 2b.3 manifest - so the discriminator is
 * validated, not assumed.
 *
 * THE "29 RECORDABLE" FIGURE IS REFUTED. It was a naive file count, 21 + 6 + 2,
 * that (a) merged three separate corpora and (b) counted three SIDECAR files in
 * `fixtures/idor/negative/` as fixtures: `03-postgres-rls.policy.sql`,
 * `04-supabase-policy.policy.sql`, `07-rls-via-prisma-extension.middleware.ts`.
 * The true count is 26 source fixtures. Same failure mode as auth-bypass's "~39"
 * that turned out to be 37: a count derived from the filesystem, not execution.
 * The shared harness now excludes sidecars from enumeration (isFixtureFile).
 *
 * THREE CORPORA, ONE MANIFEST. `fixtures/idor` (18: 9 positive + 9 negative),
 * `fixtures/idor-tenant` (6: 3 + 3), and `fixtures/idor-multi` (2, flat). All
 * three drive the SAME detector, whose DETECTOR_ID is "idor-multi", so every
 * recording lands in `fixtures/replay/idor-multi/` keyed by request hash. Ids
 * are namespaced by corpus (`<corpus>/<class>/<file>`, or `<corpus>/<file>` for
 * the flat one) so they cannot collide - `fixtures/idor/positive/01-*` and
 * `fixtures/idor-tenant/positive/01-*` would otherwise both be "positive/01-*".
 *
 * SIDECARS - THE FIRST REAL EXERCISE OF `loadSidecars`, AND WHY IT IS LOAD-BEARING:
 * three negatives carry companion files that the detector reads as ground truth
 * (`SIDECAR_KINDS.RLS_POLICY` on negatives 03 and 04, `SIDECAR_KINDS.MIDDLEWARE`
 * on 07). Their bodies are interpolated into the user message
 * (`buildMultiPairUserMessage`), which is `messages[0].content`, which is inside
 * the replay key. MEASURED: `computeReplayKey` differs with vs without sidecars
 * for exactly those 3 ids and for no other fixture.
 *
 * This is STRICTLY WORSE than admin-check's `routeGuard === undefined` freeze.
 * There, the un-guarded branch was still a coherent thing to freeze. Here, the
 * RLS policy and the tenant-scoped middleware ARE the entire reason those three
 * files are negatives. Record them without sidecars and the model sees an
 * unscoped request-derived id flowing into a DB lookup with no ground truth, and
 * will very likely return isVulnerable:true. We would freeze three FALSE
 * POSITIVES into the manifest. Hence `loadSidecars` is wired below and is not
 * optional.
 *
 * OUTCOME SHAPE: `findingSetOutcome`, never `flaggedOutcome`. idor emits ONE
 * finding per (source, sink) candidate pair - measured 48 pairs over 26 files;
 * 12 files have 1 pair, 12 have 2, and negatives 03 and 04 have SIX each. A
 * boolean `findings.length > 0` passes on a multi-pair positive when ANY single
 * pair flags, so a regression dropping five of six findings would read green.
 *
 * EXPECTED SETS ARE UNKNOWN UNTIL RECORDED. `EXPECTED_SET` below is EMPTY, on
 * purpose. The exact per-pair verdicts are a property of the model's response,
 * which does not exist yet - this step is free and records nothing. Until the
 * recording step fills it in (the RECONCILIATION HOOK), `test:replay-idor`
 * CANNOT PASS: findingSetOutcome reports a loud config error for every id rather
 * than silently degrading to a boolean. That is intentional. This spec is not
 * wired into `test:ci` for exactly this reason.
 *
 * LANE ANCHORING IS DEFERRED, NOT IGNORED. idor has all three not-flagged-but-
 * vulnerable lanes (LOW silent; MEDIUM routed through `resolveMediumVerdict` to
 * "review-queue"; and an R10 `laneDeferral` that hands a HIGH verdict to
 * auth-bypass when `callerAuth === "unauthenticated"` or to admin-check when
 * `operationClass === "administrative"`). But the DIAGNOSTIC cannot express them
 * per-pair:
 *   - `idor.detector.ts:862` sets `diag.verdict = verdictByIndex.get(0)` - only
 *     PAIR 0's verdict is exposed. `verdictLaneOutcome` reads
 *     `lastDiagnostics[0].verdict`, so on the 14 multi-pair files it would see
 *     one of up to six verdicts.
 *   - `idor.detector.ts:957` assigns `diag.laneDeferral` INSIDE the per-pair
 *     loop, so on a file where two pairs defer, last-write-wins and the first
 *     deferral is lost.
 * A lane assertion on idor would therefore be lossy exactly where idor is
 * interesting. `EXPECTED_LANE` stays `{}` and no lane assertion is dispatched.
 * FOLLOW-UP (not done here): widen both to per-pair arrays, then anchor lanes.
 *
 * This also means idor is the SOURCE side of an H7-shaped deferral, in two
 * directions, making the recorded triangle idor -> auth-bypass, idor ->
 * admin-check, auth-bypass -> admin-check. Unlike admin-check, idor's verdict
 * schema DOES carry the deferral facts (`callerAuth`, `operationClass` are
 * required tool fields), so these recordings are the first artifact capable of
 * answering the idor side of H7. Whether any fixture actually lands in a lane is
 * a record-time calibration decision for the founder; do not pre-encode it.
 *
 * GUARD: `assertEscalationUnset` is enforced inside `runReplayGate` and
 * `recordFixtures` (shared engine). It is MANDATORY here for a substantive
 * reason, not as convention: idor's MEDIUM branch calls `resolveMediumVerdict`,
 * which fires a SECOND `callClaude` (callerId `escalation:idor-multi`, an
 * illegal Windows path segment) when `FIXOR_ESCALATE_MEDIUM=true`. There is NO
 * idor-specific opt-in env var (no analog to `FIXOR_ADMIN_CHECK_LLM_OPT_IN`), so
 * no second, detector-specific assertion is needed or added.
 *
 * SCOPE AND LIMITS (F-008 guardrail): a green replay gate verifies WIRING,
 * tool-input PARSING, and the verdict path against FROZEN samples only. It does
 * NOT verify detection quality. Model judgment is stage 3 (opt-in live).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  IdorDetector,
  SYSTEM_PROMPT_FINGERPRINT,
} from "../../analysis-engine/detectors/idor.detector";
import type { DetectorContext } from "../../analysis-engine/detector.types";
import {
  SIDECAR_EXT_TO_KIND,
  SIDECAR_EXTS,
} from "../../analysis-engine/sidecar-kinds";
import {
  buildSyntheticDiff,
  findingSetOutcome,
  isFixtureFile,
  lfNormalize,
  loadFixture,
  positiveNegativeLayout,
  type DetectorReplaySpec,
  type ExpectedFinding,
  type ExpectedLane,
  type HarnessDetector,
  type Layout,
  type OutcomeInput,
} from "../replay-harness";

// The detector's own callerId, which becomes the replay fixture DIRECTORY name.
// Colon-free (a colon is an illegal Windows path segment - the same footgun
// assertEscalationUnset guards, where the escalation callerId would be
// `escalation:idor-multi`). Verified: "idor-multi" is colon-free.
const DETECTOR_ID = "idor-multi";
const REPLAY_DIR = "fixtures/replay/idor-multi";

const DIR_IDOR = "fixtures/idor";
const DIR_TENANT = "fixtures/idor-tenant";
const DIR_MULTI = "fixtures/idor-multi";

/** Reported as the human-facing source dir; the manifest spans all three. */
const SOURCE_DIR = DIR_IDOR;

// ===========================================================================
// Sidecar loading - the first live use of positiveNegativeLayout's hook.
// ===========================================================================

/**
 * Read a fixture's companion sidecars by extension, mirroring
 * `lib/stability-harness.ts`'s reader. `<base>.policy.sql` -> rls-policy,
 * `<base>.middleware.ts` -> middleware, etc. Returns `undefined` when a fixture
 * has none, so `buildContext` emits a bare `{ diff }` byte-identical to the
 * no-sidecar detectors (an empty `sidecarsByPath` object would still be a key
 * present on the context and is deliberately avoided).
 */
function readCompanionSidecars(
  fixturePath: string,
  assumedPath: string,
): DetectorContext["sidecarsByPath"] | undefined {
  const base = fixturePath.replace(/\.[^.\\/]+$/, "");
  const kinds: Record<string, string> = {};
  for (const ext of SIDECAR_EXTS) {
    const p = base + ext;
    if (existsSync(p))
      kinds[SIDECAR_EXT_TO_KIND[ext]!] = lfNormalize(readFileSync(p, "utf8"));
  }
  return Object.keys(kinds).length > 0 ? { [assumedPath]: kinds } : undefined;
}

// ===========================================================================
// Layout: three corpora behind one Layout, ids namespaced by corpus.
// ===========================================================================

/** A flat corpus: fixtures directly under `<dir>/`, id = "<file>". */
function flatLayout(dir: string): Layout {
  const list = (): string[] => readdirSync(dir).filter(isFixtureFile).sort();
  return {
    resolveSelector(sel: string): string {
      const files = list();
      const exact = files.find((f) => f === sel);
      const prefixed = files.filter((f) => f.startsWith(sel));
      const file = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
      if (!file) {
        throw new Error(`selector "${sel}" matched ${prefixed.length} files; be specific.`);
      }
      return file;
    },
    buildContext(id: string): DetectorContext {
      const fixturePath = join(dir, id);
      const { assumedPath, content } = loadFixture(fixturePath);
      const diff = buildSyntheticDiff(assumedPath, content);
      const sidecars = readCompanionSidecars(fixturePath, assumedPath);
      return sidecars ? { diff, sidecarsByPath: sidecars } : { diff };
    },
  };
}

const SUB_LAYOUTS: Readonly<Record<string, Layout>> = {
  idor: positiveNegativeLayout({
    dir: DIR_IDOR,
    loadSidecars: (id, assumedPath) => {
      const [cls, file] = id.split("/") as [string, string];
      return readCompanionSidecars(join(DIR_IDOR, cls, file), assumedPath);
    },
  }),
  "idor-tenant": positiveNegativeLayout({
    dir: DIR_TENANT,
    loadSidecars: (id, assumedPath) => {
      const [cls, file] = id.split("/") as [string, string];
      return readCompanionSidecars(join(DIR_TENANT, cls, file), assumedPath);
    },
  }),
  "idor-multi": flatLayout(DIR_MULTI),
};

/**
 * Composite layout. An id is `<corpus>/<rest>`; `<rest>` is `<class>/<file>` for
 * the two positive/negative corpora and `<file>` for the flat one. Delegates to
 * the matching sub-layout so `positiveNegativeLayout` (and its sidecar hook)
 * stays the single implementation for the two-class corpora.
 */
const idorLayout: Layout = {
  resolveSelector(sel: string): string {
    const slash = sel.indexOf("/");
    if (slash < 0) {
      throw new Error(
        `selector must be "<corpus>/<rest>" where corpus is one of ` +
          `${Object.keys(SUB_LAYOUTS).join(" | ")}: ${sel}`,
      );
    }
    const corpus = sel.slice(0, slash);
    const rest = sel.slice(slash + 1);
    const sub = SUB_LAYOUTS[corpus];
    if (!sub) throw new Error(`unknown corpus "${corpus}" in selector: ${sel}`);
    return `${corpus}/${sub.resolveSelector(rest)}`;
  },
  buildContext(id: string): DetectorContext {
    const slash = id.indexOf("/");
    const corpus = id.slice(0, slash);
    const rest = id.slice(slash + 1);
    const sub = SUB_LAYOUTS[corpus];
    if (!sub) throw new Error(`unknown corpus "${corpus}" in id: ${id}`);
    return sub.buildContext(rest);
  },
};

// ===========================================================================
// Manifest + expected class.
// ===========================================================================

/**
 * Expected END-TO-END flagged outcome per fixture, per the corpus's DESIGNED
 * intent: every positive flags, every negative stays silent. Both flat
 * idor-multi fixtures flag (A has two independent IDORs; B has one real and one
 * safe, so it still flags - the SET, not the boolean, is what distinguishes
 * them, which is precisely why findingSetOutcome exists).
 *
 * This drives the record-time class assertion and `meta.expectedFlagged`. It is
 * a strictly weaker claim than the finding SET and is knowable in advance; the
 * set is not.
 */
function enumerateClass(dir: string, cls: "positive" | "negative"): string[] {
  return readdirSync(join(dir, cls)).filter(isFixtureFile).sort();
}

const EXPECTED_FLAGGED: Record<string, boolean> = {};
for (const [corpus, dir] of [
  ["idor", DIR_IDOR],
  ["idor-tenant", DIR_TENANT],
] as const) {
  for (const cls of ["positive", "negative"] as const) {
    for (const f of enumerateClass(dir, cls)) {
      EXPECTED_FLAGGED[`${corpus}/${cls}/${f}`] = cls === "positive";
    }
  }
}
for (const f of readdirSync(DIR_MULTI).filter(isFixtureFile).sort()) {
  // Both idor-multi fixtures contain at least one real IDOR (see its META.md).
  EXPECTED_FLAGGED[`idor-multi/${f}`] = true;
}

/**
 * Completeness manifest: the 26 model-reaching source fixtures that MUST each
 * have a recording. ALL 26 reach the model (buckets (a) and (b) are empty), so
 * unlike admin-check no fixture is intentionally absent. Derived by enumeration
 * rather than hand-listed, so a new fixture cannot be silently omitted - and
 * `isFixtureFile` guarantees the three sidecars are never enumerated.
 */
const SOURCE_MANIFEST: readonly string[] = Object.keys(EXPECTED_FLAGGED);

// ===========================================================================
// RECONCILIATION HOOK - expected finding sets. EMPTY until recorded.
// ===========================================================================

/**
 * The EXACT finding set per fixture, identity `(ruleId, startLine)`.
 *
 * RECONCILED FROM THE RECORDINGS (F-004 2b.4). Populated by enumerating the real
 * detector end-to-end in replay mode against the committed recordings - not by
 * guessing. `findingSetOutcome` now asserts these exact sets; a missing or
 * unexpected finding fails LOUD by id.
 *
 * COORDINATES ARE REPLAY (HEADER-STRIPPED), NOT RAW. Every `startLine` here is
 * the sink line as the detector emits it DURING REPLAY, i.e. after
 * `loadFixture` (replay-harness.ts:67) strips the one-line `// ASSUMED-PATH:`
 * header. That is a fixed −1 offset versus the raw-file line numbers pinned in
 * `src/test/test-idor-multi.ts` (which asserts A={19,36}, B={22} against the
 * on-disk file). The two are consistent: idor-multi A here is {18,35}, B is
 * {21}. The offset is the loader convention, NOT a finding discrepancy -
 * "correcting" these to the test-idor-multi numbers would make the gate fail.
 *
 * TWO POSITIVES PIN A SHORT SET, ON PURPOSE. `idor-tenant/positive/03` ({26})
 * and `idor-multi/B` ({21}) each emit ONE finding, not two. The missing pair in
 * each is a confident false@high SAFE pair (verified per-pair against the
 * recorded verdicts), NOT a suppressed true positive - so the short set is the
 * correct expected outcome, and `findingSetOutcome` (not a boolean) is what
 * makes pinning it meaningful. A positive recording an EMPTY set would instead
 * be the H7-shaped recall question in the header and must be escalated, not
 * papered over with `[]`; none of the 12 positives does.
 *
 * All 12 negatives pin `[]` (9 in `fixtures/idor/negative`, 3 in
 * `fixtures/idor-tenant/negative`); the 3 sidecar negatives (idor 03/04/07) are
 * silent because `loadSidecars` injects their RLS/middleware ground truth.
 */
const EXPECTED_SET: Record<string, readonly ExpectedFinding[]> = {
  // --- fixtures/idor: 9 positives ---
  "idor/positive/01-nextjs-app-router.ts": [
    { ruleId: "idor-nextjs_destructured-prisma_find_unique", startLine: 23 },
  ],
  "idor/positive/02-express.ts": [
    { ruleId: "idor-express_params-orm_find_one", startLine: 13 },
    { ruleId: "idor-express_params-orm_find_one", startLine: 27 },
  ],
  "idor/positive/03-fastapi.py": [
    { ruleId: "idor-fastapi_path_params-node_pg_query", startLine: 20 },
    { ruleId: "idor-fastapi_path_params-node_pg_query", startLine: 44 },
  ],
  "idor/positive/04-rails.rb": [
    { ruleId: "idor-rails_params_sym-rails_find_by", startLine: 6 },
    { ruleId: "idor-rails_params_sym-rails_find_by", startLine: 23 },
  ],
  "idor/positive/05-hono.ts": [
    { ruleId: "idor-hono_param-prisma_find_first", startLine: 23 },
    { ruleId: "idor-hono_param-prisma_find_first", startLine: 37 },
  ],
  "idor/positive/06-nestjs.ts": [
    { ruleId: "idor-nestjs_param-orm_find_by_id", startLine: 33 },
    { ruleId: "idor-nestjs_param-orm_find_by_id", startLine: 45 },
  ],
  "idor/positive/07-go-chi-raw-sql.go": [
    { ruleId: "idor-go_chi_urlparam-raw_sql_where_id", startLine: 32 },
  ],
  "idor/positive/08-trpc.ts": [
    { ruleId: "idor-trpc_input_access-prisma_find_unique", startLine: 22 },
  ],
  "idor/positive/09-fastapi-typed-path-param.py": [
    {
      ruleId: "idor-fastapi_typed_path_param-sqlalchemy_session_get",
      startLine: 18,
    },
  ],

  // --- fixtures/idor: 9 negatives (all silent) ---
  "idor/negative/01-public-resource-no-owner.ts": [],
  "idor/negative/02-admin-via-middleware.ts": [],
  "idor/negative/03-postgres-rls.ts": [], // sidecar: rls-policy
  "idor/negative/04-supabase-policy.ts": [], // sidecar: rls-policy
  "idor/negative/05-admin-via-decorator.ts": [],
  "idor/negative/06-role-check-in-handler.ts": [],
  "idor/negative/07-rls-via-prisma-extension.ts": [], // sidecar: middleware
  "idor/negative/08-trpc-with-ctx-scoping.ts": [],
  "idor/negative/09-fastapi-ownership-check.py": [],

  // --- fixtures/idor-tenant: 3 positives (03 is a SHORT set) ---
  "idor-tenant/positive/01-express-prisma-query-scope.ts": [
    { ruleId: "idor-express_params-prisma_find_unique", startLine: 18 },
  ],
  "idor-tenant/positive/02-express-prisma-membership.ts": [
    { ruleId: "idor-express_params-prisma_find_unique", startLine: 21 },
  ],
  "idor-tenant/positive/03-fastapi-sqlalchemy-postfetch.py": [
    { ruleId: "idor-fastapi_typed_path_param-node_pg_query", startLine: 26 },
  ],

  // --- fixtures/idor-tenant: 3 negatives (all silent) ---
  "idor-tenant/negative/01-express-prisma-query-scope.ts": [],
  "idor-tenant/negative/02-express-prisma-membership.ts": [],
  "idor-tenant/negative/03-fastapi-sqlalchemy-postfetch.py": [],

  // --- fixtures/idor-multi: 2 flat positives (A has two IDORs; B is a SHORT set) ---
  "idor-multi/A-two-independent-idors.ts": [
    { ruleId: "idor-express_params-prisma_find_unique", startLine: 18 },
    { ruleId: "idor-express_params-prisma_find_unique", startLine: 35 },
  ],
  "idor-multi/B-one-real-one-safe.ts": [
    { ruleId: "idor-express_params-prisma_find_unique", startLine: 21 },
  ],
};

/**
 * No lane pins. See the LANE ANCHORING block in the header: idor's diagnostic
 * exposes only pair 0's verdict and a last-write-wins laneDeferral, so a lane
 * assertion would be lossy on the 14 multi-pair files. Deferred behind the
 * per-pair-diagnostic follow-up, not silently ignored.
 */
const EXPECTED_LANE: Record<string, ExpectedLane> = {};

const setAssertion = findingSetOutcome((id) => EXPECTED_SET[id]);

export const idorReplaySpec: DetectorReplaySpec = {
  detectorId: DETECTOR_ID,
  systemPromptFingerprint: SYSTEM_PROMPT_FINGERPRINT,
  sourceDir: SOURCE_DIR,
  replayDir: REPLAY_DIR,
  manifest: SOURCE_MANIFEST,
  layout: idorLayout,
  makeDetector: (): HarnessDetector => new IdorDetector(),
  expectedFlagged: (id: string): boolean => {
    const v = EXPECTED_FLAGGED[id];
    if (typeof v !== "boolean") {
      throw new Error(`idor: no expectedFlagged for id ${id}`);
    }
    return v;
  },
  expectedLane: (id: string): ExpectedLane | undefined => EXPECTED_LANE[id],
  // Every id uses the exact finding-set assertion. There is no boolean fallback
  // by design: a silent downgrade to `length > 0` is the failure this prevents.
  assertOutcome: (o: OutcomeInput) => setAssertion(o),
};
