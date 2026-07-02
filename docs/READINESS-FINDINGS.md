# Fixor Readiness - Living Defect Ledger

**Status: DIAGNOSIS-ONLY.** Nothing in this file is fixed yet. This is the running
record of every defect surfaced during the production-readiness audit. Each phase
appends here; fixes happen only after the full audit is complete.

Severity scale: **CRITICAL** (ships a false "clean" / exploitable) · **HIGH**
(materially wrong results on the shipped path) · **MEDIUM** (correctness/coverage
gap, bounded blast radius) · **LOW** (hygiene / fail-open by design) · **INFO**
(observation, not yet a defect).

Engines: **A** = CLI (`cli/scan.ts`, whole-file synthetic diff, has route-guard
sidecars). **B** = Webhook + REST API (`workflows/auditor-workflow.ts`, the shipped
product).

---

## Open findings

| ID | Title | Severity | Engine(s) | File:line | Status | Description |
|----|-------|----------|-----------|-----------|--------|-------------|
| F-001 | Cross-file parent-layout auth guard not wired on the shipped webhook/API path | HIGH | B | `workflows/auditor-workflow.ts:371` (detect called with `{diff}` only, no `sidecarsByPath`); cf. `cli/scan.ts:414-422` where Engine A resolves it | **CONFIRMED - STABLE (Phase 3B + 3D repeated-sample)** | Engine A passes `sidecarsByPath[ROUTE_GUARD]` from `resolveRemixRouteGuard`, so a Remix/RR-v7 route gated by an ancestor `_layout.tsx` loader is correctly cleared. Engine B never builds that sidecar, so the same route reaches the LLM with no parent-guard block - the Phase-G false-positive defense is absent on the real product. Measured against a constructed neutral layout-gated fixture (`dashboard+/billing.tsx`, PROVEN-blocking `_layout.tsx` loader, no auth-suggesting naming or comments), **6 runs per engine, byte-identical input (Phase 3D): Engine A cleared 6/6** (isVulnerable=false, LOW, authPresent=yes via sidecar); **Engine B false-positived at HIGH 6/6** (`auth_bypass_risk`, "GET /dashboard/billing", authPresent=no). The divergence is **deterministic**, not a fluke - this is the headline readiness finding on solid repeated evidence. Blast radius: the FP fires specifically on layout-gated routes that do NOT advertise auth in folder name or comments (see F-013). |
| F-002 | Non-LLM detector throw is logged but not counted as degraded coverage | MEDIUM | A (and partially B) | `cli/scan.ts:458-463` (`logger.warn`, continue); cf. `workflows/auditor-workflow.ts:383-395` (Sentry-captured but also continues) | OPEN | If a detector throws for a non-LLM reason (parser bug, unexpected input), the CLI swallows it as a warning and that detector contributes zero findings for that file. The `llm-coverage` integrity gate only catches *LLM-call* failures, so a non-LLM throw does not flip exit code 2 / workflow error - a partially-blind run can still read as clean for that failure class. Engine B captures to Sentry (better) but still does not degrade status. |
| F-003 | `readFileSync` failure yields zero findings with no coverage signal | MEDIUM | A | `cli/scan.ts:465-467` | OPEN | If a file can't be read at scan time (permissions, race, encoding), it is logged at error level and silently contributes no findings. It is not counted as an LLM coverage failure, so the scan's "clean/degraded" verdict and exit code are unaffected - a file that was never analyzed is indistinguishable from a file analyzed and found clean. |
| F-004 | All live-LLM detector tests are excluded from `test:ci` | HIGH | A + B | `package.json:44` (`test:ci`) vs the unwired `test:auth-bypass`, `test:secrets-exposure`, `test:webhook-unverified`, `test:env-exposure`, `test:admin-check`, `test:idor`, `test:*-lane`, `test:layout-guard`, `test:h8-escalation`, `test:real` | OPEN | CI verifies prefilters and plumbing (fixtures, `auth-bypass-prefilter`, diff-parser, webhook-gate, coverage) but never executes a real LLM verdict. The actual detection brain past the regex is unverified by automation - every "detector works" claim rests on manual/memory evidence, not a gate. This is why Phase 3 empirical runs are the only admissible readiness evidence. |
| F-005 | Org-settings lookup failure fails open (all findings pass unfiltered) | LOW | B | `workflows/auditor-workflow.ts:300-309` | OPEN | If `getOrgSettingsForInstallation` throws, the workflow runs with no severity/glob/detector filter and every finding passes. Logged to Sentry. Arguably intended (fail toward reporting, not toward silence) but means a customer's configured suppressions can be silently ignored during a DB blip - note for posture review, not yet confirmed as a defect. |
| F-008 | ~~FALSE NEGATIVE: anonymous arbitrary-resource read missed by every detector~~ **INVALID - Phase-3 zero was a measurement artifact** | ~~HIGH~~ → none | A + B (both catch it) | `app/api/orders/[id]/route.ts` (target); detectors: `idor.detector.ts`, `auth-bypass.detector.ts` | **RESOLVED / INVALID (Phase 3C)** | The original entry - a stable anon-IDOR false negative - does not survive re-measurement. On byte-identical input the `idor` detector flags this anon read at **HIGH in 12/12 runs**: Engine B (shipped `runAuditorWorkflow` + direct) 6/6 (Phase 3B), **Engine A (CLI idor path, `cli/scan.ts:408-438` replication, same demo repo file) 6/6 (Phase 3C)**. `isVulnerable=true, HIGH, callerAuth=unclear, operationClass=user_resource → no lane deferral → emits idor_risk @ line 9`, every run, on both engines. The Phase-3 "ZERO idor findings" could not be reproduced once in 12 attempts, so it is judged a **transient/measurement artifact** (most-likely candidate: a transient `callClaude` failure that run → `null` verdict → no idor finding for that file; such a failure IS tallied by `llm-coverage` but the Phase-3 table recorded it as a clean detector miss). The ledger's stated MECHANISM was also wrong: idor only defers on `callerAuth==="unauthenticated"`, which the prompt reserves for in-signature DI frameworks (FastAPI/Flask); a Next.js middleware-framework route is "unclear", so idor never fell through - it fires. **The anon-IDOR is caught on both engines; there is no F-008 defect.** (auth-bypass independently returns MEDIUM 5/5 → suppressed to review-queue; idor is the sole, reliable emitter.) |
| F-006 | admin-check FALSE POSITIVE on a correctly admin-gated route | MEDIUM | A | `fixor-demo/src/routes/users.ts:8` (target); `admin-check.detector.ts` | OPEN | `usersRouter.post("/:id/promote", requireAuth, ...)` performs an explicit admin check (`ADMIN_EMAILS.includes(req.user.email)` → 403) - it is properly authorized and should be a clean negative. admin-check fired `admin_check_risk` **critical** anyway, reframing the finding as "admin grant via hardcoded email allowlist" (a code-smell, NOT the missing-admin-gate class it ships to detect). Safe-sibling false positive: floods a correctly-gated route with a critical. |
| F-009 | admin-check FALSE POSITIVE / scope-drift onto non-admin-operation endpoints | MEDIUM | A | `fixor-demo-app-router/app/api/debug/env/route.ts:3` (also fired on Express debug pattern); `admin-check.detector.ts` | OPEN | admin-check fired `admin_check_risk` critical on a `GET` env-dump endpoint that performs no administrative operation (manages no users/roles/privilege). admin-check's lane is "missing admin gate on an admin operation"; a data-exposure GET is out of lane. The endpoint is already (correctly) caught by env-exposure - admin-check piling a third critical on it is scope drift. |
| F-010 | secrets-exposure FALSE POSITIVE on an obvious placeholder/fixture value | LOW | A | `fixor-demo-app-router/app/api/config/route.ts:3`; `secrets-exposure.detector.ts` | OPEN | Fired `secrets_exposure_risk` critical on `const NEXT_PUBLIC_OPENAI_KEY = "placeholder-fixture-value-not-real"` - a value that self-identifies as a non-secret and is only used in a `!!key` boolean (never emitted). The NEXT_PUBLIC_ anti-pattern rationale is structurally valid, but a high-precision secrets detector should down-rank an explicit placeholder. Borderline FP; erodes precision on fixture/example code. |
| F-007 | Cross-detector duplicate criticals on the same route/line (no inter-detector merge) | LOW | A + B | `cli/finding-merge.ts` (collapseFindings dedupes by file:line:**type**, not across types); observed on `fixor-demo/src/routes/admin.ts:25`, `app-router settings`+`delete`, `remix delete`, `fastapi users.py:32` | OPEN - **B confirmed empirically (Phase 3B)** | When auth is fully absent on an admin route, auth-bypass AND admin-check both fire on the identical line (and on webhook routes, auth-bypass + webhook-unverified). The auth-bypass code calls this an "honest double-report" by design (only defers when authPresent=yes), but the product surface shows the user two/three criticals for one fix. For env-dump endpoints up to 3 detectors stack. Signal-dilution risk for a security tool; needs a cross-type merge/priority rule at the report boundary. **Phase 3B (CASE 2):** on the shipped path (`runAuditorWorkflow`), the `admin/purge` POST emitted BOTH `auth_bypass_risk` AND `admin_check_risk` at the same line 16 - the double-critical reproduces on Engine B, not just the CLI. |
| F-011 | Corpus gap: no parent-layout-guard instrument exists, so F-001 cannot be measured against the demos | INFO | - | demo repos (none contain a `_layout` loader gating a child route); cf. `test:layout-guard` / `validate:layout-guard-documenso` (external Documenso) | **RESOLVED (Phase 3B)** | The Remix demo's only gated route (`account.profile.ts`) is gated **in-file** by `requireUser`, not by an ancestor layout loader, so the target repos held no F-001 instrument. **Phase 3B built one:** a constructed neutral fixture (`app/routes/dashboard+/{_layout.tsx,billing.tsx}`) with a PROVEN blocking ancestor-layout loader and an un-authed child loader. F-001 is now measured empirically on both engines (see F-001, Phase 3B), not only structurally. Fixture is a scratch construct, not committed to the repo - a permanent regression fixture should be added if F-001 is fixed. |
| F-012 | Cross-run non-determinism on the dangerous anon-IDOR verdict (Phase-3 zero vs Phase-3B 6/6 HIGH) | ~~HIGH~~ | A/B (verdict-layer, shared) | `idor.detector.ts` `callLlm` (temperature 0, Sonnet 4.6); target `app/api/orders/[id]/route.ts` | **REFUTED (Phase 3C)** | Hypothesis: the Phase-3 zero vs Phase-3B 6/6 HIGH indicated intermittent detection of the most dangerous class. **Tested and refuted.** Engine A (CLI idor path) re-run on the byte-identical demo file returned **HIGH 6/6** - no zero, no MEDIUM, no lane deferral; every run `isVulnerable=true, high, emitted idor_risk @ line 9`. Combined with Phase 3B that is **12/12 HIGH** across both engines with zero misses. The verdict is stable at `temperature: 0` on this input; the Phase-3 zero is judged a one-off transient/measurement artifact (see F-008), not a reproducible non-determinism. No decision-stability control is warranted by this evidence. Re-open only if a future run reproduces a zero on this input. |
| F-013 | Engine B masks the F-001 false positive when the route self-advertises auth in naming/comments (hint-dependence) | MEDIUM | B | `workflows/auditor-workflow.ts:371`; `auth-bypass.detector.ts` SYSTEM_PROMPT case 3/4 | OPEN | The F-001 FP is not uniform. Phase 3B ran two layout-gated fixtures through Engine B. **Contaminated** (`_protected+/billing.tsx` with a code comment "auth gating is delegated to the parent layout loader"): Engine B **cleared** it (isVulnerable=false, LOW) by inferring the guard from the folder semantics + the comment - WITHOUT the sidecar. **Neutral** (`dashboard+/billing.tsx`, no such hints): Engine B **false-positived at HIGH**. So on the shipped path the parent-layout FP surfaces precisely on routes that do NOT telegraph their auth in-file (the common case), and is silently suppressed on routes that happen to. This makes the FP rate hint-correlated and hard to predict - and means an in-file comment can accidentally "fix" a scan result. Reinforces that F-001's real defense must be the sidecar, not LLM convention-guessing. |

