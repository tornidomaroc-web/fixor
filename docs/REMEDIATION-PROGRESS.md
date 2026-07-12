# Fixor Remediation Progress - Living Roadmap and Status

Snapshot date: 2026-07-10. This file is the cross-session source of truth for what
is done, what is in review, and what is deferred, so no step is silently skipped or
repeated. It is built strictly from the reconciled ledger (`READINESS-FINDINGS.md`),
the audit (`READINESS-AUDIT.md`), and what has actually happened in these sessions.
An open PR is "in review," never "done."

## How we work (guardrails inherited by every session)

- Diagnosis before code. Understand the real code first; do not write a fix until the
  approach is chosen deliberately.
- One step at a time, each one explicitly commanded. If there is no command, stop and
  wait.
- Branch, then PR, then merge by the owner's command. Never the web UI. Never a direct
  commit to protected `main` (it is blocked by the gate anyway).
- No API spend in CI. Live LLM detection is opt-in only and never runs on push.
- Repeated sampling before any HIGH or critical verdict is entered as stable. A single
  LLM sample is not a verdict (the F-008 lesson).
- Every step verified mechanically (process exit codes, API read-backs), not by
  assumption and not by trusting a PASS line in stdout.
- Two gates are kept labeled distinctly: a green deterministic gate proves wiring and
  parsing, not detection quality. Only an opt-in live run verifies model judgment.
- No em dash in human-facing text we author.

## Recording-cost lessons (read this BEFORE the next recording session)

Learned the expensive way on 2b.3. These apply directly to 2b.4 (idor) and 2b.5.

1. **Record every fixture for a detector in ONE process.** Each new recorder process re-pays
   the system-prompt cache-write premium: the first call of a process writes the cached
   system block, every later call in that process reads it. For admin-check that premium was
   about $0.0136 (owner-reported). Splitting the first admin-check attempt into batches to
   enforce a spend ceiling cost roughly $0.027 extra for nothing. Batch, do not chunk.

   This holds for EVERY detector, not only long-prompted ones: the premium is paid once per
   process regardless of size, and it is the process count, not the prompt length, that the
   batching decision controls.

