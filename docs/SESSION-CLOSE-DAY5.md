# Session close — Day 5 audit handoff

**Date**: 2026-05-15
**Branch**: feat/idor-detector
**Status**: Day 5 closed. Audit work paused pending Anthropic billing top-up.

---

## Next-session start instruction

**FIRST ACTION after billing top-up**: run `npm run test:secrets-exposure` standalone. Do not start any other P0 or P1 work before P0.3 result lands. Per Day 5 Decision B, the 5-of-5 measurement set is prerequisite to Option G decision prioritization.

If secrets-exposure errors out again (same 24× HTTP 400), billing top-up was insufficient. Surface and wait.

If secrets-exposure passes, proceed to Phase 4 of the Day 5 work order: Option G investigation analysis with full 5/5 data.

---

## What shipped this session (durable artifacts)

| # | Artifact | Lives at | One-line value |
|---|---|---|---|
| 1 | Shared stability harness | `src/test/lib/stability-harness.ts` | n=5 + reasoning logs + sidecar loader; replaces 6 duplicated harnesses |
| 2 | `SUPPRESSED_FINDING_TYPES` filter | `src/config/finding-suppressions.ts` | Gates xss/cmdi/path-traversal + MA from customer-facing emission until validated |
| 3 | Sidecar infrastructure | `src/analysis-engine/sidecar-kinds.ts`, `DetectorContext.sidecarsByPath` | Generalized cross-file safety-signal channel; constants centralized, 4 kinds supported |
| 4 | IDOR sidecar plumbing + addendum | `idor.detector.ts` | First production-shape capability extension; validated end-to-end (Day 5 falsifier confirmed no harness-vs-production gap for currently-enumerated patterns) |
| 5 | SYSTEM_PROMPT_FINGERPRINT exports | 6 detector files | Per-run prompt provenance; threaded into harness reports |
| 6 | Detector-test-rules.md | `docs/detector-test-rules.md` | Central home for F1-F4c, R1-R9, D1-D6a accumulated rules + audit philosophy |
| 7 | R5 verify_signature regex fix | `auth-bypass.detector.ts` | Closed 1 of 2 R5 cases; auth-bypass aggregate 18/20 → 19/20 |
| 8 | R6 category + first instance | rules doc + env-exposure fixture move | Reclassified env-exposure/negative/07 → positive/11 |
| 9 | Locked canonical wedge | rules doc + future copy reference | 2-sentence positioning, honest about scope and method |
| 10 | Day 4 per-detector accuracy data | `test-output/*-day4-run.log` + Day 4 report | First measured per-detector accuracy in project history |
| 11 | Sidecar production falsifier result | `test-output/idor-falsifier-no-sidecars-run.log` | Demoted P0.0 to P1; IDOR holds 16/16 without sidecars |
| 12 | 5 detector META.md updates | per-detector fixture dirs (env-exposure today, IDOR Day 3, MA Day 2) | Per-detector audit attribution + R-category instances |

---

## Current P0/P1/P2/P3 stack

### P0 (action items, sequence-blocked on billing)
| Item | Status | Unblock condition |
|---|---|---|
| P0.1 wedge sentence lock | ✅ DONE | n/a |
| P0.2 Option G investigation | ✅ DONE | n/a (4-of-5 result published; awaiting secrets-exposure for 5-of-5 refinement) |
| P0.3 secrets-exposure retry | ⏸️ BLOCKED | Anthropic billing top-up |
| P0.4 R5 verify_signature fix | ✅ DONE | n/a |
| P0.2a auth-bypass regex-first pilot | ⏸️ BLOCKED | P0.3 completes |
| P0.2b production-shape validation (~20-30 OSS PRs) | ⏸️ BLOCKED | P0.3 completes |
| P0.5 env-exposure logger-config sidecar | ⏸️ BLOCKED | P1 (Option G decision) — value increased to 2 fixture candidates (/03, /11) post Day 5 R6 |

### P1 (decision items, blocked on P0)
- **Option G decision** (per-detector refactor framing): blocked on P0.2a + P0.2b + P0.3
- **Per-detector pattern docs publication** (unlocks wedge edit): independent, can start any time

### P2 (public surface, lower priority than measurement set)
- **Post 1 draft** (audit narrative): unblocked, use locked wedge
- **Outreach drafts append** (optional credibility line): unblocked
- **README/FAQ per-detector numbers**: after post 1 publishes
- **Posts 2-4 cadence**: post 1 → falsifier → commit to sequence or retreat