---

## Verification status legend (filled in Phase 3)

Per detector, per engine: **TP** (caught planted bug), **FN** (missed planted bug -
the dangerous case), **FP** (flagged safe code). A detector is "ready" only on an
empirical TP against its planted target **on both engines**.

### Phase 3 - Engine A (CLI) empirical results

Total Engine A spend: **$0.650** across 63 LLM calls (avg $0.0103/call). All 5 repos
within guardrails (no multi-file repo sustained >$0.02/call; no repo aggregate >$0.30).

| Detector | Engine A result | TP targets caught | FN (missed) | FP (over-fired) |
|----------|-----------------|-------------------|-------------|-----------------|
| auth-bypass | TP across 4 frameworks | demo `admin.ts` delete; app-router `settings` PUT + `delete` POST; remix `delete` action; fastapi `delete_user` | shares F-008 (`orders/[id]` anon read) | duplicates on webhook/env endpoints (F-007) |
| admin-check | TP but noisy | demo+app-router delete/settings; remix `role.ts`; fastapi `set_user_role`; admin-check-verify `promote` | none | **F-006** (gated `promote`), **F-009** (env GET) |
| idor | TP, great discrimination | demo `orders.ts`; fastapi `read_item` (cleared ownership-checked siblings) | ~~F-008 (anon `orders/[id]`)~~ **RETRACTED - Phase 3C re-run flags it HIGH 6/6; the Phase-3 zero here was a transient artifact, not an idor miss** | none |
| secrets-exposure | TP | demo `payments.ts` JWT key | none | **F-010** (placeholder) |
| env-exposure | clean TP | demo `debug.ts`; app-router `debug/env` | none | none |
| webhook-unverified | clean TP + clean negative | app-router `stripe`; remix `stripe` (cleared remix `github` HMAC) | none | none |