2. **Measured `SYSTEM_PROMPT` lengths (corrected; see the methodology note below).**
   Measured from the intercepted `callClaude` request payload - the exact text
   `cachedSystem()` puts on the wire - and independently verified three ways: the sha256 of
   the captured text matches each detector's exported `SYSTEM_PROMPT_FINGERPRINT`, and both
   match the `meta.systemPromptFingerprint` frozen into all 118 committed recordings.

   | detector | chars | approx tokens | fingerprint |
   |---|---|---|---|
   | env-exposure | 1,339 | 335 | `d2ca2f022d99` |
   | idor | 8,092 | 2,023 | `5f5129f12b11` |
   | webhook-unverified | 8,696 | 2,174 | `c2c5deba87c9` |
   | admin-check | 13,353 | 3,338 | `ed52ebe3db91` |
   | auth-bypass | 14,237 | 3,559 | `45a17ae07c26` |

   **Correction, and what it invalidates.** A previous revision of this file (PR #93) stated
   that admin-check's prompt is 1637 characters against auth-bypass's 399, and reasoned that
   admin-check therefore pays a bigger cache-write premium. Both numbers were wrong and the
   comparison is INVERTED: auth-bypass's prompt (14,237) is LARGER than admin-check's
   (13,353). That causal story is withdrawn - it explains nothing, and any per-detector cost
   intuition built on it should be discarded.

   What the evidence DOES support: the measured ~$0.0136 premium corroborates 13,353 chars.
   At sonnet rates, 3,338 tokens x ($3.75 - $0.30)/Mtok is about $0.0115 - the right order.
   A 1,637-char prompt would imply about $0.0014, ten-fold off. So the SPEND measurement was
   right; the character count written beside it was wrong. The measurement refuted the
   number, not the other way round.

3. **METHODOLOGY, durable trap: never measure a prompt by regex over source.** The wrong
   figures came from a non-greedy capture, `SYSTEM_PROMPT.*=\s*` + backtick + `(.*?)` +
   backtick, run over the `.ts` source. Every detector's prompt embeds markdown code fences,
   so the capture terminated at the first backtick of the first fence and returned a prefix.
   It fails silently and returns a plausible-looking number. Measure the prompt from the
   actual request payload (spy on `callClaude`, read `system[0].text`), then confirm the
   sha256 prefix equals the detector's exported `SYSTEM_PROMPT_FINGERPRINT`. If those two
   disagree, the capture is wrong, not the constant.

4. **Do NOT trust the harness's own "projected manifest" figure.** `replay-harness.ts:494`
   prints `~$(avg * spec.manifest.length)`, where `avg` is the mean over calls measured SO
   FAR. Early in a run that mean still carries the cold cache-write outlier, so the
   projection is systematically inflated and drifts as the run warms. On 2b.3 it projected
   ~$0.3914, then ~$0.2407; the measured total was $0.28092. It over-shot, then under-shot,
   and was never right. Bound the worst case yourself as
   `(n x highest observed warm call) + one cache-write premium`, then report the MEASURED
   total, never the projection.

5. **Cumulative F-004 recording spend to date: about $0.977.**
   2a $0.133 + 2b.1 $0.248 + 2b.2 $0.31472 + 2b.3 $0.28092 = $0.97664. The 2a figure is
   itself recorded as an approximation ("~$0.133"), so the trailing digits of that sum are
   false precision; treat it as ~$0.98.

   **Provenance caveat (important).** These four numbers are owner-reported record-time
   observations read off recorder stdout. They are NOT reproducible from this repo: the
   recorder persists no cost or token data (a recording's `meta` carries only `detectorId`,
   `model`, `systemPromptFingerprint`, `recordedAtIso`, `sourceFixture`, `expectedFlagged`,
   and the response carries no `usage` block). Anyone auditing these figures must re-run the
   recorder and spend money. They are logged here as testimony, not as verified fact.

   Note the asymmetry this file now records: the SPEND figures are testimony (nothing in the
   repo can check them), while the PROMPT-LENGTH figures in item 2 are repo-verifiable and
   were verified. Do not let the caveat on the former leak onto the latter.

6. **2b.5 (secrets-exposure) is expected to cost $0.** `detectors/registry.ts:51` constructs
   `new SecretsExposureDetector()` with no options, so `llmValidation` is false and the
   shipped path is regex-only. Guard it deterministically, exactly as admin-check bucket (b)
   was guarded. There is no `callClaude` request to record, so there is nothing to pay for.

7. **Recordings must be keyed to LF content; sidecar readers now normalize (learned on 2b.4).**
   The replay key hashes `messages` with no EOL normalization. `loadFixture` LF-normalizes the
   primary fixture, but until 2b.4 the two sidecar readers (`readCompanionSidecars`,
   `loadFixtureSidecars`) read raw bytes, so a Windows (CRLF) recording produced a different key
   than a Linux (LF) checkout, and the three sidecar-carrying idor negatives (03, 04, 07) missed
   on CI (fixed in PR #97). RESOLVED for idor and generally: the shared `lfNormalize()` now
   covers ANY sidecar-carrying corpus (for example a future secrets-exposure sidecar), and
   `.gitattributes` pins the idor corpora to LF. The fix itself was zero model spend (rename plus
   the top-level `key` field on three recordings, response bodies byte-identical, no re-record).
   Lesson for 2b.5 and beyond: record on and key to LF content; the shared helper makes the key
   OS-stable, but a new fixture corpus should still get an `eol=lf` pin.

8. **The cache premium is paid once per DETECTOR, not once per process (measured).**
   Item 1 above is correct for a single-detector recording batch, where every call shares one
   system prompt. It does NOT generalize. Prompt caching is a prefix match keyed on the system
   prompt, so a process that invokes N distinct detectors writes N distinct cache entries.
   Measured on the first live scan: one warm process, three detectors, `cache_read = 0` on all
   three calls, three separate cache writes, zero reuse. The worst-case formula in item 4 must
   therefore read `(n x highest observed warm call) + one cache-write premium PER DISTINCT
   DETECTOR`. See "Live detection-quality measurements" below for the numbers.

## Live detection-quality measurements

The first live measurement of detection QUALITY (not wiring) on real third-party code.
Distinct from the recording-cost lessons above: those concern fixture recording, this concerns
whether the shipped detectors actually find real bugs.

### Run 1 - scan-and-action backend, 4 files (first live run)

Target: a read-only clone of the `tornidomaroc-web/scan-and-action` backend. Scope was four
files chosen for known vulnerability shape:
`apps/backend/src/controllers/documentController.ts` (385 LOC; mixed IDOR, two unscoped sites,
`where: { id: id as string }` at line 191 and `where: { id: documentId }` at line 333,
alongside correctly scoped `where: { id, organizationId }` sites),
`apps/backend/src/controllers/webhookController.ts` (a correctly verified Paddle HMAC webhook),
`apps/backend/src/routes/documentRoutes.ts` (routes guarded only by a parent-mounted global
`authMiddleware`), and `apps/backend/src/middleware/authMiddleware.ts`.

Driven through the real `cli/scan.ts` detector loop (`SHIPPING_DETECTOR_IDS` filter plus
`resolveRemixRouteGuard`), one warm process, shipped path only: `FIXOR_ESCALATE_MEDIUM`,
`FIXOR_ADMIN_CHECK_LLM_OPT_IN`, and `FIXOR_SECRETS_LLM_OPT_IN` all unset. Call count was
predicted first by a zero-call stubbed dry run and matched exactly.

**Calls: 3 of a possible 24** (6 detectors x 4 files). All others short-circuited at their
prefilters.

| # | detector | file | input | output | cache write | cache read | cost |
|---|---|---|---|---|---|---|---|
| 1 | idor | documentController.ts | 4,839 | 467 | 2,671 | 0 | $0.031538 |
| 2 | auth-bypass | documentRoutes.ts | 1,280 | 364 | 4,495 | 0 | $0.026156 |
| 3 | admin-check | documentRoutes.ts | 1,449 | 227 | 3,967 | 0 | $0.022628 |
|   |  | **total** |  |  |  |  | **$0.080323** |

**MEASURED total spend: $0.080323.** This is measured, not attested: computed from the raw
`message.usage` on each API response at $3/$15 per Mtok with a 1.25x cache-write and 0.10x
cache-read multiplier. Fixor's own `calculateCost()` (`services/cost-tracking.service.ts`)
agreed to the last decimal on all three calls, which independently validates its price table.
Note the contrast with the recording-spend figures in the section above: those are owner
testimony, this one is reproducible from the response payloads.

A pre-run estimate of about $0.04 was made and was WRONG by 2x. It assumed a warm process
would amortize the system-prompt cache across the run. It does not (see the cost-model
correction below). Record the measured number; the estimate is retained only as the thing the
run disproved.

### Cost-model correction (amends "Recording-cost lessons" items 1 and 4)

`cache_read` was **0 on all three calls**. Prompt caching is a prefix match keyed on the system
prompt, and the three calls come from three DIFFERENT detectors with three DIFFERENT system
prompts. They are three separate cache entries with zero reuse.

- A single warm process does NOT amortize the cache across distinct detectors. It amortizes
  only across repeated calls to the SAME detector. Lesson 1's "record every fixture for a
  detector in ONE process" is still correct, because that is a single-detector batch. Its
  generalization ("the premium is paid once per process regardless of size") is not: a
  multi-detector process pays once PER DETECTOR.
- The write premium was therefore paid 3x and bought nothing. Its true magnitude is the 0.25x
  surcharge over base on the cached tokens: 11,133 tokens x $3/Mtok x 0.25 = **$0.008350**
  across the whole run. That is the real size of the "premium", not the ~$0.0136 per-process
  figure, which measured something else (a whole cache write, not the surcharge).
- Lesson 4's worst-case formula, `(n x highest observed warm call) + one cache-write premium`,
  under-counts any multi-detector run. It needs one premium PER DISTINCT DETECTOR invoked.

**This run measured a COLD-call unit, not a warm-call unit.** Mean $0.0268, range $0.0226 to
$0.0315, all three calls cold. Zero cache reuse was structurally guaranteed here because each
detector fired at most once. **The warm-call unit remains UNMEASURED.** Measuring it requires a
scope where one detector fires on two or more files inside the 5-minute cache TTL.

### Detection-quality result: 3 calls, $0.080323, zero model-emitted findings

Every one of the three model calls returned `ok=true` and emitted zero findings. The only
finding the entire scan produced came from a detector that made no model call at all
(secrets-exposure, via its regex plus deterministic `llm-bypass` path; see L-002).

**RESOLVED for idor, at zero spend (this SUPERSEDES the two-hypothesis framing Run 1 shipped
with).** Run 1 was written up as "the cause is unresolved for all three; it is either a model
judgment or a wiring bug." For idor that dichotomy was WRONG, and it was resolved without
spending anything, by the L-005 harness fix. See L-001, L-006, and L-007.

The correct capture point turned out to be the raw pre-parse `result.toolInput` on
`MessagesCallResult`, reachable by wrapping `callClaude` with no change to Fixor's source.
`diag.verdict` was insufficient: it is `verdictByIndex.get(0) ?? null`, so a null map
(`idor.detector.ts:862`) and a missing index (`:876`) both collapse to `null`, and it samples
only pair 0.

MEASURED: the candidate block idor actually sent the model for `documentController.ts` was
THREE pairs, not six:

| pairIndex | source | sink | scoped? |
|---|---|---|---|
| 0 | line 13 `req.params.id` | line 11 `prisma.document.findFirst` | SCOPED (`organizationId` in the where) |
| 1 | line 13 | line 102 `prisma.organization.findUnique` | scoped / benign |
| 2 | line 13 | line 181 `prisma.document.findFirst` | SCOPED |

MEASURED: the two genuinely UNSCOPED sites in that file are line 191
(`prisma.document.update`, `where: { id: id as string }`) and line 333
(`prisma.document.findUnique`, `where: { id: documentId }`). **NEITHER was sent to the model.**

So idor's zero-finding is the correct OUTCOME for the input it was given: every site it was
shown is scoped. Note the exact limit of that statement. We know the OUTCOME was right; we do
NOT know the model REASONED correctly, because Run 1's harness discarded the verdicts. Do not
upgrade this to "the model judged correctly". It was asked the wrong question.

The root cause is two structural prefilter and pairing gaps (L-006, L-007), not judgment and
not parsing. The paid re-run was NOT taken and was NOT needed: it would have returned
"not vulnerable" for three scoped pairs and falsely implied a judgment defect.

**Still UNVERIFIABLE: admin-check.** Its zero-finding on `documentRoutes.ts` is NOT resolved by
any of this. The same silent-branch ambiguity still applies: it may have correctly declined to
flag `/all`, `/review`, `/stats`, and `/export.csv`, or it may have silently discarded a
verdict. Run 1 cannot distinguish these. The L-005 harness now can, on any future run.

The one Run 1 call whose reasoning we DID capture is auth-bypass, because its MEDIUM verdict
logged before being suppressed (see L-003).

For reference, idor's five zero-finding branches (only the last logs), which the L-005 capture
now disambiguates: `!verdictByIndex` `:862`, `!verdict` `:876`, `!isVulnerable` `:880`,
`confidence low` `:881`, `confidence medium` `:882` (logs `idor-review-queue`).

See Priority 1d (L-001 through L-008). L-005 is DONE and was the prerequisite that unlocked
this attribution at zero spend.

## Current readiness verdict

**NOT-READY (F-004 is scoped work; L-006 and L-007 are confirmed recall defects).**

The audit (`READINESS-AUDIT.md`) states that items 1 and 2 of its ordered work gate a
clean READY: item 1 was F-001, item 2 is F-004. F-001 is now RESOLVED. There are TWO
remaining READY-gating blockers: F-004, and L-006 + L-007 (the confirmed recall defects that
L-001 turned out to be a symptom of). The L-001 gate is no longer PROVISIONAL: it has been
attributed, it hardened rather than lifted, and it is now carried by its root causes. See
below.

**Deliberate divergence from the audit's gate list.** The audit's formal gate is items 1 and
2 only. L-001 is not an audit item: it was surfaced by live detection-quality measurement
(see "Live detection-quality measurements"), a source the audit did not have. This tracker's
gate is therefore intentionally BROADER than `READINESS-AUDIT.md`'s. That divergence is
recorded on purpose and is not an inconsistency to be reconciled away by narrowing this list
back to the audit's. `READINESS-AUDIT.md` is left unedited; it remains an accurate record of
what the audit itself gated.

- **F-004 - the live-LLM detection brain is only partially guarded by an automated gate.**
  Five detectors (env-exposure, webhook-unverified, auth-bypass, admin-check, and idor) are
  now covered by a deterministic CI gate; until the one remaining stage-2 detector is covered,
  a recall or precision regression in it past the regex prefilters would not be caught by
  CI. Stage 1 is merged (PR #77) and stage 2 sub-steps 2a (env-exposure, PR #79), 2b.0
  (shared harness, PR #81/#82), 2b.1 (webhook-unverified, PR #83/#84/#85), 2b.2 (auth-bypass,
  PR #87/#88/#89), 2b.3 (admin-check, PR #90/#91/#92), and 2b.4 (idor, PR #95/#96/#97) are
  merged, but F-004 is NOT closed: stage 2 sub-step 2b.5 (the one remaining detector) and
  stage 3 (the opt-in live model-judgment workflow) both remain in the deferred worklist.

  Five of six detectors gated is progress, not readiness. Every gate landed so far is a
  wiring-and-parsing gate: none of them verifies detection quality. Stage 3 (live) has now
  produced its first datapoint (see "Live detection-quality measurements"), and it did not go
  well: 3 model calls on real third-party code emitted zero findings, including on a file with
  a known IDOR, and the reason is unresolved for all three. That is a first sample, not a
  verdict on the engine, but it is the opposite of reassuring. F-004 stays NOT-READY.

  Note on wording: admin-check needed TWO gates, not one. A replay gate alone cannot cover it
  (see the 2b.3 entry). "Covered by a deterministic CI gate" is therefore the accurate phrase
  for the set of five; four of them (env-exposure, webhook-unverified, auth-bypass, idor) are
  covered by the *replay* gate specifically, while admin-check needs both a replay gate and a
  free deterministic gate.

- **L-006 + L-007 (CONFIRMED gate; formerly the PROVISIONAL L-001 gate) - idor cannot see two
  whole classes of IDOR.** L-001 (idor emitted nothing on a file carrying two unscoped `where`
  clauses) is now ATTRIBUTED, at zero spend, via the L-005 harness fix. It is neither of the
  two hypotheses this section previously carried. Both are SUPERSEDED.

  **What it is NOT** (SUPERSEDED): not a model-judgment failure, and not a verdict-parsing or
  wiring bug. **What it IS** (MEASURED): a prefilter and pairing RECALL defect. The vulnerable
  code was never put in front of the model. Every candidate site idor DID send was scoped, so
  emitting nothing was the correct OUTCOME for that input. That is not the same as the model
  reasoning correctly, and it must not be read as such: Run 1 discarded the verdicts, so the
  model's reasoning was never observed. It was asked the wrong question.

  **The gate HARDENS rather than lifts.** The previous lift condition was "a cheap wiring fix
  or a defensible judgment". Neither occurred. Attribution found something worse than either:
  two structural gaps in the pattern sets themselves.

  **Why this is NOT a one-file finding.** The evidence is not `documentController.ts`. That
  file is only the DEMONSTRATION. The evidence is the CONTENT OF THE PATTERN SETS, which are
  repo-independent and hold for every file Fixor will ever scan:
  - **L-006**: `SINK_PATTERNS` (`idor.detector.ts:173-202`) contains no ORM write method.
    An IDOR on a write is not enumerable as a candidate in ANY file in ANY repository.
  - **L-007**: the source matcher does not match destructured request params
    (`const { id } = req.params`), so a real source-to-sink pair can fall outside
    `PROXIMITY_THRESHOLD = 200` and be silently dropped by `enumerateSinkPairs`.

  A detector that structurally cannot see write-path IDOR, and that misses one of the most
  common idioms for reading an id off a request, has a CONFIRMED recall defect. Shipping READY
  on that basis is not defensible.

  **Conditions to lift.** Fix L-006 (add ORM write sinks) and L-007 (match destructured
  sources), then re-measure on this file with the L-005 verdict capture on. The gate lifts when
  idor is SHOWN the unscoped sites at lines 191 and 333 and returns a verdict on them. Whether
  it then flags them correctly is the NEXT question, and it will be the first honest test of
  idor's judgment: Run 1 never tested judgment at all.

  **L-005 is DONE, and the critical-path note it carried is resolved.** L-005 was named the
  critical path and it was exactly that: the zero-spend harness fix is what produced this
  attribution, and it removed the need for the roughly $0.03 paid re-run entirely. The
  attribution cost nothing.

Recall is NO LONGER clean, and this is now CONFIRMED rather than suspected. The first live
detection-quality run (see "Live detection-quality measurements") scanned a file carrying two
unscoped `where` clauses, `where: { id: id as string }` at line 191 and
`where: { id: documentId }` at line 333, and emitted nothing. Attribution (zero spend, via
L-005) showed the vulnerable sites were never sent to the model at all: idor's sink patterns
contain no ORM write method (L-006) and its source matcher misses destructured request params
(L-007). The earlier judgment-versus-parsing framing is SUPERSEDED, and the previous "no missed
exploit survives re-measurement" claim is withdrawn. The
remaining non-gating items are precision, signal-hygiene, and coverage-integrity constraints.

---

## DONE

- **F-001 RESOLVED - PR #75, squash `5e26b00e16d42822b882fe397ff30191fe3f34a6`.**
  Engine B (`runAuditorWorkflow`) now resolves ancestor `_layout` guards over the PR
  head and forwards `sidecarsByPath` into `detect()` at `workflows/auditor-workflow.ts`,
  so a correctly parent-layout-gated route is no longer a HIGH false positive on the
  shipped webhook path. Regression guarded by the committed fixture
  `fixtures/f001-layout-guard/` plus `src/test/test-route-guard-webhook-wiring.ts`
  (deterministic, in `test:ci`) and `src/test/test-f001-webhook-parity.ts` (opt-in live).

- **Branch protection on `main` established and proven real.** It was found ABSENT
  (the branch returned 404 "Branch not protected"), then enforced via the API with:
  required status checks `build + typecheck + tests (20.x)`, `build + typecheck + tests
  (22.x)`, `gitleaks + pattern scan` (strict off); `enforce_admins: true`; required PR
  reviews with approving count 0; no force-push, no deletion. Proven non-bypassable by a
  409 on an attempted direct commit to `main`: "Changes must be made through a pull
  request. 3 of 3 required status checks are expected." (Settings change, no PR/commit.)

- **F-001 ledger reconciliation - PR #76, squash `c7e7cfed35bfc0852db025bab231e8c97a51de00`.**
  Marked F-001 RESOLVED in `READINESS-FINDINGS.md` and reworded the banner from
  DIAGNOSIS-ONLY to REMEDIATION STARTED. Docs only.

- **F-004 stage 1 quick wins MERGED - PR #77, squash
  `e3aa4222b0cf35787730b68e74ecace9394b41f5`.** Exact scope, and only this scope:
  1. Added the already-deterministic, keyless `test:real-shape` to the `test:ci`
     enumeration (route-def reachability coverage, free).
  2. Converted the 15 live-LLM detector tests from hard-fail (`process.exit(1)` or a
     thrown harness error) to a clean skip (exit 0 with a "SKIPPED: no API key" line)
     when `ANTHROPIC_API_KEY` is absent, matching `test:f001-parity`. Key-present
     assertions unchanged.
  3. Fixed the stale `ci.yml` comment that referenced `npm test` and the nonexistent
     `test:xss/cmdi/pt` scripts.
  This does NOT add live detection to CI and does NOT by itself close F-004: it is
  stage 1 of the hybrid; stages 2 and 3 remain in the deferred worklist below.

- **Roadmap first landed - PR #78, squash `a37c766b33ad0e37b2f4a9a08385fddb2491264a`.**
  The initial `REMEDIATION-PROGRESS.md` living roadmap. Documentation only.

- **F-004 stage 2 sub-step 2a MERGED - PR #79, squash
  `f2abd102aa4bdfb4938d07b611ac881674dc6238`.** A deterministic, free replay gate for the
  env-exposure detector. Exact scope:
  1. A record/replay shim (`src/analysis-engine/llm-replay.ts`) wired at the single
     `callClaude` choke point (`anthropic-client.ts`), keyed by a SHA-256 over the
     canonical request shape (model, system, messages, tool). In replay mode it returns
     the recorded response and short-circuits before any client is constructed: no key,
     no network, no spend. A missing or key-drifted fixture fails loud
     (`ReplayFixtureMissing`), never a silent live call.
  2. 17 recorded env-exposure fixtures under `fixtures/replay/env-exposure-multi/`, one
     per LLM-reaching fixture. Recorded once locally on the owner's key at a one-time cost
     of ~$0.133; recording is the only path that spends and never runs in CI.
  3. A dedicated keyless replay round-trip test (`test:replay-env-exposure`) that rebuilds
     each synthetic diff, runs the real detector in replay mode, and asserts
     `flagged === meta.expectedFlagged` per fixture, with a completeness manifest so a
     deleted or renamed recording fails loud rather than silently shrinking coverage.
  4. The shim safety guard test (`test:replay-guard`) proving no-flag `callClaude` stays
     byte-identical to pre-shim behavior.
  Both tests are wired into `test:ci` and were verified running keyless (no key, no
  network) on the GitHub runners for the post-merge commit (node 20.x and 22.x green).
  This is a wiring-and-parsing gate only: it does NOT verify detection quality or model
  behavior, and does NOT by itself close F-004; sub-step 2b and stage 3 remain below.

- **F-004 2a-merged tracker update MERGED - PR #80, squash
  `9f3c2db8234838c9f7a9bc6b81fda1ab152cde6b`.** Documentation only: recorded F-004 stage 2
  sub-step 2a as merged and re-scoped the remaining F-004 work (2b and stage 3).

- **F-004 stage 2 sub-step 2b.0 MERGED - PR #81, squash
  `b83e066b4c52ac39dff89d87f534aeb66f6454d7`.** A test-infrastructure refactor that
  generalizes the stage-2a env-exposure replay gate into a shared, parameterized harness so
  the remaining detectors plug in as specs. Exact scope:
  1. Adds `src/test/replay-harness.ts`: the parameterized engine, with the byte-frozen
     `loadFixture`/`buildSyntheticDiff` moved verbatim from 2a (their exact bytes preserve
     every recorded request key), plus `recordFixtures`, `runReplayGate`, the
     `DetectorReplaySpec`/`Layout`/`OutcomeAssertion` contracts, `positiveNegativeLayout`
     with an optional `loadSidecars` hook for a future idor spec, `flaggedOutcome`, and
     `assertEscalationUnset`.
  2. Adds `src/test/specs/env-exposure.replay-spec.ts`: env-exposure expressed as one spec,
     every 2a value (detector id, the 17-fixture manifest, the expected-flagged map, the
     MEDIUM-ceiling notes, the positive/negative layout) carried over unchanged.
  3. Reduces the two 2a files (`record-env-exposure-fixtures.ts`,
     `test-replay-env-exposure.ts`) to thin delegators over the shared harness
     (net -503/+47 on those two).
  4. Deliberate net-new behavior: `assertEscalationUnset` keeps `FIXOR_ESCALATE_MEDIUM`
     unset inside the harness, hard-stopping the colon-in-callerId Windows footgun (an
     escalation call is tagged `escalation:<detectorId>`, whose colon is an invalid Windows
     path segment for a fixture dir). CI never sets the flag, so all 17 outcomes are
     unchanged.
  This is a test-infrastructure refactor only: it changes no CI, no production code, and no
  detection behavior. The env-exposure gate still reproduces all 17 frozen recordings (11
  positives incl. two MEDIUM-ceiling flagged:false, 6 negatives), confirmed green keyless on
  the GitHub runners for the merge (node 20.x and 22.x). It does NOT by itself close F-004;
  sub-steps 2b.1-2b.5 and stage 3 remain below.

- **F-004 2b.0-merged tracker update MERGED - PR #82, squash
  `f18d43d9094cc73072b8637a0b82d3aee4fe8d6e`.** Documentation only: recorded F-004 stage 2
  sub-step 2b.0 as merged and corrected the status of PR #80. No code, test, or CI change.

- **F-004 stage 2 sub-step 2b.1 (webhook-unverified replay gate) MERGED - three PRs landed
  in order, #83 then #84 then #85.** The second detector to plug into the shared harness,
  taken from structure to an enforced CI guard:
  1. **PR #83, squash `d3b00142df7bd0024818963d0715e98d5e5e3ff0`** - the webhook-unverified
     replay spec plus lane-path support in the shared harness: `verdictLaneOutcome` reads
     the diagnostic verdict off `detector.lastDiagnostics[0].verdict`, an optional
     `expectedLane` per id, and a hardened `loadRecordings`. Structure only; the gate was
     not yet wired and the recordings dir was still empty, so running it failed loud.
  2. **PR #84, squash `b2fd53601b968de3e444f33f3df2df28c167232d`** - the 34 recorded
     fixtures under `fixtures/replay/webhook-unverified-multi/`: 16 HIGH positives, 3
     MEDIUM/review-queue anchors (positive/10 go-github eq-compare, reclassified from a HIGH
     positive to a review-queue anchor alongside negatives 14 and 15 because it verifies the
     HMAC but uses a non-constant-time compare), and 15 not-flagged negatives; plus a
     `.gitattributes` pinning `fixtures/replay/**/*.json` to LF. Recorded once locally on the
     owner's key at a one-time cost of ~$0.248; recording never runs in CI.
  3. **PR #85, squash `456c639fe2091f92fdb6eaa0182c8a6cb25ecb52`** - wired the gate into
     `test:ci` as its final step (a `test:replay-webhook-unverified` script mirroring
     `test:replay-env-exposure`). It runs keyless and offline on both node 20.x and 22.x
     required checks with no workflow YAML change, and `assertEscalationUnset` holds on the
     runners. Verified green keyless on the GitHub runners for the merge.
  Net: the webhook-unverified replay gate is now an enforced CI guard on `main`. Like the
  env-exposure gate it is a wiring-and-parsing gate only (not detection quality), and it did
  NOT by itself close F-004; as of that merge, sub-steps 2b.2-2b.5 and stage 3 remained.
  (Corrected: this line previously read "2b.3-2b.5", which silently dropped 2b.2, still
  pending at the time.)

- **F-004 2b.1-merged tracker update MERGED - PR #86, squash
  `0321755b258f578c3852f9dfb1f5c73eb6bb68b1`.** Documentation only: recorded F-004 stage 2
  sub-step 2b.1 as merged. No code, test, or CI change.

- **F-004 stage 2 sub-step 2b.2 (auth-bypass replay gate) MERGED - two PRs landed in order,
  #87 then #88.** The third detector to plug into the shared harness, taken from recorded
  fixtures to an enforced CI guard:
  1. **PR #87, squash `526841bd1e540874d5e5fc77e0848ac3f894fbe4`** - the auth-bypass replay
     spec (`src/test/specs/auth-bypass.replay-spec.ts`), its recorder, its keyless
     entrypoint, and 37 recorded fixtures under `fixtures/replay/auth-bypass-multi/`.
     The source corpus is 45 files (22 positives + 23 negatives); 37 of them are
     model-reaching and therefore recordable, and 8 negatives are excluded because
     auth-bypass drops them before `callClaude` ever runs:
     - **6 zero-prefilter** (`prefilterRegex` returns 0 hits, so `analyzeFile`
       short-circuits): negatives 02, 03, 08, 09, 10, 19. (Negative/02 also sits on a
       `SKIP_PATH_RE` path, `scripts/dev/`, so it is doubly excluded; it is counted once,
       here.) Negative/19 is a Remix utility module outside `app/routes/`, the direct
       analog of webhook-unverified negative/18.
     - **2 via `SKIP_PATH_RE` at `detect()`** (dropped on path before the prefilter runs):
       negative/05 (`scripts/seed/seed-uploads.js`) and negative/07 (`tests/conftest.py`).
     Recorded one-shot clean, 37/37 against designed intent: all 22 positives flagged
     `isVulnerable:true@high`, all 15 model-reaching negatives not flagged. ZERO cases
     landed off-class, so `EXPECTED_LANE` is empty (`{}`): none of the three not-flagged
     lanes (LOW confidence, MEDIUM review-queue, H7 `laneDeferral`) fired on this corpus.
     Those lane anchors live in `fixtures/real-shape` (exercised by
     `test-auth-bypass-lane.ts`), not here. Recorded once locally on the owner's key at a
     one-time actual cost of $0.31472 (pre-record estimate was $0.27-0.35); recording is
     the only path that spends and never runs in CI.
  2. **PR #88, squash `9285ea6db00d3c5c081b81a4a39b09977cc41031`** - wired
     `test:replay-auth-bypass` into `test:ci` as the final step of the chain, keeping the
     `test:replay-*` group contiguous at the tail (a one-line change; the npm script itself
     already existed from #87). Verified from the GitHub runner job logs, not merely from a
     green check mark, that the gate executes in-chain keyless and offline on both node 20.x
     and 22.x required checks, printing `Mode: replay, offline, no key, no network, no DB.`
     and `recordings cover exactly the 37-fixture manifest`, with `assertEscalationUnset`
     holding on the runners. No workflow YAML change.
  Net: the auth-bypass replay gate is now an enforced CI guard on `main`. Like the
  env-exposure and webhook-unverified gates it is a wiring-and-parsing gate only (not
  detection quality), and it did NOT by itself close F-004; as of that merge, sub-steps
  2b.3-2b.5 and stage 3 remained.

  **Durable count note (do not re-derive wrongly).** The recordable count for auth-bypass is
  **37, not the ~39 first estimated.** The ~39 over-counted by including negatives 05 and 07,
  which DO trigger the prefilter regex but are dropped on path by `SKIP_PATH_RE` inside
  `detect()` before the model is ever reached. Any count derived from the prefilter alone
  over-includes them. The authoritative number is the 37-entry manifest in
  `auth-bypass.replay-spec.ts`, which the gate asserts for completeness on every CI run.

- **F-004 2b.2-merged tracker update MERGED - PR #89, squash
  `aa117a02a7ebb263942aeb802a3aea544d78551b`.** Documentation only: recorded F-004 stage 2
  sub-step 2b.2 as merged. No code, test, or CI change. (Corrected: this PR was previously
  listed under IN REVIEW; it merged 2026-07-09.)

- **F-004 stage 2 sub-step 2b.3 (admin-check) MERGED - THREE PRs landed in order, #90 then
  #91 then #92.** The fourth detector gated, and the FIRST that needed **two** gates rather
  than one. Unlike 2b.1 and 2b.2, admin-check reaches findings on the shipped path both with
  and without a model call, so no single instrument covers it.
  1. **PR #90, squash `5cb5f5a8e849df3c6a3dcd405e99dcbfab0cb6c1`** - a FREE deterministic
     prefilter gate (`src/test/test-admin-check-prefilter.ts`), zero spend, wired into
     `test:ci` immediately beside `test:auth-bypass-prefilter`. It guards the two pre-model
     buckets:
     - **Bucket (b), 9 Option G deterministic bypass positives** (positives 01, 02, 03, 04,
       05, 07, 08, 09, 10). Per fixture it asserts: the model was NOT reached, exactly 0 LLM
       call attempts, exactly ONE finding, `preFilterReason === "llm-bypass"`,
       `type === "admin_check_risk"`, `severity === "critical"`, and `ruleId` pinned to
       `admin-check-<patternId>` for the specific pattern that must have produced it.
     - **Bucket (a), 3 pre-model drops**: negative/03 and negative/18 (no prefilter regex
       match at all) and negative/07 (dropped on path by the path filter). Previously guarded
       by nothing.
     Also added `assertAdminCheckOptInUnset` to `src/test/replay-harness.ts`, keeping
     `FIXOR_ADMIN_CHECK_LLM_OPT_IN` unset so the 9 bucket-(b) fixtures cannot silently drift
     onto the model path and invalidate the manifest instead of failing it.
  2. **PR #91, squash `b301d86bf3a02d7d756f775fcaa972620b101d55`** - the admin-check replay
     spec and recorder plus 30 recorded bucket-(c) fixtures under
     `fixtures/replay/admin-check-multi/`. Recorded one-shot clean, 30/30 against designed
     intent; ZERO cases landed off-class, so `EXPECTED_LANE` is empty (`{}`) - neither of
     admin-check's two not-flagged-but-vulnerable model-path lanes (LOW confidence, MEDIUM
     routed through `resolveMediumVerdict` to "review-queue") fired on this corpus. Measured
     record-time spend $0.28092 (owner-reported; see the provenance caveat in the
     recording-cost lessons above). Recording never runs in CI.
  3. **PR #92, squash `491480e3b97de96dd5385b84c2ee3698490a5a62`** - wired
     `test:replay-admin-check` into `test:ci` as the final chain step, keeping the
     `test:replay-*` group contiguous at the tail (a one-line change; the script itself
     already existed from #91). Verified from the GitHub runner job logs, not merely from a
     green check mark, that the gate executes in-chain keyless and offline on both node 20.x
     and 22.x required checks, printing `Mode: replay, offline, no key, no network, no DB.`
     exactly once per job. Both `assertEscalationUnset` (invoked inside `runReplayGate`,
     `replay-harness.ts:422`) and `assertAdminCheckOptInUnset` (invoked directly at
     `test-replay-admin-check.ts:53`) are on the execution path, so the green run proves both
     held on the runners. No workflow YAML change.

  **Measured bucket split (do NOT re-derive by reading the source).** The corpus is 42 files
  (21 positives + 21 negatives) under `fixtures/admin-check/`:
  - **Bucket (a): 3** pre-model drops (negatives 03, 07, 18). Guarded free by #90.
  - **Bucket (b): 9** Option G deterministic bypass positives. Guarded free by #90.
  - **Bucket (c): 30** model-reaching (12 positives + 18 negatives), of which **26 fire a
    route-def trigger** and **4 fire `role_string_compare`** (negatives 01, 02, 04, 10).
    Guarded by the replay gate from #91/#92.

  **Why the split cannot be re-derived by grep.** Bucket membership is decided by the tier of
  `triggers[0]`, and `prefilterRegex` returns at most one hit: the match with the EARLIEST
  `m.index` across all patterns. So a file containing a literal-tier pattern still reaches the
  model when any judgment-tier pattern matches earlier in that file. This is not hypothetical:
  `positive/06-client-supplied-role.js` is NAMED for the literal-tier `body_role_check`, yet an
  `express_route_def` match occurs earlier, so it lands in bucket (c) and `body_role_check`
  never fires. Likewise `positive/08-flask-endswith-domain.py` fires the generic
  `email_endswith_at`, not the Python-specific `py_email_endswith_at`. The split above was
  measured by executing the detector keylessly. Anyone regenerating it by searching for pattern
  names WILL get it wrong.

  **Why TWO gates were structurally necessary (this generalizes to 2b.5).** Bucket (b) emits
  its finding without ever issuing a `callClaude` request. No request means no request key,
  which means no recording can exist. And `runReplayGate` asserts that recordings cover the
  manifest EXACTLY, so those 9 fixtures cannot be placed in a replay manifest even in
  principle: adding them would fail the completeness assertion, not extend coverage. A replay
  gate is structurally blind to them. Any detector with a deterministic no-model path needs a
  free deterministic gate alongside (or instead of) replay. 2b.5 is the same shape.

  **Honesty constraints on 2b.3 (carried forward).**
  - A green replay check verifies wiring, tool-input parsing, and the verdict path ONLY. It
    does NOT verify detection quality. Stage 3 (live, repeated sampling) remains.
  - The #90 gate exercises **7 of the 11 literal-tier patterns**. Four are exercised by
    NOTHING: `email_eq_literal`, `py_email_endswith_at`, `role_fallback_admin`,
    `body_role_check`. Two of those four (`py_email_endswith_at`, `body_role_check`) are
    shadowed by an earlier match in the very fixtures meant to exercise them, so adding an
    assertion alone cannot reach them. They need NEW fixtures whose earliest match is the
    intended pattern. Follow-up, not done here.
  - **Sidecar freeze.** All 26 route-def bucket-(c) fixtures record `routeGuard === undefined`
    (`fixtures/admin-check/` contains no sidecar files, and the spec uses
    `positiveNegativeLayout` with no `loadSidecars` hook). This freezes ONLY the un-guarded
    branch. The F-001 cross-file parent-layout admin-guard path lives in
    `fixtures/f001-layout-guard/` and is not exercised here. Adding guarded-route sidecar
    coverage later will move the request and force a re-record of those 26 fixtures.
  - **Stale source comment, logged not fixed.** `admin-check.detector.ts:805` says the
    judgment tier is "currently only role_string_compare". It is SIX patterns:
    `role_string_compare`, `express_route_def`, `app_router_route_def`, `remix_handler_def`,
    `fastapi_route_def`, `flask_route_def`. Deliberately not fixed in the 2b.3 PRs (out of
    scope). Follow-up below.

- **F-004 stage 2 sub-step 2b.4 (idor) MERGED - THREE PRs landed in order, #95 then #96 then
  #97.** The fifth detector gated, and the FIRST to exercise sidecars end to end.
  1. **PR #95, squash `477aac6`** - the idor replay spec, the `findingSetOutcome` assertion
     (idor emits one finding per source/sink pair, so a boolean `length > 0` would pass a
     partial set), and a `listClass` sidecar-exclusion fix so the three companion files are
     never enumerated as fixtures. Structure only; the gate was not yet wired.
  2. **PR #96, squash `23b8b45`** - 26 recorded fixtures under `fixtures/replay/idor-multi/`
     (idor 18, idor-tenant 6, idor-multi 2; all DETECTOR_ID `idor-multi`) plus the pinned
     `EXPECTED_SET`. All 26 reach the model; buckets (a) and (b) are empty, so idor needs no
     free deterministic gate. `systemPromptFingerprint 5f5129f12b11` (matches the table in
     the recording-cost lessons above). Record-time spend is owner-attested and not in this
     tracker's evidence (the recorder persists no cost data; see the provenance caveat above).
  3. **PR #97, squash `8351b09` (parent 23b8b45; tree `78eee68a`, byte-identical to the
     CI-validated head cb0dada, empty diff)** - wired `test:replay-idor` into `test:ci` as the
     tail step after `test:replay-admin-check` (package.json only, mirroring #88/#92), AND a
     root-cause fix for non-portable replay keys that the wiring surfaced. The replay key
     hashes `messages`, which embed sidecar bodies; `loadFixture` LF-normalizes the primary
     fixture but `readCompanionSidecars`/`loadFixtureSidecars` read sidecars raw, so the three
     sidecar-carrying negatives (`idor/negative/03,04,07`) were keyed to CRLF at #96 record
     time and missed on Linux (`ReplayFixtureMissing`, 3/26). Fix: a shared `lfNormalize()`
     applied at both sidecar readers; `.gitattributes` LF pins for `fixtures/idor/**`,
     `fixtures/idor-tenant/**`, `fixtures/idor-multi/**`; and re-keyed ONLY those three
     recordings to their LF keys by rename plus the top-level `key` field (response bodies
     byte-identical, zero re-record, zero model spend; recomputed runtime key == new filename
     proven for all three). Verified keyless: `test:ci` green on node 20.x and 22.x with real
     durations, `test:replay-idor` 26/26 with 03/04/07 passing.
  Net: the idor replay gate is now an enforced, CI-run guard on `main` - previously the gate
  existed but was unwired, so idor was ungated on the runners. Like the others it is a
  wiring-and-parsing gate only, not detection quality. `EXPECTED_LANE` is empty and deferred
  (see Priority 1c). It did NOT by itself close F-004: sub-step 2b.5 and stage 3 remain.

- **F-004 2b.3-merged tracker update MERGED - PR #93, squash `ba80fe0`.** Documentation only:
  recorded F-004 stage 2 sub-step 2b.3 (admin-check, two gates) as merged. No code, test, or
  CI change.

- **F-004 SYSTEM_PROMPT/2b.4-scoping tracker update MERGED - PR #94, squash `5363d88`.**
  Documentation only: corrected the measured `SYSTEM_PROMPT` length table (withdrawing the
  inverted admin-check-vs-auth-bypass claim) and recorded the 2b.4 idor scoping facts. No
  code, test, or CI change.

### IN REVIEW (open PR, awaiting merge command - NOT merged, NOT done)

- **This 2b.4-merged tracker update** is the open docs PR, prepared and awaiting the merge
  command; it is not yet merged and is not listed under DONE until it lands.

---

## NOT-DONE / DEFERRED (ordered worklist)

### Priority 1 - F-004 remaining stages (HIGH; the READY gate)

F-004 is NOT closed until stage 2 covers the detectors; sub-step 2a (env-exposure), sub-step
2b.0 (the shared harness), sub-step 2b.1 (webhook-unverified), sub-step 2b.2 (auth-bypass),
sub-step 2b.3 (admin-check), and sub-step 2b.4 (idor) are merged, while sub-step 2b.5
(secrets-exposure, the one remaining detector) is pending. The model-judgment gate (stage 3)
is only ever exercised by opt-in live runs, never free-in-CI.

- **Stage 2 - deterministic replay gate (required, free, in CI).** The replay shim
  (`src/analysis-engine/llm-replay.ts`, wired at the single `callClaude` choke point in
  `anthropic-client.ts`) returns a recorded per-detector response keyed by a hash of the
  request (model, system, messages, tool) instead of calling the network. It guards
  wiring, tool-schema parsing, verdict and lane mapping, and finding emission. It CANNOT
  catch a model-behavior regression (a frozen sample replayed N times is not repeated
  sampling), and is labeled a wiring-and-parsing gate, not a detection-quality gate.
  - **Sub-step 2a (env-exposure): DONE, merged (PR #79).** See DONE above.
  - **Sub-step 2b.0 (harness generalization): DONE, merged (PR #81, tracker #82).** See DONE
    above. The stage-2a gate is now a shared, parameterized harness
    (`src/test/replay-harness.ts`) so the remaining detectors plug in as specs; a
    test-infrastructure refactor only, no detection change.
  - **Sub-step 2b.1 (webhook-unverified): DONE, merged (PR #83/#84/#85).** See DONE above.
    The second detector plugged into the shared harness (spec plus lane-path support, 34
    recorded fixtures, wired into `test:ci`); now an enforced keyless CI guard.
  - **Sub-step 2b.2 (auth-bypass): DONE, merged (PR #87/#88, tracker #89).** See DONE above.
    The third detector plugged into the shared harness (spec, recorder, entrypoint, 37
    recorded fixtures, wired into `test:ci` as the final chain step); now an enforced keyless
    CI guard. `EXPECTED_LANE` is empty: the corpus produced zero off-class cases.
  - **Sub-step 2b.3 (admin-check): DONE, merged (PR #90/#91/#92).** See DONE above. The
    fourth detector gated, and the first needing TWO gates: a free deterministic prefilter
    gate for the 3 pre-model drops and the 9 Option G bypass positives (#90), plus a 30-
    fixture replay gate for the model-reaching remainder (#91/#92). Measured bucket split
    3 / 9 / 30 over a 42-file corpus. `EXPECTED_LANE` is empty. Both gates are enforced
    keyless CI guards.
  - **Sub-step 2b.4 (idor): DONE, merged (PR #95/#96/#97).** See DONE above. The fifth
    detector gated and the first to exercise sidecars end to end: an idor replay spec with a
    `findingSetOutcome` assertion and a `listClass` sidecar-exclusion fix (#95), 26 recorded
    fixtures with a pinned `EXPECTED_SET` (#96), and the `test:ci` wiring plus the
    cross-platform replay-key portability fix (#97). Durable measured facts (execution, not
    reading): 26 source fixtures across three corpora (`fixtures/idor` 18, `fixtures/idor-tenant`
    6, `fixtures/idor-multi` 2), ALL 26 model-reaching, so buckets (a) and (b) are empty and
    idor needs NO free deterministic gate - the opposite shape from admin-check. The inherited
    "29 recordable" figure is REFUTED (a filesystem count that merged three corpora and counted
    the three sidecar files as fixtures; the same failure mode as auth-bypass's "~39" that was
    37). The three sidecar readers now LF-normalize, so the recording keys are OS-stable (see
    the recording-cost lessons and the DONE entry). `EXPECTED_LANE` is empty and deferred
    (Priority 1c). Now an enforced keyless CI guard; previously idor was ungated in CI entirely.
  - **Sub-step 2b.5 (secrets-exposure): PENDING.** The one remaining detector. The replay
    mechanism is proven end to end on the five gated detectors and generalizes (the shim, the
    key derivation, the record harness shape, and the keyless round-trip test are all
    detector-agnostic since 2b.0), but 2b.5 is NOT a plain repeat, for the reason 2b.3 already
    proved. A detector that reaches findings on the shipped path WITHOUT calling the model has
    no request to key a recording on, and `runReplayGate` asserts exact manifest coverage, so a
    replay gate is structurally the wrong instrument for that part of its behavior. `registry.ts`
    constructs `SecretsExposureDetector()` with no options, so `llmValidation` defaults to false
    and every prefilter hit is flagged regex-only from a hand-authored explanation
    (`preFilterReason: "llm-bypass"`). An LLM path does exist in the class but is opt-in
    (`FIXOR_SECRETS_LLM_OPT_IN=true` or `{ llmValidation: true }`) and is off in CI. So guard
    the shipped behavior with a FREE deterministic regex test, not a replay gate; there is no
    `callClaude` request to record. **Expected recording cost: $0.** Guard it deterministically,
    exactly as admin-check bucket (b) was guarded in PR #90; that PR is the working template for
    this shape.
    Separately, secrets-exposure carries F-010 (a known false positive on an obvious
    placeholder). Any fixture written for it FREEZES the current behavior as a wiring
    sample only; it does NOT endorse that verdict as correct. Fixing F-010 is separate
    precision work (see Priority 3) and is new work, and when it lands it will move the
    request or the response, so that fixture must then be re-recorded.

- **Stage 3 - opt-in live workflow (manual, spends only when run).** A GitHub Actions
  workflow on `workflow_dispatch` only (NO fork-PR trigger, NO nightly schedule), reading
  `ANTHROPIC_API_KEY` from a repo secret the owner sets, running the live detector tests
  through the existing `stability-harness` with repeated sampling (N>=3 and pass
  thresholds) so a single flaky verdict cannot pass as stable. This is the only gate that
  exercises the model's judgment.

### Priority 1b - OPEN: the H7 double-silence risk (unresolved potential RECALL hole)

This is a cross-detector gap, not part of 2b.3, and it is deliberately recorded on its own so
it is not buried in a step marked DONE. It is one of two known items that could LOSE a real
vulnerability rather than merely add noise; the other is L-001 (Priority 1d), which is a
DIFFERENT mechanism (idor returning nothing on a single file, with no lane deferral involved).

**The mechanism.** `auth-bypass.detector.ts:772-777` suppresses its own HIGH finding and
defers when its verdict carries `authPresent === "yes" && operationKind === "admin"`, logging
`missing admin gate is admin-check's lane` and emitting nothing (`laneDeferral`). admin-check
is the RECEIVING side of that lane, but it carries no `laneDeferral` field of its own and
NOTHING asserts that it actually catches those cases. If admin-check independently returns LOW
confidence, or MEDIUM routed to "review-queue", on the same route, then BOTH detectors go
silent and a real vulnerability is lost with no signal anywhere.

**Evidence so far, and its exact limit.** All 12 of the 12 route-def positives in the 2b.3
corpus were recorded flagged `isVulnerable:true@high`, so on every measured case admin-check
does hold its side of the lane. That is genuinely reassuring but it is NOT an answer, and it
CANNOT be turned into one from the admin-check recordings: admin-check's verdict schema has no
`authPresent` and no `operationKind` fields at all (its tool input is exactly `isVulnerable`,
`confidence`, `reasoning`, `suggestedFix`, `vulnerableRoute`). Nothing in those 30 recordings
can tell us which routes auth-bypass would have deferred on. The two detectors' verdicts are
not joinable from the data we hold.

**What answering it requires.** A separate, scoped auth-bypass run over the 26 route-def
fixtures in `fixtures/admin-check/`, capturing `authPresent`/`operationKind` per fixture, then
intersecting the deferral set against admin-check's recorded confidences. This was NOT
authorized, NOT performed, and its result is NOT inferred here.

**Estimated cost to answer: about $0.23** (26 calls). Derived, not measured: the 2b.2
auth-bypass recording spent $0.31472 over 37 calls, or about $0.0085/call; 26 x $0.0085 is
about $0.221, plus one cache-write premium of roughly $0.012 (auth-bypass's prompt is 14,237
chars, about 3,559 tokens; see the measured table above - an earlier revision wrongly called
it "short, 399 chars" and treated its premium as negligible). Bound the worst case as
`(26 x highest observed warm call) + one cache-write premium` and report the measured total,
not this estimate.

**The idor side of H7, ANSWERED by measurement (this corpus only).** idor is also a deferral
SOURCE: `idor.detector.ts:937-942` hands a HIGH-vulnerable pair to auth-bypass when
`callerAuth === "unauthenticated"` or to admin-check when `operationClass === "administrative"`
(the same double-silence shape, in two directions). Measured across all 26 idor recordings (48
verdict pairs): `callerAuth` is never `unauthenticated` (33 authenticated, 15 unclear, 0
unauthenticated); `operationClass` is `administrative` on 5 pairs, but ALL 5 are
`isVulnerable:false` (negatives 02, 05, 06), which `idor.detector.ts:882`
(`if (!verdict.isVulnerable) continue;`) drops BEFORE the deferral branch is ever reached. Every
one of the 20 `isVulnerable:true` pairs (the 20 emitted findings across the 12 positives) is
`operationClass:user_resource` with `callerAuth` in {authenticated (13), unclear (7)}. So no
vulnerable pair was unauthenticated or administrative, idor's R10 `laneDeferral` fired ZERO
times, and idor emitted all 20 of its vulnerable pairs itself and handed nothing off. On this
corpus idor cannot contribute to a double-silence. LIMITS: one frozen sample per fixture
(F-008), a wiring-and-parsing gate not a detection-quality one, scoped to these 26 fixtures - it
says nothing about corpora idor has not seen. The admin-check side (auth-bypass -> admin-check)
remains OPEN as above.

### Priority 1c - follow-ups opened by 2b.3 (small, deterministic, no spend)

- **Four literal-tier admin-check patterns are exercised by nothing.** `email_eq_literal`,
  `py_email_endswith_at`, `role_fallback_admin`, `body_role_check`. The #90 gate covers 7 of
  11. Two of the four are shadowed by an earlier match in the very fixtures meant to exercise
  them, so this needs NEW fixtures whose earliest `m.index` is the intended pattern; adding
  assertions alone cannot reach them. No API spend (all four are bypass-tier, no model call).
- **Stale comment at `admin-check.detector.ts:805`.** It claims the judgment tier is
  "currently only role_string_compare"; there are six judgment-tier patterns
  (`role_string_compare` plus the five route-def patterns). Comment-only fix. Left untouched
  by the 2b.3 PRs on purpose.
- **idor diagnostic is lossy for lane anchoring (opened by 2b.4).** `idor.detector.ts:862`
  exposes only pair 0's verdict on `diag.verdict`; `idor.detector.ts:957` assigns
  `diag.laneDeferral` inside the per-pair loop (last-writer-wins). Neither affects shipped
  findings, but any path-anchored `EXPECTED_LANE` gate on idor is incomplete across the 14
  multi-pair files until both are widened to per-pair arrays. `EXPECTED_LANE` on idor is
  therefore deferred (kept `{}`). No API spend.
- **Generalize `assertEnvFlagUnset(name, why)` (opened by 2b.4).** `assertAdminCheckOptInUnset`
  is detector-specific in a shared harness; 2b.5 will need the same guard for
  `FIXOR_SECRETS_LLM_OPT_IN`. Generalize when the second caller exists, not preemptively. No
  API spend.

### Priority 1d - OPEN: defects surfaced by the first live detection-quality run

All five are OPEN. See "Live detection-quality measurements / Run 1" for the evidence. The
`L-` prefix is a separate namespace from `F-`: `F-` items were surfaced by the readiness
diagnostic, `L-` items by live detection-quality measurement. Where they overlap they are
cross-referenced, not merged.

- **L-001 (ATTRIBUTED; root cause L-006 + L-007) - idor emitted nothing on a file carrying two
  unscoped `where` clauses.** Retained as the SYMPTOM that surfaced the two structural defects.
  The defects themselves are L-006 and L-007; fix those and L-001 goes away. The READY gate is
  carried by L-006 + L-007, not by this item.

  **CORRECTION of a claim merged on `main` (squash `346ed45`).** That revision stated idor
  "prefiltered 6 candidate pairs". That is WRONG. The 6 was `diag.triggerCount`, which counts
  prefilter TRIGGERS (source-pattern and sink-pattern hits), not pairs. **The true candidate
  count was 3.** The same revision described the vulnerability as `where:{id: req.params.id}`;
  also wrong. `req.params.id` is the SOURCE. The unscoped WHERE clauses are
  `where: { id: id as string }` (line 191) and `where: { id: documentId }` (line 333). Both
  errors are recorded here as corrections rather than silently overwritten, per this file's
  convention.

  MEASURED (the candidate block actually sent to the model, captured pre-parse from
  `result.toolInput`): 3 pairs. `[0]` source line 13 to sink line 11 (`findFirst`; its `where`
  carries `organizationId`, so SCOPED). `[1]` source line 13 to sink line 102
  (`organization.findUnique`, benign). `[2]` source line 13 to sink line 181 (`findFirst`,
  SCOPED).
  MEASURED (ground truth in the file): the unscoped sites are line 191 and line 333. NEITHER
  appears in the candidate block.
  MEASURED: 1 call, `ok=true`, 0 findings, no review-queue log.
  SUPERSEDED: the earlier hypotheses (a) `isVulnerable:false`, (b) `confidence:"low"`, (c) a
  null verdict map, (d) an unmatched tool-output index. None of them is the cause. The model
  was never asked about the vulnerability.

  The zero-finding is therefore the correct OUTCOME for the input given. It does NOT show that
  the model reasoned correctly, because Run 1 discarded the verdicts. It shows the model was
  asked the wrong question.

  **The paid re-run (about $0.03) was correctly NOT taken.** It would have returned
  "not vulnerable" for three scoped pairs and falsely implied a judgment defect. The
  attribution cost $0.

  Cross-reference: Priority 1b (H7) remains a DIFFERENT recall mechanism (cross-detector lane
  deferral). No lane deferral occurred here.

- **L-006 (HIGH; RECALL; STRUCTURAL, affects any repo) - IDOR on an ORM write operation is
  undetectable.** `idor.detector.ts` `SINK_PATTERNS`.

  MEASURED (the FULL array was read, `idor.detector.ts:173-202`, all 15 entries; this is not a
  sample). No write verb (`update`, `delete`, `destroy`, `remove`, `save`, `create`) appears
  anywhere in it. Every ORM sink is a READ method, across every ORM family present:
  `prisma_find_unique` (`.findUnique(`), `prisma_find_first` (`.findFirst(`), `orm_find_one`
  (`.findOne(`), `orm_find_by_id` (`.findById(`), `sequelize_find_by_pk` (`.findByPk(`),
  `sqlalchemy_query_get` (`.query.get(`), `sqlalchemy_filter_by_id` (`.filter_by(id=`),
  `sqlalchemy_session_get` (`session.get(`), `django_objects_get` (`.objects.get(`),
  `django_objects_filter` (`.objects.filter(id=`), `rails_find_by` (`.find_by(`),
  `rails_class_find` (`Class.find(`).

  MEASURED NUANCE (do not overstate the gap). Two sinks are method-name based and WOULD
  incidentally match a write routed through them: `node_pg_query` (`db.query(`) and
  `go_db_queryrow` (`db.Exec(` / `.Query(`). So a raw-SQL write issued through those clients is
  still enumerable. The third raw sink, `raw_sql_where_id`, requires a literal `SELECT`, so a
  raw `UPDATE ... WHERE id =` is NOT matched by it. The gap is therefore precisely: **no ORM
  write method is a sink.** It is not "no write is ever a sink".

  CONSEQUENCE: an unscoped `prisma.document.update({ where: { id } })` is never enumerated as a
  candidate, so it can never be flagged, in any file, in any repository. The same holds for
  Sequelize `.update` / `.destroy`, Django `.update` / `.delete`, Rails `.update` / `.destroy`,
  and Prisma `.delete` / `.updateMany`. DEMONSTRATED at `documentController.ts:190-191`, which
  idor never sent to the model.

  This is arguably the more damaging half of the pair: an unauthorized WRITE that mutates
  another tenant's row is typically higher impact than an unauthorized read.

  (The cross-ORM sub-check raised when this item was drafted is now CLOSED: the full array was
  read rather than sampled, and every ORM family in it is read-only.)

- **L-007 (HIGH; RECALL; STRUCTURAL, affects any repo) - destructured request params are not
  matched as a source, so real pairs are dropped on distance.** `idor.detector.ts`
  `SOURCE_PATTERNS` plus `enumerateSinkPairs` plus `PROXIMITY_THRESHOLD = 200`.

  MEASURED: in `documentController.ts`, only the inline `req.params.id` at line 13 was matched
  as a source. The destructured form `const { id } = req.params;` at lines 169 and 256 was NOT
  matched.

  MEASURED CONSEQUENCE: sink line 332 (`findUnique`, with the unscoped `where` at line 333) had
  its nearest DETECTED source 319 lines away (line 13). `enumerateSinkPairs` pairs a sink only
  with a source within `PROXIMITY_THRESHOLD = 200`. 319 exceeds it, so `if (best)` never fires
  and the pair is silently dropped. The vulnerability is never enumerated, and nothing logs.

  This is a COMPOUNDING failure, not a single missed source. The source gap does not merely
  lose one source: it strands every downstream sink outside the proximity window of the one
  source that IS matched. `const { id } = req.params` is a routine Express idiom, so this is
  not an edge case.

- **L-008 (LOW; harness hygiene; zero spend) - the scratch capture harness mis-derives the pair
  count.** `attributeIdor` in the scratch harness used `diag.triggerCount` as the pair count.
  `triggerCount` counts prefilter triggers, not pairs (6 versus 3 on this file), so its
  per-pair branch attribution can mislabel pairs as out-of-range or unmatched. Derive the count
  from the captured candidate block instead. One-line fix.

  This does NOT affect the L-001, L-006, or L-007 conclusions, which rest on the captured
  candidate block and on the pattern sets, not on the attribution helper. Recorded as its own
  open item rather than buried inside L-005's DONE note, so that an open defect is not hidden
  inside a closed one. Fix before the harness is reused.

- **L-002 (MEDIUM; precision) - secrets-exposure fired critical/high on a server-only key,
  with remediation from the wrong framework.** The scan's ONLY emitted finding.
  `authMiddleware.ts:9`, `severity:critical`, `confidence:high`, zero model calls (regex plus
  the deterministic `llm-bypass` path). It flags a Supabase service-role key read from
  `process.env` in backend Express middleware.

  The detection itself is literally true (that IS a service-role key reference). The
  CALIBRATION is wrong on two counts. Its stated threat model is conditional on the file
  shipping to a client bundle; Express middleware never does, so the condition cannot hold.
  Its remediation instructs the reader to add `import 'server-only';`, which is a Next.js
  convention and is meaningless in Express. A critical/high alert on a key used exactly where
  it belongs, emitted with no model in the loop to check the context.

  Related but distinct from F-010 (LOW, secrets FP on an obvious placeholder): that one is
  about the VALUE being a non-secret, this one is about the CONTEXT making the threat model
  inapplicable. Do not merge them without deciding both.

- **L-003 (MEDIUM; precision, currently masked) - the cross-file auth blind spot is CONFIRMED
  live on Express, and F-001's fix does not cover it.** auth-bypass judged the
  `documentRoutes.ts` routes unprotected. They are in fact guarded by a global `authMiddleware`
  mounted in a parent, which whole-file scanning cannot see. Its reasoning (captured verbatim
  in the run log) cites `PATCH /:id/status`, `POST /:id/action`, and `POST /upload` as
  unguarded.

  It landed at MEDIUM, and with `FIXOR_ESCALATE_MEDIUM` unset (the shipped default) MEDIUM is
  suppressed to a review queue and dies there. So the false positive never surfaced.
  **Precision was preserved by a blanket suppression, not by correct reasoning.** Enabling
  escalation surfaces this as a live FP.

  This is the F-001 / F-013 theme, and it sharpens the open F-013 question. F-001's defense is
  the parent-guard sidecar, but `resolveRemixRouteGuard` resolves Remix and RR v7 layouts only:
  `guardBody` was null for all four Express files in this run. **F-001's fix does not
  generalize to Express MVC.** That is a scope limit worth recording, and it is NOT the same as
  answering F-013, which asks for a repeated-sample Engine B measurement. This run was a single
  sample on the Engine A `cli/scan.ts` path. F-013 stays open and unanswered.

- **L-004 (LOW; structural RECALL gap) - webhook-unverified is blind to MVC webhooks.**
  Zero calls on `webhookController.ts`, a real Paddle HMAC webhook handler.
  MEASURED: 0 calls, prefilter reason `no regex match`.
  ANALYZED (from reading `PREFILTER_PATTERNS` and the target, not from the run alone): all 13
  patterns key on route DEFINITIONS (`router.post('/webhook...')`), webhook-library imports,
  `new Webhook(`, signature anti-patterns, or filesystem-routed handlers. The controller is
  `export class WebhookController { static async handlePaddle }` with zero route definitions,
  imports plain `crypto`, and uses `timingSafeEqual` correctly. There is no `webhookRoutes.ts`
  in the repo at all; the `/webhook` path lives in parent app wiring.
  In an Express MVC controller/route split, NO file in a controller-scoped scan carries the
  signal this detector needs. It costs nothing here (the webhook is correctly verified), but an
  UNVERIFIED MVC webhook would be equally invisible.

- **L-005 (DONE, zero spend) - the measurement harness discarded the verdict it was handed.**
  The Run 1 harness read `lastDiagnostics[0]` but persisted only `preFilterReason`, so all
  three zero-finding outcomes were unattributable. FIXED in the scratch harness at zero model
  spend.

  The fix is NOT the one this item originally proposed. Capturing `diag.verdict` would NOT have
  been sufficient: it is `verdictByIndex.get(0) ?? null` (`idor.detector.ts:861`), so it is
  post-parse, samples pair 0 only, and collapses a null verdict map (`:862`) and a missing index
  (`:876`) to the same `null`. The correct capture point is the raw PRE-parse `result.toolInput`
  on `MessagesCallResult`, which is already public and is reachable by wrapping `callClaude`
  with NO change to Fixor's tracked source.

  It paid for itself immediately: capturing the raw candidate block and tool input is what
  attributed L-001 to L-006 and L-007, at zero spend, and removed the need for the roughly $0.03
  paid re-run. Standing rule it establishes: any live run that does not persist the raw
  `toolInput`, `verdict.isVulnerable`, and `verdict.confidence` is not worth paying for.

  Remaining hygiene defect in the harness is tracked separately as L-008, not folded in here.

### Priority 2 - MEDIUM findings (precision and coverage-integrity)

- **F-002 (MEDIUM) - non-LLM detector throw not counted as degraded coverage.**
  `cli/scan.ts:458-463` (warn and continue); cf. `workflows/auditor-workflow.ts:383-395`.
  A parser or unexpected-input throw yields zero findings for that detector without
  flipping the integrity gate, so a partially-blind run can read as clean.
- **F-003 (MEDIUM) - `readFileSync` failure yields zero findings with no coverage
  signal.** `cli/scan.ts:465-467`. A file that was never analyzed is indistinguishable
  from one analyzed and found clean; exit code and verdict are unaffected.
- **F-006 (MEDIUM) - admin-check false positive on a correctly admin-gated route.**
  `fixor-demo/src/routes/users.ts:8`; `admin-check.detector.ts`. Fires critical on a
  `/:id/promote` route that already performs an explicit admin check.
- **F-009 (MEDIUM) - admin-check false positive / scope drift onto a non-admin GET.**
  `fixor-demo-app-router/app/api/debug/env/route.ts:3`; `admin-check.detector.ts`. Fires
  critical on an env-dump GET that performs no admin operation (already covered by
  env-exposure).
- **F-013 (MEDIUM) - Engine B hint-dependence around the F-001 false positive.**
  `workflows/auditor-workflow.ts:371`; `auth-bypass.detector.ts` SYSTEM_PROMPT case 3/4.
  NOTE: the audit (item 8) ties this to the F-001 fix - the sidecar, not LLM
  convention-guessing, must be the defense. Now that the sidecar is wired (F-001),
  re-measure to confirm whether F-013 is still live or is now moot; do not assume either
  way without a repeated-sample run.

### Priority 3 - LOW findings

- **F-005 (LOW) - org-settings lookup fails open (all findings pass unfiltered).**
  `workflows/auditor-workflow.ts:300-309`. A DB blip silently ignores a customer's
  configured suppressions. Possibly intended; decide posture and surface a visible
  "suppressions not applied" signal rather than passing silently.
- **F-007 (LOW) - cross-detector duplicate criticals on one line (no cross-type merge).**
  `cli/finding-merge.ts` (dedupes by file:line:type, not across types). Confirmed on
  Engine B. Needs a report-boundary merge/priority rule.
- **F-010 (LOW) - secrets-exposure false positive on an obvious placeholder.**
  `fixor-demo-app-router/app/api/config/route.ts:3`; `secrets-exposure.detector.ts`.
  Down-rank self-identifying non-secret values.

### Also deferred - Engine-B empirical coverage gap (audit item 8)

`secrets-exposure`, `env-exposure`, and `webhook-unverified` were exercised on Engine A
only; on Engine B they are inferred-equivalent from shared `detect()` code but not
sampled. Sample them through `runAuditorWorkflow` to convert this to measured parity.

---

## Resolved / Invalid (recorded for transparency; do not carry forward)

- **F-008 - RESOLVED / INVALID (Phase 3C).** Alleged stable anon-IDOR false negative;
  re-measured 12/12 HIGH across both engines. The Phase-3 zero was a transient artifact
  and the stated mechanism was wrong. No defect.
- **F-011 - RESOLVED (Phase 3B).** Corpus gap (no parent-layout-guard instrument); a
  neutral fixture was constructed so F-001 could be measured empirically.
- **F-012 - REFUTED (Phase 3C).** Hypothesized non-determinism on the anon-IDOR verdict;
  Engine A re-run 6/6 HIGH, no zero reproduced. Stable at temperature 0.

---

## Known intentional leftovers (deliberate, not forgotten)

- **`src/test/lib/stability-harness.ts` still throws on a missing `ANTHROPIC_API_KEY`,
  by design.** Its only callers (`test-idor`, `test-idor-tenant`) now skip before
  reaching it (F-004 stage 1), so a keyless run is clean; the throw is deliberately kept
  as a fail-loud safety net for any future direct caller. Not converted to a skip on
  purpose.
- **The 15 live-LLM tests remain excluded from `test:ci` on purpose.** Their inclusion is
  gated on the F-004 stages above; they must never run live in CI (no API spend).
