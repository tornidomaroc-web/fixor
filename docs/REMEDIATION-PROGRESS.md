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

### Reasoning guardrails (learned in practice; each carries the case that produced it, because the rule without its case is a slogan)

- **Twin-matching before namespace or classification.** Before assigning an item to a
  namespace or category, find the existing item of the same SHAPE and match where its twin
  already lives. Reason from where the twin sits, not from what the item means. Two same-shaped
  items cannot sit in different series. CASE: reach (L-012) was nearly filed in `F-` on a
  significance axis (market-fit vs detector-correctness), but the tracker's axis is PROVENANCE
  (found by reading vs found by running). The tell was that L-010, its twin (readiness-bearing,
  not-a-defect, measurement-surfaced), already sat in `L-`.

- **A null-and-continue error path is a latent fabricator.** An error path that returns `null`
  or `[]` and keeps going manufactures a finding shaped like data, because a silent failure is
  indistinguishable from "analyzed, found nothing". Every error path lists its casualties BY
  NAME, never as a count. CASE: the prospector's `ghJson` swallowed metadata-fetch failures
  into `null` during the E' sourcing step and nearly shipped "the ICP is 92% TypeScript"; it was
  caught only because a sampling skew happened to be visible, and next time there may be no skew
  to notice. (First recorded in the "Failure accounting" section of `ICP-REACH.md`, now promoted
  here; the artifact points back to this rule by name rather than restating it.)

- **Coordinates rot; cross-reference by identifier.** Reference by a stable identifier, never by
  a line number and never by a range over a growing series (for example "L-001 through L-010").
  Both go stale silently on the next edit. CASE: the L-010 restatement contradiction, remembered
  as the "306-vs-758" incident, whose own name is two line numbers that no longer point
  anywhere; and the range reference the L-011 sweep had to widen the moment a new item was added.

- **Form is not the judgment; read the guard.** Never classify a call from its shape. A bare
  `where: { id }` is not an IDOR if an ownership check gates the path to it. WORKED CASE: the
  L-001 retraction (see L-001), where the shape of a where clause was treated as a verdict and
  the preceding scoped read that guarded the write was never checked.

- **Scope a convention before enforcing it; the file's own behavior outranks its literal
  reading.** Before applying a rule to a target, quote the rule as written and confirm its scope
  reaches that target. When the words are ambiguous, how the rule's own home and its author
  behave is evidence that settles the reading, and it outranks the literal text. CASE: this
  session nearly ran a wide em-dash cleanup across three internal docs to "fix" the `No em dash
  in human-facing text we author` guardrail, which is in fact scoped to public copy by its
  operationalizing reference (outreach, README, FAQ, launch posts). The proof was mechanical:
  this file, the rule's own home, uses em dashes freely, authored two weeks after the same
  author wrote the rule, which no literal reading survives. A floated `settings.local.json`
  dash-check on this file was an unadopted idea, not the convention. Caught only by quoting the
  rule and checking its home against it, before the wide diff.

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
`apps/backend/src/controllers/documentController.ts` (385 LOC; request-derived ids flowing into
Prisma lookups. CORRECTION, see L-001: an earlier revision of this file called two of these
sites unscoped IDOR. They are not. The file contains NO IDOR),
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

**RETRACTED, then RESOLVED. Read L-001 before anything else in this section.** Run 1 was first
written up as "the cause is unresolved; it is either a model judgment or a wiring bug", and
then rewritten as "a prefilter recall defect: the vulnerable code was never sent to the model."
**Both write-ups were wrong, and the second one was wrong because of a reporting error in this
file.** There was no vulnerable code. See the correction in L-001.

**MEASURED (the correction).** `documentController.ts` contains NO IDOR. The two sites this
file previously called "unscoped" are GUARDED by a preceding scoped read plus a 404:
- line 191 (`document.update({ where: { id } })`) is preceded at lines 181-188 by
  `findFirst({ where: { id, organizationId } })` and `if (!doc) return 404`. The source comment
  at line 180 says so explicitly: "We use findFirst then update if we want to be 100% sure of
  ownership".
- line 333 (`findUnique({ where: { id: documentId } })`) is preceded at lines 263-269 by the
  identical scoped read plus 404.
Every other DB call in the file is directly organization-scoped, or keyed on
`req.user.organizationId`, which is session-derived and not request-derived.