Correct true-negatives verified on Engine A: `withAdmin` GET (app-router), `requireUser`
loader (remix `account.profile`), HMAC-verified webhook (remix `github`),
**`loader-factory.server.ts` over-match correctly suppressed** (remix), FastAPI
superuser-gated `/stats`, ownership-checked `delete_item`, scoped `list_own_items`,
own-profile `/me` routes.

---

## Phase 3B - Engine B (Webhook/API) targeted results

**Scope:** three high-value cases run through the REAL shipped path
(`runAuditorWorkflow`, `src/workflows/auditor-workflow.ts`), each recorded against
Engine A. Live per-call cost meter on (patched the singleton Anthropic client;
`calculateCost` per call from `message.usage`). Detection model:
`claude-sonnet-4-6`, `temperature: 0`. **Diagnosis only - no fixes.**

Method note: for CASE 3 the F-001 divergence lives in whether `sidecarsByPath` is
wired. Engine A is exercised via `authBypass.detect({diff, sidecarsByPath})` - the
exact `cli/scan.ts:414-422` sidecar path. Engine B is exercised via
`runAuditorWorkflow(diff)`, whose internal `d.detect({diff})` (line 371) passes no
sidecar. Raw verdicts read from the detector singleton's `lastDiagnostics` after
each run (same instance the workflow drives), so the emitted-finding view and the
raw-verdict view are both captured.

