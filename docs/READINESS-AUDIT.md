# Fixor Production-Readiness Audit

> **VERDICT: NOT-READY (temporary)** - gated on closing F-001. Recall is clean (no missed exploit survives re-measurement), but the shipped webhook path deterministically emits a HIGH false positive on a correctly parent-layout-gated route, and for a security tool that verdict-credibility risk is ship-blocking on its own.

Date: 2026-07-01 · Basis: reconciled defect ledger `READINESS-FINDINGS.md` (Phases 3, 3B, 3C, 3D). Diagnosis only - no fixes applied. Detection model `claude-sonnet-4-6`, `temperature: 0`. Two engines audited: **A** = CLI (`cli/scan.ts`, whole-file synthetic diff, resolves route-guard sidecars); **B** = Webhook + REST API (`workflows/auditor-workflow.ts`, the shipped product).

---

## Executive summary

- **Recall (the dangerous direction) is clean.** Every one of the 6 shipping detectors produced a true positive against its planted target. The single alleged false negative in the corpus - the unauthenticated arbitrary-order read (`orders/[id]` GET, ex-F-008) - was **re-measured 12/12 HIGH across both engines** and is a reliably-caught bug; the original "zero" was a one-off transient/measurement artifact, and the ledger's causal story for it was wrong (corrected). No confirmed missed-exploit remains.
- **The shipped path (Engine B) has one real, deterministic defect: F-001.** A Remix/RR-v7 route whose auth lives in an ancestor `_layout.tsx` loader is correctly cleared by Engine A (which wires the route-guard sidecar) but **false-positives at HIGH on Engine B 6/6 runs** (the workflow never builds the sidecar). This is a common framework pattern, so the blast radius is real for Remix-heavy customers.
- **Precision and signal-hygiene issues remain** (admin-check FPs F-006/F-009, secrets placeholder FP F-010, cross-detector duplicate criticals F-007, hint-dependent FP masking F-013).
- **Evidentiary/process gaps:** no CI executes a live LLM verdict (F-004); non-LLM detector throws and unreadable files don't degrade the scan status (F-002/F-003), so a partially-blind run can still read as clean. The F-008 phantom demonstrated exactly this class of risk - a single unrepeated sample was recorded as a stable verdict.
- **Engine-B empirical coverage is partial.** Only `idor` and `auth-bypass` (plus `admin-check` incidentally) were exercised on the real webhook path; `secrets-exposure`, `env-exposure`, `webhook-unverified` are inferred-equivalent on B from shared `detect()` code but were not sampled on B.

---

## Detector scorecard

Legend: **TP** caught planted bug · **FP** flagged safe code · **TN** correctly cleared · recall/precision from Phase 3 (Engine A) and Phases 3B-3D (Engine B).

| Detector | Engine A (CLI) | Engine B (webhook) | Precision issues | Ready? |
|----------|----------------|--------------------|------------------|--------|
| **idor** | TP + strong discrimination (`orders.ts`; fastapi `read_item`; cleared ownership-checked siblings). Anon read HIGH 6/6 | Anon read HIGH 6/6 (shipped path) | none observed | **Yes** - best-evidenced, both engines |
| **auth-bypass** | TP across 4 frameworks (demo `admin.ts`, app-router `settings`/`delete`, remix `delete`, fastapi `delete_user`) | TP on added-lines-only POST diff (CASE 2); **but F-001 HIGH FP 6/6 on layout-gated read** | F-001 FP (B); F-007 duplicate criticals | **Constrained** - recall good; F-001 FP blocks clean |
| **admin-check** | TP (demo/app-router delete/settings, remix `role.ts`, fastapi `set_user_role`, `promote`) | Co-fired TP on `admin/purge` POST (CASE 2); correctly silent on read loader 6/6 (3D) | **F-006** (gated `promote` FP), **F-009** (env-GET scope drift), F-007 dup | **Constrained** - noisy / over-fires |
| **secrets-exposure** | TP (`payments.ts` JWT key) | not sampled on B | **F-010** (placeholder FP) | **Constrained** - minor precision |
| **env-exposure** | clean TP (`debug.ts`, `debug/env`) | not sampled on B | none | **Yes** (A); B unverified |
| **webhook-unverified** | clean TP + clean negative (stripe fired, github HMAC cleared) | not sampled on B | none | **Yes** (A); B unverified |

Engine-A true-negatives held: `withAdmin` GET, in-file `requireUser` loader, HMAC-verified webhook, `loader-factory.server.ts` over-match suppressed, FastAPI superuser-gated `/stats`, ownership-checked `delete_item`, scoped `list_own_items`, own-profile `/me`.

---

## Findings, ranked by severity

### HIGH

- **F-001 - Parent-layout auth guard not wired on the shipped webhook path.** `workflows/auditor-workflow.ts:371` (`d.detect({diff})`, no `sidecarsByPath`) vs `cli/scan.ts:414-422` (Engine A resolves it). **CONFIRMED STABLE:** neutral layout-gated fixture, 6 runs/engine - Engine A cleared 6/6 (TN), Engine B false-positived HIGH 6/6 (`auth_bypass_risk` on a correctly `_layout`-gated read route). Deterministic. Headline finding.
- **F-004 - No live-LLM detector test in CI.** `package.json:44` (`test:ci` runs prefilters/plumbing only; every `test:*` that executes a real verdict is unwired). The detection brain past the regex is ungated by automation; all recall claims rest on manual/phase runs, not CI.

### MEDIUM