**So idor's zero-finding was CORRECT.** Not "the right outcome for the wrong reason". Correct.
There was nothing to find. Of the three candidate sites idor did send to the model, all three
are scoped reads, and it cleared all three. That is a genuine, if small, PRECISION success, and
it is the only judgment idor has actually been observed to make. Note the limit precisely: idor
never considered the two guarded writes at all, because ORM writes are not sinks (L-006). The
credit is for what it judged, not for the file as a whole.

**What Run 1 therefore did and did not establish.** It did NOT establish a recall failure. It
did NOT establish a detection defect of any kind. It established that the harness works, that
the cost model was wrong (see the correction above), and that a scan of correct code correctly
produces nothing. **Fixor has still never been measured against a real vulnerability.** That is
now the honest READY blocker; see L-010.

The structural gaps the void demonstration accidentally surfaced (L-006, L-007, L-009) are
verified from Fixor's SOURCE and remain true. L-007 and L-009 are UNWITNESSED, not
demonstrated. L-006 is no longer: it was WITNESSED under execution on 2026-07-17
(`IDOR-STRUCTURE-EXPOSURE.md`). Restated precisely: we have ZERO demonstrated missed
vulnerabilities IN REAL CODE, and ONE on a CONSTRUCTED input whose prevalence in real code is
unknown (L-006; deferred to E').

**Still UNVERIFIABLE: admin-check.** Its zero-finding on `documentRoutes.ts` was never
attributed. It may have judged correctly or silently discarded a verdict. The L-005 harness can
now settle this on any future run.

The one Run 1 call whose reasoning we DID capture is auth-bypass (see L-003).

See Priority 1d (L-001 through L-010, surfaced by Run 1), Priority 1e (L-011, surfaced by the
zero-spend structural rig), and Priority 1f (L-012, reach / market-fit, structural measurement).

## Current readiness verdict

**NOT-READY (F-004 is scoped work; detection quality is unproven on a real vulnerability).**

The audit (`READINESS-AUDIT.md`) states that items 1 and 2 of its ordered work gate a
clean READY: item 1 was F-001, item 2 is F-004. F-001 is now RESOLVED. There are TWO remaining
READY-gating blockers: F-004, and L-010.

**CORRECTION of the gate merged on `e394a09`.** That revision gated READY on L-006 + L-007 as
"confirmed recall defects", hardened from a provisional L-001 gate. **That gate was VOID.** It
rested on a demonstrated recall failure that did not occur: the file it was demonstrated on
contains no IDOR (see L-001). L-006, L-007, and L-009 are demoted to OPEN, NON-gating
structural gaps. They are real and they are verified from source. L-007 and L-009 are
UNWITNESSED. Gating READY on a recall failure we never observed would be dishonest in the other
direction.

**UPDATE 2026-07-17: L-006 is no longer UNWITNESSED, and stays NON-gating for a DIFFERENT
reason.** A genuine unguarded write-variant IDOR, constructed as the exact shape this tracker
hypothesised at the L-006 entry, was driven through the real `analyzeFile` and dropped before
the model (`IDOR-STRUCTURE-EXPOSURE.md`). That IS a demonstrated missed vulnerability — the
thing "UNWITNESSED" denies — so the word is retired for L-006 and the sentence above no longer
covers it. **The demotion survives, but not on its original basis.** What keeps L-006 non-gating
is not that we never saw the miss; it is that the miss is CONDITIONAL. It proves that IF
write-with-no-read code exists, Fixor misses it 100% of the time. Whether that shape occurs in
ICP code is L-006 PREVALENCE, which is UNKNOWN and DEFERRED to E'. If prevalence is zero the
miss costs nothing. The gate question for L-006 is now explicitly "does this shape exist in ICP
repos?", and E' answers it. Witnessing exposure does not gate READY; only a demonstrated miss
on REAL code would, and this is not one.

The gate is REPLACED, not lifted. See L-010: detection quality is unproven on a real
vulnerability. READY stays blocked because Fixor has never been measured against a genuine
vulnerability, NOT because a detector failed. Untested, not failed.

**Deliberate divergence from the audit's gate list.** The audit's formal gate is items 1 and
2 only. L-010 is not an audit item: it was surfaced by live detection-quality measurement
(see "Live detection-quality measurements"), a source the audit did not have. This tracker's
gate is therefore intentionally BROADER than `READINESS-AUDIT.md`'s. (CORRECTION of `346ed45`:
the extra gate here was L-001; L-001 is now retracted, so it is carried by L-010.) That
divergence is recorded on purpose and is not an inconsistency to be reconciled away by
narrowing this list back to the audit's. `READINESS-AUDIT.md` is left unedited; it remains an
accurate record of what the audit itself gated.

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
  produced its first datapoint (see "Live detection-quality measurements"). CORRECTION of a
  claim merged on `346ed45`: an earlier revision read this as "3 model calls emitted zero
  findings, including on a file with a known IDOR, and the reason is unresolved for all three",
  and called it the opposite of reassuring. The premise was false. The scanned file contained
  no IDOR (see L-001), so zero findings were correct on it and no detector was tested against a
  real vulnerability. The honest reading is narrower: the run proved the harness runs and that
  correct code produces nothing; detection quality remains unproven (L-010). F-004 stays
  NOT-READY.

  Note on wording: admin-check needed TWO gates, not one. A replay gate alone cannot cover it
  (see the 2b.3 entry). "Covered by a deterministic CI gate" is therefore the accurate phrase
  for the set of five; four of them (env-exposure, webhook-unverified, auth-bypass, idor) are
  covered by the *replay* gate specifically, while admin-check needs both a replay gate and a
  free deterministic gate.