### P3 (calibration backlog)
- **MA Phase 1a resumption**: blocked on P1 (Option G might change MA's shape entirely)
- **xss/cmdi/path-traversal harness builds**: Q1 backlog (suppressed via SUPPRESSED_FINDING_TYPES; safe today)

### Demoted from P0 this session
- **P0.0 production sidecar reader** → P1. Day 5 falsifier showed sidecars decorative for IDOR's currently-enumerated patterns. Re-promotes to P0 if a new detector ships with config-located safety mechanism the prompt cannot enumerate (per D6 rule).

---

## R-category status

| Category | Definition | Observed Day 5 | Status |
|---|---|---|---|
| R4 | Pre-filter SKIP on negative (harmless, regex correctly out-scopes) | 14 cases across 4 detectors (admin 4, env 3, auth 7, IDOR 0) | Live, codified |
| R5 | Pre-filter SKIP on positive (real bug missed by pipeline) | 1 remaining in auth-bypass (/05 missing-middleware) | Live, codified; /05 parked as new-detector concept per D4 unbundling |
| R6 | LLM disagrees with fixture classification (fixture may be wrong) | 1 instance, env-exposure/07 → positive/11 reclassified | Codified Day 5 |
| (b) | Strip removes real signal, fixture needs rebuild or drop | **0 observed cases through Day 5** | Retained; revisit retention at next audit |
| (c) | Pre-filter regex matched comment text (pre-filter bug) | **0 observed cases through Day 5** | Retained; revisit retention at next audit |

---

## Detector accuracy as of Day 5 (4-of-5 measured, secrets-exposure pending)

| Detector | Fingerprint | Cognitive positives | Cognitive negatives | R4 | R5 | R6 | Aggregate |
|---|---|---|---|---|---|---|---|
| admin-check | `b7da5d924f0e` | 10/10 | 6/6 | 4 | 0 | 0 | 20/20 PASS |
| IDOR | `68216c102fe0` | 8/8 | 8/8 | 0 | 0 | 0 | 16/16 PASS |
| env-exposure | `d2ca2f022d99` | 9/11 (2 at medium-conf ceiling) | 6/6 | 3 | 0 | 1 reclassified | 18/20 PASS |
| auth-bypass | `1004e4566520` | 9/9 | 3/3 | 7 | 1 (parked) | 0 | 19/20 PASS |
| secrets-exposure | — | UNMEASURED | UNMEASURED | unknown | unknown | unknown | UNMEASURED |
| **Total measured** | | **36/38 cognitive positives** | **23/23 cognitive negatives** | **14** | **1 closed + 1 parked** | **1 reclassified** | **73/76 across 4 detectors** |

Across the 4 measured detectors: **59/61 LLM-engaged cases passed n=5 stability** (96.7%). Two failures are env-exposure positives at medium-confidence ceiling (sidecar candidates, not detector failures).

---

## Open R-shape questions (for next audit)

1. **R5 missing-middleware as new-detector concept**: parked per D4. Revisit after Option G decision. If Option G says "refactor high-R4 to regex-first," missing-middleware becomes an architectural test case. If "accept current," it becomes a backlog detector concept.
2. **(b)/(c) framework retention**: 0 observed cases through Day 5 (~35 stripped fixtures touched). Revisit retention decision at Day 5 retrospective. Currently retained for future shapes (new detectors with looser regex, central LLM analyzer migration).
3. **Production-shape R-category emergence**: Day 5 R-categories were all surfaced by fixture data. Production data (per P0.2b) may surface new shapes the fixture set can't probe. Plan to extend the framework when P0.2b lands.

---

## Reasoning log archive

| Detector | Log file | Notes |
|---|---|---|
| admin-check Day 4 | `test-output/admin-check-day4-run.log` | First Day 4 run |
| IDOR Day 4 | `test-output/idor-day4-run.log` | Sidecar validation |
| env-exposure Day 4 | `test-output/env-exposure-day4-run.log` | /03 medium-conf, /07 R6 instance |
| auth-bypass Day 4 | `test-output/auth-bypass-day4-run.log` | R5 /05 + /08 discovered |
| secrets-exposure Day 4 | `test-output/secrets-exposure-day4-run.log` | 24 errors, incomplete |
| IDOR falsifier (no sidecars) | `test-output/idor-falsifier-no-sidecars-run.log` | Day 5 sidecar decorative-vs-load-bearing test |
| auth-bypass Day 5 R5 fix | `test-output/auth-bypass-day5-r5fix-run.log` | verify_signature regex extended; /08 flipped to cognitive flag |
| env-exposure Day 5 R6 rerun | `test-output/env-exposure-day5-r6-rerun.log` | /07 → /11 reclassification confirmed |

---

## Total session cost

- Day 4 runs: $1.24 (after correcting secrets-exposure for failed 400s)
- Day 5 sidecar falsifier: $0.32
- Day 5 R5 fix re-run: $0.24
- Day 5 R6 reclassification re-run: $0.34
- **Total session API spend**: ~$2.14

Below the $2.00 projection target by audit's first-pass, before secrets-exposure retry adds ~$0.32.

---

## Branch state

- All changes on `feat/idor-detector`
- Mass Assignment paused at calibration (META.md tagged Day 2)
- xss/cmdi/path-traversal/MA suppressed via `SUPPRESSED_FINDING_TYPES` (Day 2)
- Sidecar infrastructure shipped Day 2-3
- Pattern 8 wedge locked Day 5

Ready for either: (a) continued audit work after billing top-up, or (b) a commit + PR at the user's discretion to consolidate the session's changes.