### Case verdicts

| Case | What it tested | Engine A (Phase 3 / sidecar path) | Engine B (shipped `runAuditorWorkflow`) | Verdict |
|------|----------------|-----------------------------------|------------------------------------------|---------|
| **CASE 1** - anon-IDOR `orders/[id]` GET (F-008 target) | Does the shipped path also miss the unauthenticated arbitrary-order read? | Phase 3 recorded ZERO (FN) | **CAUGHT - `idor_risk` HIGH, 6/6 runs.** auth-bypass = MEDIUM 5/5 (suppressed). | **TRUE POSITIVE on Engine B.** Expected FN **not reproduced**; F-008 stable-FN claim refuted → F-012. |
| **CASE 2** - minimal added-lines-only `export const POST` diff | Does the App-Router route-shape prefilter fire when only the handler's added lines are in the diff (no imports/siblings/context)? | n/a (Engine A only sees whole-file synthetic diffs) | **Prefilter fired** (`app_router_route_def`, triggerCount=1) → `auth_bypass_risk` **HIGH** + `admin_check_risk` at line 16. | **TRUE POSITIVE.** The webhook "added-lines-only" reality is handled. Also reproduces F-007 double-critical on Engine B. |
| **CASE 3** - parent-layout-gated Remix route (F-001 instrument) | Engine A clears via sidecar; does Engine B FP without it? | **Cleared (TN)** - isVulnerable=false, LOW, authPresent=yes, via PROVEN blocking `_layout` loader in `sidecarsByPath`. | **Neutral fixture: FALSE POSITIVE - `auth_bypass_risk` HIGH** ("GET /dashboard/billing", authPresent=no). Contaminated fixture: cleared (LLM inferred guard from naming + comment). | **F-001 CONFIRMED** (neutral instrument). Hint-dependence → F-013. |