- **L-010 (READY gate) - detection quality is UNPROVEN on a real vulnerability.**
  Not a defect. A measurement gap, and the honest replacement for the void L-006 + L-007 gate.

  MEASURED: the one live detection-quality run (Run 1) scanned four files of correct code. The
  IDOR target contained no IDOR. No detector was tested against a true positive. The single
  finding the run emitted (secrets-exposure, L-002) is a likely FALSE positive. admin-check's
  verdict was never captured. auth-bypass produced a would-be false positive that a blanket
  MEDIUM suppression happened to hide (L-003).

  So: **no detector in this engine has yet been shown to catch a real vulnerability.** That is
  not a failure and must not be recorded as one. It is an absence of evidence, and it is
  exactly what a READY gate is for.

  **Conditions to lift.** Run the L-005 harness (verdict capture on, L-008 fixed) against a
  target containing at least one GENUINE, unguarded IDOR, and observe idor return
  `isVulnerable: true` at HIGH on it. That single observation is the smallest thing that would
  convert "unproven" into "proven". Until then READY stays blocked.

  Cost estimate for that measurement: the cold-call unit measured in Run 1 is $0.0268 (mean;
  range $0.0226 to $0.0315), and a focused single-file idor run is 1 call. So roughly $0.03,
  gated on approval. This is cheap, and it is the single highest-value dollar available to
  spend on this project.

**CORRECTION of a claim merged on `e394a09`.** That revision stated "Recall is NO LONGER clean,
and this is now CONFIRMED rather than suspected", on the basis that a file with two unscoped
`where` clauses was scanned and nothing was emitted. **The premise was false.** Both sites are
guarded by a preceding scoped read plus a 404 (see L-001). Nothing was missed, because there
was nothing to miss.

Recall is therefore NEITHER proven clean NOR proven broken. The earlier claim that "no missed
exploit survives re-measurement" is still withdrawn, but for a different and weaker reason than
that revision gave: not because a miss was found, but because the only live measurement so far
ran against correct code and so could not have found one. Recall is UNMEASURED against a real
vulnerability (L-010). The remaining non-gating items are precision, signal-hygiene,
coverage-integrity, and the three structural gaps L-006, L-007, and L-009.

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
it is not buried in a step marked DONE. It is once again the ONLY known item that could LOSE a
real vulnerability rather than merely add noise. A previous revision (`346ed45`) said "one of
two", naming L-001 as the other; L-001 is now RETRACTED (it was a reporting error, not a recall
defect), so this reverts. The three structural gaps L-006, L-007, and L-009 COULD lose a
vulnerability in principle. L-007 and L-009 have not been observed to. **L-006 HAS been, as of
2026-07-17** (`IDOR-STRUCTURE-EXPOSURE.md`): a constructed unguarded write-variant IDOR was
dropped before the model under execution. That observation is CONDITIONAL — it proves the miss
occurs IF the shape is present, not that the shape occurs in real code (L-006 PREVALENCE,
deferred to E'), which is why L-006 remains NON-gating. No structural gap has been observed to
lose a vulnerability in REAL code.

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

These items were surfaced by Run 1. See "Live detection-quality measurements / Run 1" for the
evidence. Not all are open: L-001 is RETRACTED and L-005 is DONE; the rest are open.
(CORRECTION of "All five are OPEN", a count merged on `346ed45` that predates the L-006 through
L-010 additions and the L-005 DONE status.) The
`L-` prefix is a separate namespace from `F-`: `F-` items were surfaced by the readiness
diagnostic, `L-` items by detector MEASUREMENT. Where they overlap they are cross-referenced,
not merged.

**CORRECTION of the namespace definition (2026-07-17).** This sentence previously read "`L-`
items [were surfaced] by *live* detection-quality measurement". That was true when it was
written, but only because Run 1 was the only measurement that existed at the time; "live" was
describing the sole instance, not the boundary. It has since aged: the zero-spend structural rig
(`IDOR-STRUCTURE-EXPOSURE.md`) surfaces real detector defects with no model call at all, and E'
will surface more. The definition is therefore WIDENED to "detector measurement (live or
structural)". The organising axis of the `F-`/`L-` split is unchanged and is the thing worth
preserving: `F-` is what the readiness diagnostic found by READING, `L-` is what we found by
RUNNING the detector. A third namespace for zero-spend findings was considered and REJECTED:
that would split the taxonomy on SPEND, which says nothing about what an item is.