- **F-002 - Non-LLM detector throw not counted as degraded coverage.** `cli/scan.ts:458-463` (warn+continue); `workflows/auditor-workflow.ts:383-395` (Sentry+continue). A parser/unexpected-input throw yields zero findings for that detector without flipping the integrity gate - a partially-blind run can read as clean.
- **F-003 - `readFileSync` failure yields zero findings with no coverage signal.** `cli/scan.ts:465-467`. A file never analyzed is indistinguishable from a file analyzed-and-clean; exit code/verdict unaffected.
- **F-006 - admin-check FP on a correctly admin-gated route.** `fixor-demo/src/routes/users.ts:8` (`/:id/promote` with `ADMIN_EMAILS.includes(...)` → 403). Fires critical anyway, reframing a correct gate as a code-smell.
- **F-009 - admin-check FP / scope drift onto non-admin GET.** `fixor-demo-app-router/app/api/debug/env/route.ts:3`. Fires critical on an env-dump GET that performs no admin operation (already covered by env-exposure) - out of lane.
- **F-013 - Engine B masks the F-001 FP when the route self-advertises auth in naming/comments.** `workflows/auditor-workflow.ts:371`; `auth-bypass.detector.ts` SYSTEM_PROMPT case 3/4. Contaminated fixture (`_protected+` + comment) cleared on B; neutral fixture false-positived. The FP rate is hint-correlated and unpredictable; an in-file comment can accidentally change a scan result.

### LOW

- **F-005 - Org-settings lookup fails open (all findings pass unfiltered).** `workflows/auditor-workflow.ts:300-309`. A DB blip silently ignores a customer's configured suppressions. Arguably intended (fail toward reporting); flagged for posture review.
- **F-007 - Cross-detector duplicate criticals on one line (no inter-detector merge).** `cli/finding-merge.ts` (dedupes by file:line:**type**, not across types). **Confirmed on Engine B** (CASE 2 `admin/purge` POST emitted `auth_bypass_risk` + `admin_check_risk` at line 16). Up to 3 detectors stack on env-dump endpoints. Signal dilution for a security tool.
- **F-010 - secrets-exposure FP on an obvious placeholder.** `fixor-demo-app-router/app/api/config/route.ts:3` (`"placeholder-fixture-value-not-real"`, used only in `!!key`). Erodes precision on fixture/example code.

### Resolved / Invalid (recorded for transparency; do not carry forward)

- **F-008 - RESOLVED/INVALID.** Alleged stable anon-IDOR false negative; re-measured 12/12 HIGH across both engines. The Phase-3 zero was a transient artifact; the stated mechanism was wrong. No defect.
- **F-012 - REFUTED.** Hypothesised non-determinism on the anon-IDOR verdict; Engine A re-run 6/6 HIGH, no zero reproduced. Verdict is stable at `temperature: 0`.
- **F-011 - RESOLVED.** Corpus gap (no layout-guard instrument) - a neutral fixture was constructed in Phase 3B/3D; F-001 is now empirically measured, not only structural.

---

## Ordered remaining work to reach clean READY

1. **Fix F-001 (blocker).** Wire the route-guard sidecar on the shipped path: have the webhook/GitHub-App scan input resolve ancestor `_layout` guards (as `cli/scan.ts` does via `resolveRemixRouteGuard`) and pass `sidecarsByPath` into `d.detect(...)` at `auditor-workflow.ts:371`. Add the neutral fixture (`dashboard+/{_layout.tsx,billing.tsx}`) as a permanent regression test asserting Engine-A-clears / Engine-B-clears parity.
2. **Fix F-004 (blocker).** Add at least one live-LLM detection test per detector to a gated CI lane (or a nightly required check), so recall/precision regressions are caught by automation rather than manual phase runs. Include a repeated-sample assertion (N≥3) so a single flaky verdict can't masquerade as stable (the F-008 lesson).
3. **Close the coverage-integrity gaps F-002 / F-003.** Count non-LLM detector throws and unreadable files as degraded coverage so a partially-blind run cannot present as `no_action`/`success`/clean - mirror the existing `llm-coverage` fail-loud posture.
4. **Tighten admin-check precision (F-006, F-009).** Suppress when an explicit admin gate is present (F-006) and stay in lane on non-admin operations / data-exposure GETs (F-009), so correctly-gated and out-of-lane routes stop drawing criticals.
5. **Add a report-boundary cross-type merge/priority rule (F-007).** Collapse multiple criticals on one file:line into a single ranked finding so one fix isn't shown as two or three criticals.
6. **Down-rank explicit placeholders in secrets-exposure (F-010).** Recognise self-identifying non-secret values to preserve precision on example/fixture code.
7. **Decide F-005 posture.** Confirm whether org-settings fail-open is intended; if so, surface a visible "suppressions not applied (settings unavailable)" signal rather than silently passing everything.
8. **Extend Engine-B empirical coverage.** Sample `secrets-exposure`, `env-exposure`, `webhook-unverified` through `runAuditorWorkflow` to convert their "inferred-equivalent on B" status into measured parity, and address F-013 as part of the F-001 fix (the sidecar, not LLM convention-guessing, must be the defense).

Items 1-2 gate a clean READY. Items 3-8 are required to clear the constraints but do not, on current evidence, represent shipped false-clean risk.

---

## Evidence basis

Empirical spend this audit (live metered LLM calls, `claude-sonnet-4-6`): Phase 3 (Engine A corpus) $0.650 / 63 calls; Phases 3B-3D (Engine B targeted + stability) $0.7574 / 55 calls. No guardrail breach in the targeted phases (no call >$0.025; no case aggregate >$0.10). All Phase-3B-3D verdicts are repeated-sample where they are load-bearing (idor anon read 12/12; F-001 6/6 per engine). This audit is diagnosis-only; no code was modified.