### CASE 1 determinism probe (identical `idor` input, temperature 0)

| Detector | Runs | isVulnerable | Confidence | Lane facts | Emitted? |
|----------|------|--------------|------------|------------|----------|
| idor | 6/6 (1 workflow + 5 direct) | true | **high** | callerAuth=unclear, opClass=user_resource (no deferral) | **YES - `idor_risk` every run** |
| auth-bypass | 5/5 | true | medium | authPresent=no, opKind=general | no (MEDIUM → review-queue) |

Conclusion: on the shipped path the anon-IDOR is reliably caught by `idor` (HIGH),
not missed. The Phase-3 Engine-A zero could not be reproduced here on byte-identical
input. Either it was cross-session non-determinism (F-012) or the detector changed
since Phase 3; the ledger's stated fall-through mechanism for F-008 is contradicted
by the code and the data. **An Engine-A CLI re-run on the identical file is the one
outstanding confirmation** (not run - Phase 3B stayed within the three authorized cases).

### CASE 3 - contaminated vs neutral (why F-001 needed a clean instrument)

| Fixture | Route hints present | Engine A | Engine B (no sidecar) |
|---------|--------------------|----------|------------------------|
| `_protected+/billing.tsx` (contaminated) | folder name `_protected`, comment "auth delegated to parent layout" | cleared (TN) | **cleared** - LLM guessed the guard from hints (masks F-001) |
| `dashboard+/billing.tsx` (neutral) | none | cleared (TN, isVulnerable=false LOW, PROVEN sidecar) | **FALSE POSITIVE (isVulnerable=true, HIGH)** |

The only difference between the two Engine-B runs is the in-file hints. This isolates
the sidecar's contribution and confirms F-001: absent the sidecar AND absent
suggestive hints, Engine B false-positives at HIGH on a correctly (layout-)gated
read route. See F-013 for the hint-dependence finding.

### F-001 status: **CONFIRMED**

First empirical instrument for the headline divergence. Engine A (with
`sidecarsByPath`) clears a PROVEN-blocking parent-layout-gated read route; Engine B
(the shipped `runAuditorWorkflow`, no sidecar) emits a HIGH `auth_bypass_risk` false
positive on the same route when it carries no auth-advertising naming/comments. The
Phase-G false-positive defense is genuinely absent on the real product.

### Engine B spend (this scope)

| Probe | LLM calls | Spend |
|-------|-----------|-------|
| Probe 1 (CASE 1 + CASE 2 + CASE 3 both engines) | 11 | $0.1332 |
| Probe 2 (CASE 1 determinism ×10 + CASE 3b neutral both engines) | 14 | $0.1384 |
| **Total Engine B (Phase 3B)** | **25** | **$0.2716** |

All calls `claude-sonnet-4-6`; avg ~$0.011/call (cache-read warm calls ~$0.006-0.009,
cold cache-write calls ~$0.015-0.024). No guardrail breach (no call >$0.025; no case
aggregate >$0.10). Budget at Phase-3B start ~$6.32 → **~$6.048 remaining**.

---

## Phase 3C - F-012 settle: Engine A (CLI) idor stability on the identical file

**Question:** was the Phase-3 Engine-A "ZERO idor findings" on `orders/[id]` real
cross-run non-determinism (F-012 CONFIRMED), or a transient artifact (F-012 REFUTED,
F-008 collapses)?