Provenance within the namespace is recorded per sub-section, not per item: **Priority 1d** holds
L-001 through L-010, surfaced by Run 1 (live). **Priority 1e** holds L-011, surfaced by the
zero-spend structural rig. **Priority 1f** holds L-012, also surfaced by structural measurement
but kept separate from 1e because 1e's header says "defects" and L-012 is not one (it is a
reach / market-fit finding, framed like L-010). The recurring alternative — filing an item under
a sub-section whose header its content contradicts (L-011 under 1d, or L-012 under 1e) — would
make that header FALSE, which is the defect class this tracker keeps correcting.

- **L-001 (RETRACTED; this was a REPORTING ERROR, not a detection defect) - the file idor
  "missed" contained no vulnerability.** Retained in full, per this file's convention of
  recording corrections rather than deleting them.

  **CORRECTION of claims merged on `346ed45` and `e394a09`.** Both revisions asserted that
  `documentController.ts` carries unscoped IDOR sites that idor failed to flag. **That is
  false.** MEASURED, by reading each DB call against its guards:
  - line 191 `prisma.document.update({ where: { id: id as string } })` is preceded at lines
    181-188 by `prisma.document.findFirst({ where: { id, organizationId } })` and
    `if (!doc) return 404`. The developer's own comment at line 180 states the intent: "We use
    findFirst then update if we want to be 100% sure of ownership".
  - line 333 `prisma.document.findUnique({ where: { id: documentId } })` is preceded at lines
    263-269 by the identical scoped read plus 404.
  - every other DB call is directly organization-scoped or keyed on `req.user.organizationId`
    (session-derived, not request-derived).

  This is the standard read-then-write ownership guard. The file is CORRECT CODE.

  **Consequence: idor's zero-finding was a CORRECT TRUE NEGATIVE.** It cleared the three scoped
  reads it was shown, which is a small precision success. Every previous framing in this file
  is SUPERSEDED, including "the right outcome for the wrong reason" and "it was asked the wrong
  question". It was asked a reasonable question and it answered correctly.

  **How the error happened, recorded so it is not repeated.** The phrase "mixed `where:{id}` vs
  `where:{id, organizationId}`" came in with the original task framing. The SHAPE of the where
  clauses was verified; the PRECEDING GUARD was never checked. Shape was treated as verdict.
  A bare `where: { id }` is not an IDOR if an ownership check gates the path to it. **Durable
  lesson: never classify a DB call from its where clause alone. Read the guard.**

  **What survives.** The void demonstration accidentally surfaced three real structural gaps in
  idor, all verified from Fixor's SOURCE and therefore independent of this repo: L-006, L-007,
  L-009. L-007 and L-009 are UNWITNESSED; L-006 was WITNESSED on 2026-07-17 (see its entry).
  We have ZERO demonstrated missed vulnerabilities IN REAL CODE, and ONE on a CONSTRUCTED input
  (L-006), whose prevalence in real code is unknown and deferred to E'.

- **L-006 (OPEN; WITNESSED structural gap; NON-gating on PREVALENCE) - no ORM write method is a
  sink.** DEMOTED from "HIGH, RECALL, confirmed" on `e394a09`. The MECHANISM is true and
  verified. The DEMONSTRATION was void: the write it was demonstrated on
  (`documentController.ts:190-191`) is guarded, not vulnerable.

  **WITNESSED 2026-07-17 (`IDOR-STRUCTURE-EXPOSURE.md`).** The CONSEQUENCE below is no longer
  theoretical. A genuine unguarded write-variant IDOR — exactly the `prisma.document.update({
  where: { id } })` shape this entry hypothesised — was driven through the real `analyzeFile`
  under a zero-spend lock and returned `[]` at the `:803-807` early return, model never reached.
  A read control identical but for the ORM verb (`update` -> `findUnique`) DID reach the model,
  which isolates the verb as the cause. The mechanism is universal from source, not an artefact
  of the constructed file: no write verb is in `SINK_PATTERNS`, so EVERY file whose only sink is
  an ORM write hits that same early return.

  **Why this does NOT gate READY, and why the reason has CHANGED.** The old rationale was that
  we had never observed the miss. That rationale is dead — we have now observed it. The miss is
  CONDITIONAL: it proves that IF write-with-no-read code exists, Fixor misses it 100% of the
  time. It does not establish that such code exists. That is L-006 PREVALENCE on ICP-shaped
  code: UNKNOWN, and DEFERRED to E'. If prevalence is zero, the miss costs nothing. So L-006
  stays NON-gating on PREVALENCE, not on absence of a witness, and the gate question is now
  explicitly "does this shape exist in ICP repos?".

  MEASURED (the full `SINK_PATTERNS` array was read, `idor.detector.ts:173-202`, all 15
  entries): no write verb appears anywhere, and every ORM sink is a read method across every
  family present (Prisma, Sequelize, SQLAlchemy, Django, Rails, generic). Narrow-true form:
  `node_pg_query` and `go_db_queryrow` are method-name sinks that would incidentally match a
  raw-SQL write; `raw_sql_where_id` requires a literal `SELECT`. The gap is specifically ORM
  write methods.

  CONSEQUENCE (WITNESSED 2026-07-17; was "theoretical, UNWITNESSED"): a genuinely UNGUARDED
  `prisma.document.update({ where: { id } })` is undetectable. We have now observed exactly this
  on a constructed input; what remains unobserved is whether real ICP code contains the shape.

  **The fix is NOT a simple sink addition, and this is the important part.** The `SYSTEM_PROMPT`
  is read-framed ("an IDOR exists when a route handler FETCHES a resource", "flows into a DB
  LOOKUP", LOW for "explicit ownership guard AFTER FETCH"). It never describes the
  guard-before-write idiom. Adding write sinks without a paired prompt change would enumerate
  the guarded writes in `documentController.ts` and invite the model to flag CORRECT code.
  Read-then-write is the single most common safe-write idiom, and it occurs TWICE in that one
  file. A sink-only patch would trade a recall gap of UNKNOWN PREVALENCE for real false
  positives. (Was "an unwitnessed recall gap"; the gap is now witnessed, but its prevalence —
  the thing that decides whether the trade is worth making — is still the open question.)
  Any L-006 fix must ship as: write sinks + SYSTEM_PROMPT guard-before-write handling +
  NEGATIVE fixtures. `documentController.ts` supplies excellent negatives for free (two guarded
  writes, one guarded read).

- **L-007 (OPEN; UNWITNESSED structural gap; NON-gating) - destructured request params are not
  matched as a source.** DEMOTED from "HIGH, RECALL, confirmed" on `e394a09`, same reason: the
  sink it was demonstrated against (line 332/333) is guarded, not vulnerable.

  MEASURED: `express_params` is `/\breq\.params\.\w+/`. It requires a member access after
  `req.params`, so `const { id } = req.params;` (lines 169 and 256) cannot match it. Only the
  inline `req.params.id` at line 13 was matched.

  MEASURED CONSEQUENCE (mechanism, on this file): sink 332's nearest DETECTED source was 319
  lines away, exceeding `PROXIMITY_THRESHOLD = 200`, so `enumerateSinkPairs` dropped the pair.
  Had the destructured source at line 256 been matched, the distance would have been 76, well
  inside the window. **So fixing the source match alone resolves the dropped-pair case.
  PROXIMITY_THRESHOLD is NOT the bug and MUST NOT be widened: widening it would amplify L-009.**

  Constraint: **L-007 and L-009 must be fixed together or not at all.** Matching destructured
  sources creates MORE sources, and more sources inside a 200-line window means more spurious
  cross-function pairs. Fixing L-007 alone makes L-009 measurably worse.

- **L-009 (OPEN; structural; precision, with latent recall impact; NON-gating) - source-to-sink
  pairing crosses function boundaries.** `enumerateSinkPairs` + `PROXIMITY_THRESHOLD = 200`.

  MEASURED: Run 1's pair `[1]` joined SOURCE line 13 (inside `getDocumentDetail`) to SINK line
  102 (inside `getStats`). Two entirely different route handlers, joined purely by line
  proximity. The pairing logic has no function or scope awareness; it is line distance only.

  CONSEQUENCE: a request id from handler A can be paired with a sink in handler B that the id
  never reaches. That pair is meaningless. It consumes one of the `MAX_PAIRS_PER_FILE = 12`
  slots, spends model attention, and is a latent FALSE POSITIVE source: the model is asked to
  judge a data flow that does not exist. On this file it happened to be cleared, so it cost
  only attention. On another file it might not be.

  See the L-007 constraint: these two must be fixed together.

  **MECHANISM WITNESSED under execution 2026-07-17 (`IDOR-STRUCTURE-EXPOSURE.md`), and this
  does NOT change L-009's status.** A constructed two-handler file (source in handler A, sink in
  handler B, no IDOR present) was driven through the real `analyzeFile`; the harvested candidate
  block shows the pair crossing the two handlers and reaching the model. That witnesses the
  MECHANISM, but L-009 is a PRECISION gap: a spurious pair is not a missed vulnerability, so
  this does not touch "UNWITNESSED" in the sense this tracker uses it — the word is glossed, in
  apposition and identically, in the readiness verdict and in the "What survives" note above, as
  "we have ZERO demonstrated missed vulnerabilities". L-009 remains UNWITNESSED in that sense
  and NON-gating. The cross-handler RATE on real ICP code is DEFERRED to E'.

  **AMPLIFICATION: quantified against one pattern, and tracked as L-011.** The L-007 constraint
  above ("more sources means more spurious cross-function pairs") has been measured against the
  `trpc_input_access` source pattern. Those figures live in **L-011** and are deliberately NOT
  restated here: a number carried in two entries drifts apart on the next edit, which is the
  failure mode this tracker exists to correct. L-011 owns the pattern; L-009 owns the pairing.
  The measured effects are a JOINT property of the two — fixing either reduces them — which is
  why the extraction is a split of ownership, not a transfer of blame.