**Method (faithful Engine-A CLI replication).** Read the byte-identical target from
the actual Phase-3 target repo (`fixor-demo-app-router/app/api/orders/[id]/route.ts`,
322 bytes) with `readFileSync`; `buildSyntheticDiff(rel, content)`;
`resolveRemixRouteGuard(absFile)` → null (not under `/routes/`, so no sidecar - same as
Phase 3); `idor.detect({diff})` ×6. This is `cli/scan.ts:408-438` for the idor detector.
Per-call meter on.

**Result: 6/6 flagged HIGH.**

| Run | emitted | isVulnerable | confidence | callerAuth | operationClass | laneDeferral | line |
|-----|---------|--------------|------------|------------|----------------|--------------|------|
| 1-6 | ✔ all 6 | true | high | unclear | user_resource | none | 9 |

triggerCount=2 every run (source `nextjs_destructured` + sink `prisma_find_unique`);
no prefilter skip; no MEDIUM; no lane deferral. Spend: **$0.0548 / 6 calls**.

**Combined evidence (both engines, identical input): 12/12 HIGH, zero misses**
(Engine B 6/6 Phase 3B + Engine A 6/6 Phase 3C).

**Conclusion.**
- **F-012 → REFUTED.** No non-determinism reproduced; the verdict is stable at
  `temperature: 0`.
- **F-008 → RESOLVED / INVALID.** The anon-IDOR is caught reliably on **both** engines.
  The Phase-3 zero is a one-off transient/measurement artifact (leading candidate: a
  transient `callClaude` failure → `null` idor verdict → no finding, mis-recorded in the
  Phase-3 table as a clean detector miss rather than a coverage failure). The ledger's
  original causal story (idor "assumes auth-present + ownership gap") was contradicted by
  both the code and 12/12 runs and has been corrected in the F-008 row.
- **Process note:** the Phase-3 artifact was invisible because a single unrepeated run was
  recorded as a stable verdict. A defensible readiness bar should require repeated sampling
  for any HIGH/critical FN or FP before it is entered as stable - a single sample of an
  LLM verdict is not a verdict. (This is the same lesson that turned CASE 1/CASE 3 from
  one-shot into multi-run here.)

Total F-012-settle spend (Phase 3C): **$0.0548** across 6 calls. Cumulative Engine-A+B
empirical spend, Phase 3B+3C: **$0.3264** (25 + 6 = 31 calls).

---

## Phase 3D - F-001 repeated-sample stability (neutral fixture, both engines ×6)

**Question:** is the F-001 divergence deterministic, or an intermittent fluke? (F-001 was
the only critical resting on a single run against a single neutral fixture, and it is the
load-bearing basis of the verdict.)

**Method.** `app/routes/dashboard+/billing.tsx` (544 bytes; PROVEN-blocking ancestor
`_layout.tsx` loader; NO auth hints in folder name or comments), byte-identical input,
6 runs per engine. Engine A = `authBypass.detect({diff, sidecarsByPath})` (sidecar wired).
Engine B = `runAuditorWorkflow(diff)` (no sidecar). Per-call meter on.

| Engine | Path | Runs | Outcome |
|--------|------|------|---------|
| A | sidecar / route-guard | 6/6 | **CLEARED (TN)** - isVulnerable=false, LOW, authPresent=yes, every run |
| B | `runAuditorWorkflow`, no sidecar | 6/6 | **FALSE POSITIVE, HIGH** - `auth_bypass_risk` emitted, every run |

**F-001 → CONFIRMED STABLE.** The divergence is deterministic: with the sidecar the route
is a clean true-negative; without it (the shipped webhook path) it is a HIGH false positive
on a correctly-gated route, every single run.

**F-007 co-fire on this fixture: 0/6.** admin-check did NOT co-fire - correctly, because a
read-only loader is not a missing-admin-gate operation. This is a *correct-negative* for
admin-check, not a counter-example to F-007: F-007's double-critical reproduces on
administrative operations (CASE 2 `admin/purge` POST; Phase-3 repos), not on this read
route. Recorded here so the F-007 evidence base is not overstated.

Spend (Phase 3D): **$0.2310** across 24 calls. Cumulative empirical (3B+3C+3D):
**$0.7574** across 55 calls; budget from ~$6.32 → **~$5.56 remaining**.

_Phase 5 (final readiness verdict) - proceeding per directive; see
`READINESS-AUDIT.md`._