- **L-010 (READY gate; NOT a defect) - detection quality is UNPROVEN on a real vulnerability.**
  See the readiness verdict for the full statement and the lift condition. Recorded here so it
  is trackable alongside the items it replaced.

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

  It paid for itself immediately: capturing the raw candidate block at zero spend is what
  revealed that idor sent only 3 pairs (not 6), which is what led to reading the file's guards
  and discovering that L-001 was a REPORTING ERROR rather than a detection defect. It also
  removed the need for the roughly $0.03 paid re-run, which would have returned "not vulnerable"
  on three scoped reads and been read as a judgment defect. (An earlier revision credited it
  with "attributing L-001 to L-006 and L-007"; that attribution is retracted with L-001.)
  Standing rule it establishes: any live run that does not persist the raw `toolInput`,
  `verdict.isVulnerable`, and `verdict.confidence` is not worth paying for.

  Remaining hygiene defect in the harness is tracked separately as L-008, not folded in here.

### Priority 1e - OPEN: defects surfaced by zero-spend structural measurement

Same `L-` namespace as Priority 1d, different provenance: these items were surfaced by the
zero-spend structural rig (`npm run measure:idor-structure`), which drives the real detector
under a replay lock and makes NO model call. See `IDOR-STRUCTURE-EXPOSURE.md` for the evidence
and its limits. Kept separate from 1d because 1d's header is a claim about Run 1, and an item
that did not come from Run 1 does not belong under it.

A note on what this provenance can and cannot establish. The rig measures the PREFILTER — which
candidate pairs the detector builds and hands to the model. It does not measure model judgment,
so it can show that a pair was FABRICATED but never that a finding was EMITTED. Every rate here
is also bounded by its corpus: the 13-repo step-4 corpus is mature OSS, not the ICP, and
`STEP4-PRODUCTION-VALIDATION.md` section 3 disqualifies it for rates while stating it IS
predictive on the pattern-matching axis. Items in this section therefore carry measured
pattern-axis facts and DEFER their ICP rates to E'.

- **L-011 (OPEN; MEASURED; precision, with latent recall impact; NON-gating on ICP RATE) -
  `trpc_input_access` matches any `input.<member>` access in any language.**

  `idor.detector.ts` SOURCE_PATTERNS: `{ id: "trpc_input_access", re: /\binput\.\w+/ }`. It
  carries NO `lang` restriction, so it applies to all 9 supported languages. tRPC is
  TypeScript-only. EXTRACTED from L-009's body on 2026-07-17: it is a defect in a SOURCE
  PATTERN, not a property of the pairing algorithm, it has an independent fix with independent
  verification, and it therefore needs its own status. L-009 remains the pairing defect.

  MEASURED (2026-07-17; 13-repo step-4 corpus; PATTERN-MATCHING AXIS ONLY). Over 46,632
  post-filter files it fires in 390 files / 1,367 hits. 73 files are non-TypeScript, where tRPC
  cannot exist. 310 are TypeScript with no tRPC marker anywhere in the file. **7 files carry a
  genuine tRPC marker.** Spurious share: **98.2% (383/390)**. What it actually matches: DOM
  `<input>` element handles (`input.value`, `input.checked`, `input.addEventListener`), plain
  string variables (`input.trim()`, `input.split('(')`), Go test-table struct fields
  (`tc.input.Expand()`), Playwright locators, and CSS selectors inside string literals
  (`"input.bulk-select:not(:checked)"`) — `findPatternHits` matches raw content with no
  string/comment awareness.

  **98.2% is a LOWER bound.** The "genuine tRPC" marker regex includes a bare `.input(`, which
  matches non-tRPC calls, so "genuine" is over-counted and spurious under-counted. The
  generosity is deliberate: being generous to the pattern keeps the finding conservative.

  MEASURED EFFECT ON L-009's PAIRING (same corpus and caveat; counterfactual = re-run the real
  pairing with this ONE pattern removed). Of 103 pairs it sources, **101 exist ONLY because it
  fired** (the sink had no other source within `PROXIMITY_THRESHOLD = 200`), and 2 HIJACKED a
  real source by being nearer — handing the model the wrong origin for a real sink. 40 files
  reach the model solely on its account. These effects are a JOINT property of this pattern and
  L-009's scope-blind pairing; fixing either reduces them.

  LATENT RECALL IMPACT, and its honest weight. `MAX_PAIRS_PER_FILE = 12`. Spurious sources
  create pairs for sinks that would otherwise have none, so they can push a file past the cap
  and truncate real pairs out. MEASURED: 2 files pushed over the cap by this pattern alone, and
  in 1 of them a real (non-trpc-sourced) candidate pair was truncated out
  (`hoppscotch/.../mock-server.service.ts`: 15 sinks, 12 pairs + 1 truncated). **That is n=1, on
  non-ICP code, and a displaced CANDIDATE is not a missed vulnerability** — the model might have
  cleared it anyway. It justifies "latent recall impact" in the descriptor and nothing stronger.

  **Why this is NON-gating.** No customer-visible FALSE POSITIVE has been demonstrated. A
  spurious pair is judged by the model, and a `false` verdict emits nothing; **zero emitted
  findings from this pattern have been observed.** Every effect above was measured on a corpus
  that is disqualified for rates, so the FP rate and the cost on ICP code are UNKNOWN and
  DEFERRED to E'. READY gates remain F-004 and L-010; this is neither. (A rationale of the form
  "it injects noise into every customer scan today" was CONSIDERED and REJECTED as unsupported:
  it conflates a fabricated pair with an emitted finding, and "every customer scan" is a rate
  claim on ICP code that this corpus cannot carry. Recorded because the rejected version is the
  tempting one.)

  **The fix, NOT implemented here.** `lang: ["ts", "tsx"]` is NOT the fix: it removes the 73
  non-TypeScript files (320 hits) and leaves the 310 TypeScript files (1,033 hits) where
  `input.value` is a DOM handle. That is roughly 19% of the file-level problem, and it would
  READ as a fix while leaving the bulk in place. The real fix needs tRPC CONTEXT, not a language
  pin: a file-level marker gate (`@trpc/`, `initTRPC`, `createTRPCRouter`, `protectedProcedure`)
  as a precondition for the pattern, optionally with the regex tightened toward the
  `{ input, ctx }` idiom. **This is a NEW CAPABILITY, not a one-liner:** `PrefilterPattern` is
  `{ id, re, lang? }` today and has no file-level precondition (a `requires?: RegExp` would be
  the smallest shape).

  Verification any fix must carry:
  1. Re-run the rig: spurious files collapse toward ~7 and fabricated pairs toward ~0.
  2. `fixtures/idor/positive/08-trpc.ts` MUST still produce its pair, and
     `fixtures/idor/negative/08-trpc-with-ctx-scoping.ts` must still behave. Both are genuine
     tRPC and both depend on this pattern. Without this, the fix trades a precision defect for a
     RECALL gap — the same trap recorded against L-006's sink-only patch.
  3. **COST GATE, before any spend.** The replay key hashes the user message, which contains the
     candidate block, so if the fix changes those two fixtures' pairs the key MOVES and they need
     re-recording (~$0.03-0.06). The rig can PREDICT this for free: shadow the proposed change
     over the 26 fixtures and diff the pairs. Predict first; the spend decision comes to the
     owner with the prediction in hand, not after the fact.

  **REACH context (added 2026-07-17).** On the ICP sample this pattern dominates the detector's
  reach surface (see L-012), which raises this fix's PRIORITY without changing its status.

### Priority 1f - OPEN: reach / market-fit findings surfaced by structural measurement

Same `L-` namespace as Priority 1d and 1e (found by RUNNING the detector), and a DELIBERATELY
separate subsection from 1e because 1e's header says "defects" and the item here is NOT one. Its
provenance is L- by the tracker's own axis (`F-` is what the readiness diagnostic found by
READING; `L-` is what we found by RUNNING the detector). Reach was found by running the real
`analyzeFile` over the corpus, so it is L- by that axis, not F-, regardless of the fact that it
bears on readiness. Precedent: L-010 is a READY-gate, explicitly "NOT a defect", surfaced by
measurement, and it lives in L-; readiness-relevance is orthogonal to the namespace. Filing this
as an F- item would have forced F- to absorb "found by running" — which is L-'s definition — so
F- and L- would overlap and stop being a partition. This subsection needs no definition change.

- **L-012 (OPEN; MEASURED; reach / market-fit; NOT a defect; NON-gating) - the idor detector
  reaches the model on 2 of 43 ICP repos.** Confirmed under real execution
  (`ICP-REACH.md`).

  NOT a defect, and framed like L-010: a MEASUREMENT finding, not a detector error. It carries
  no witnessed/unwitnessed adjective — that word is a recall-axis word and this is neither
  recall nor precision. It is a fact about where the detector APPLIES, not about whether it is
  correct where it applies.

  MEASURED (2026-07-17; 43 SHA-pinned TS/JS ICP repos; `icp-corpus-2026-07-17.json`). Every one
  of the 3,987 analyzable files was driven through the REAL `analyzeFile` under the zero-spend
  lock (not the shadow — this number is load-bearing). The real detector agreed with the
  drift-guarded shadow on every file: ZERO disagreements. Repos where the model is reached: 2 /
  43 (`azirbel/npoint`, `jasonkneen/tiny-world-builder`), 8 files. Wilson 95% over repos:
  [1.3%, 15.5%].

  NOT A BROKEN DETECTOR — this is the whole finding, and it must not be misread. When a repo IS
  a server app with request-id→sink flows, the detector reaches it fine (tiny-world-builder, 7
  serverless functions). 41 of 43 ICP repos are NOT that kind of app: they are libraries,
  components, browser extensions, and CLIs with no HTTP route handler (see `ICP-REACH.md` §4 for
  the per-repo typing). The finding is about the MARKET, not the detector's correctness: IDOR
  detection applies to a small minority of what the ICP actually ships.

  **Why NON-gating, live rationale.** Reach says nothing about detection quality on a real
  vulnerability — that is C's job (the CVE target that lifts L-010). It neither lifts nor
  pressures F-004 or L-010; the READY gates stand exactly where they are. It is filed as a
  first-order market-fit finding the product owner must weigh, not as a gate.

  CAVEAT, in its own words: n=43, a SAMPLE not a census (GitHub search caps at 1000/query),
  TS/JS only, with churn and language bias carried from sourcing. "The detector reaches ~5% of
  the ICP" is DESCRIPTIVE of these 43 repos; the Wilson interval [1.3%, 15.5%] is descriptive of
  this sample, not an inference to all ICP repos. Acting on it as market truth needs a larger
  sample or explicit acceptance of that interval.

  CROSS-REFERENCE: L-011 owns the reason 7 of the 8 reaching files are what they are (the
  `trpc_input_access` pattern dominates the reach surface). L-012 owns the reach fact; L-011
  owns the pattern. Neither restates the other's figures.

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
