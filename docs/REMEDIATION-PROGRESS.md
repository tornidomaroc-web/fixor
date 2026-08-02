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
- DATED PROSE IS ANNOTATED, NEVER REWRITTEN, and the annotation goes where the reader meets
  it BEFORE the claim, not after. One annotation per CAUSE, not per stale sentence: when one
  change falsified several passages, they get a single block naming all of them, because
  splitting one cause into several corrections invites the reader to think each needs its own
  remedy. An annotation is our own explanatory text, so a later pass may rewrite or merge it
  freely; only the dated passage underneath is protected.
- ANNOTATIONS CITE THE CAUSE, NOT THEMSELVES. Name the PR that falsified the claim, plus the
  date of the annotation. Never cite the annotating PR: a PR cannot know its own number while
  its text is being written, and that number tells a reader nothing they can act on. Sweep and
  provenance details belong in this file, not in the annotated document.

### Reasoning guardrails (learned in practice; each carries the case that produced it, because the rule without its case is a slogan)

Entry bar for this list: a new bullet earns its place only if it carries a general
lesson that a real error cost us to extract, and is neither merely good practice nor a
restatement of a bullet already here. The heading's rule (no case, no bullet) is
necessary but not sufficient; the nine below set the full standard a tenth must clear,
each having been paid for by a specific, named mistake. This bar sits above the list,
not within it: a rule about how rules enter the ledger is not a detector lesson the way
the nine are, and gating the list from inside the list would be the first violation of
its own spirit. The count is maintained with every addition, which is the whole point of
the CORRECTION below; seven to eight when the seventh bullet landed, and eight to nine
when the ninth did, are that maintenance, not further errors.

**CORRECTION of this lead-in's own count, stale from `bf2dea9` (PR #109) until this
entry.** It read "the five below ... a sixth must clear" and "the way the five are".
`474aa57` (PR #113) added the sixth bullet, `Cite a resolved item's STATUS, never its
TITLE`, without touching the lead-in that counts the bullets, so the count was wrong by
one for four PRs. Corrected to seven here rather than silently, because this entry adds
the seventh bullet and that bullet is about exactly this failure: a claim that outlived
the change which falsified it, on a surface the change did not look at. A lead-in that
counts a list it sits above is the same shape of defect as a printed string that
describes code it sits beside.

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

- **Cite a resolved item's STATUS, never its TITLE.** A ledger row's name is the HYPOTHESIS that
  opened it; its status column is what the evidence SETTLED. Read the status before leaning on
  the item, because a struck-through row still reads as a live assertion at a glance, and the
  title is the part that gets quoted. CASE: `c1f0204` (#112) justified L-010's stability caveat
  with "F-012 records real temperature-0 non-determinism on an IDOR verdict". That is F-012's
  TITLE, near enough; its status column says REFUTED, and the row's own body says the verdict is
  stable at `temperature: 0`. The citation inverted the finding and landed a contradiction
  against the F-012 entry that had been sitting in this same file since `a37c766` (#78). The
  guardrail on identifiers (see `Coordinates rot; cross-reference by identifier`) is necessary
  but not sufficient: the reference was by identifier and was still wrong, because an identifier
  names an item, not its outcome.

- **A claim lives on more than one SURFACE; a sweep certifies only the surface it swept.**
  When a code change falsifies a claim, that claim is usually asserted in several places at
  once: comments, PRINTED OUTPUT, docs, test names, workflow summaries. A sweep scoped to one
  surface leaves the others asserting the old world, and it makes them look reviewed, because
  the file now carries a freshly corrected statement next to the stale one. Sweep by CLAIM
  across surfaces, not by file across comments; and when a surface is deliberately deferred,
  name the deferral where the stale text is, not only in the PR that deferred it. CASE: PR
  #119 moved the harness `llmCalls` counter to an OBSERVED ledger at the `callClaude`
  chokepoint. `measure-stage3-calls.ts` asserted the opposite on two surfaces, a header
  comment and an `out.write` paragraph reading "it never observes callClaude". PR #136 swept
  that file's COMMENTS and corrected the header, correctly holding the printed strings back
  because changing them changes program output and so is not a docs change. The consequence
  was that the false printed paragraph then sat seven lines above a comment stating the exact
  opposite, and it survived the sweep precisely because the sweep's scope was a surface rather
  than the claim. Nothing found it until a later pass searched for the CLAIM. Distinct from
  `Coordinates rot; cross-reference by identifier`, which is about references going stale:
  here the reference was fine and the assertion was wrong, on a surface nobody had looked at.

  **SWEEP CLOSED for the infer-versus-observe claim.** Recorded here, beside the rule, rather
  than only in the PR that finished it, because that is what this rule asks for. Four surfaces
  carried "the harness infers its call count" after PR #119 falsified it, and all four are now
  reconciled: the file-header COMMENT and the `out.write` PRINTED PARAGRAPH in
  `measure-stage3-calls.ts` (PR #136 and PR #137), the `measureIdorMulti` doc comment reading
  "it has no harness-inferred `llmCalls` to diverge from", and the dated D5 passage in
  `docs/detector-test-rules.md`. The last two closed together in the sweep PR. The two were
  treated differently on purpose: the doc comment is a present-tense description of current
  behaviour and was corrected outright, while the D5 passage is an explicitly dated 2026-07-22
  account and was ANNOTATED ADJACENT instead, per the preservation convention and following the
  `SESSION-CLOSE-DAY5.md` precedent. Closure is scoped to this ONE claim. It is not a statement
  that either file is otherwise clean, which is the failure mode the rule above exists to name.

  NOW CLOSED, and it was the item recorded here as STILL OPEN: `docs/detector-test-rules.md`
  D5 carries an earlier dated parenthetical, "(Note 2026-06-12: ... The harness default has
  been corrected.)", which presupposes that a harness default per-call rate still exists. PR
  #120 removed it rather than correcting it; `stability-harness.ts` now prices only when an
  entry point supplies `costPerLlmCallUsd` and has no fallback. This is the PRICING claim, not
  the call-counting claim. Closed by annotation, not by rewrite, since the passage is dated.

  Closing it exposed a defect in the first fix. The annotation added for the 2026-07-22 passage
  sat BELOW it, which left the 2026-06-12 note, one paragraph EARLIER, still unannotated and
  met first by anyone reading top to bottom. Two separate blocks would also have presented one
  cause as two corrections, inviting the reader to think each needed its own remedy, when both
  trace to #120 alone. Both notes are now covered by a SINGLE block placed ABOVE both passages.
  That is the seventh guardrail firing on our own remediation: the first fix improved one line
  and left its neighbour looking reviewed when it was not.

  WEIGHED AND ACCEPTED, so a later reader knows this was decided rather than missed: one block
  above both passages costs the reader who arrives straight at the 2026-07-22 passage from a
  search hit, who must now scroll UP to find the correction, where the previous layout put it
  immediately below. Accepted, because the 2026-06-12 passage had no coverage from ANY reading
  path before, and because the block names both passages by their opening words so an arriving
  reader knows what to look for. The remedy if it ever bites is a one-line pointer under each
  passage, which closes the gap without re-fragmenting the explanation. Deliberately NOT added
  now: nobody reads this file but us, so the cost is theoretical and the pointers are not.

- **A verification instrument decays as the thing it verifies grows; re-check the instrument
  before believing a failure it reports.** Anchoring a check by quoted text was adopted to escape
  line-number rot, and it holds only while the quoted text appears once. An annotation that quotes
  the passage it corrects puts that text in the file TWICE, so the practice of annotating steadily
  degrades the search used to verify annotations. Anchor content-located checks to line start,
  and when a check reports a difference, confirm the instrument matched what you meant before
  believing the finding. CASE: two consecutive verification runs produced their only false alarms
  from the checking tooling rather than from the artifact. First, a `var:label` split broke on the
  `C:` drive letter of a Windows path and printed "## DONE CHANGED" against a section that was
  byte-identical. Second, a `grep -F` for "Second instance (F-004 stage-3 step 2, 2026-07-22)"
  matched two lines instead of one, because the newly added annotation quoted the passage it
  annotated, and printed "CHANGED <<< STOP" against a passage that was byte-identical. Both were
  re-run anchored to line start and both artifacts were unchanged. Distinct from `Coordinates rot;
  cross-reference by identifier`, which says WHAT to anchor to: this says the anchor itself has a
  lifetime, and every annotation we add shortens it.

- **A gate you have never seen FAIL is not a gate; make it fail on purpose before you trust it
  green.** A passing check is evidence about a gate only once you know the gate can report the
  defect it was built for. Until then green is consistent with "detects the defect", with "cannot
  detect anything", and with "was never executed", and those are indistinguishable from the
  outside. So before a new gate is entered as protection, revert ONLY the predicate it guards and
  confirm it fails EXACTLY the assertions covering that defect and no others. Failing more means
  the gate is coupled to something it does not own; failing fewer means it does not cover what it
  claims. CASES, three, each paid for differently. (a) Re-recording a replay fixture to make a
  failing gate pass turns the gate into a tautology that reports success forever, which is why
  `record:*` carries the standing prohibition it does. (b) Stage-3 rehearsal (b), run
  `30467532167`: a DUMMY key was set deliberately so the gate would fail, and the red proved the
  plumbing carried it — including that `PIPESTATUS` propagates the detector's exit 1 through the
  `tee` pipe, without which the pipeline would have taken `tee`'s 0 and the red run would have
  read GREEN. That is this rule executed on purpose, at a cost of $0. (c) The Engine B
  coverage-integrity test landed 25 passing assertions, which on their own proved nothing;
  reverting only the SARIF composition predicate failed exactly the three assertions covering the
  false-closure case and left every other assertion green, and THAT is what made it evidence.
  The rule also applies to a gate that passes in a region where it cannot fail: the first paid
  stage-3 run scored every fixture at the maximum, so `perPositiveThreshold: 4` never had to
  discriminate and remains a gate we have not seen fail. Distinct from `A verification instrument
  decays as the thing it verifies grows`, which is about an instrument that was once valid losing
  its grip over time: this one is about initial validity, and asks whether the gate ever had any.

  **CORRECTION of this bullet's own case (b), false from the moment it was written until this
  entry.** It read "F-004 stage 3 step 3 was MERGED and has still never RUN, and a workflow that
  never executed closes nothing". The workflow had been dispatched TWICE before that sentence was
  authored — rehearsals (a) `30372496279` and (b) `30467532167`, both $0, both recorded in this
  file's REHEARSAL EVIDENCE block. The true claim is that no DETECTION-QUALITY run had happened.
  Worse than imprecise: rehearsal (b) is a MODEL INSTANCE of this very guardrail, so the bullet
  cited the best example in the repo as though it were the absence of one. Recorded rather than
  quietly fixed because the failure is the one this list exists to catch, and because it was
  authored and reviewed without either of us noticing — the same shape as the lead-in count
  above, on the rule rather than on the tally.

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

   **OMISSION, named 2026-07-22.** That list runs 2a, 2b.1, 2b.2 and 2b.3 and stops. **2b.4
   (idor) is missing from it**, and its record-time spend was never captured at all: 26
   recordings were made and no cost figure was read off the recorder. 2b.5 is absent for a
   different and legitimate reason (it was $0, measured, over zero calls). So this "cumulative"
   total is not cumulative; it omits one paid recording session of unknown size. The per-call
   measurement in item 9 does NOT recover it, because the recorder persists no cost or token
   data and the session cannot be re-costed after the fact without re-running it. Recorded here
   so the sum is not read as complete.

   **Provenance caveat (important).** These four numbers are owner-reported record-time
   observations read off recorder stdout. They are NOT reproducible from this repo: the
   recorder persists no cost or token data (a recording's `meta` carries only `detectorId`,
   `model`, `systemPromptFingerprint`, `recordedAtIso`, `sourceFixture`, `expectedFlagged`,
   and the response carries no `usage` block). Anyone auditing these figures must re-run the
   recorder and spend money. They are logged here as testimony, not as verified fact.

   Note the asymmetry this file now records: the SPEND figures are testimony (nothing in the
   repo can check them), while the PROMPT-LENGTH figures in item 2 are repo-verifiable and
   were verified. Do not let the caveat on the former leak onto the latter.

6. **2b.5 (secrets-exposure) cost $0. MEASURED, not estimated.** `detectors/registry.ts`
   constructs `new SecretsExposureDetector()` with no options, so `llmValidation` is false and
   the shipped path is regex-only. It was guarded deterministically, exactly as admin-check
   bucket (b) was. Measured on the merged gate: **zero `callClaude` calls, zero recordings,
   $0.00**, over a 20-fixture corpus that is 100 percent pre-model. This is the ONE prediction
   in this section that execution confirmed rather than refuted; note the contrast with the
   "29 recordable" and "~39" counts below, both of which came from reading and were wrong. The
   difference is that this one was derived from the detector's control flow, not from counting
   files.

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

9. **The COLD and WARM per-call units are different numbers, and a multi-fixture run is almost
   all WARM (measured 2026-07-22, idor).** Every cost figure in items 1 through 8 is a COLD
   unit: `cache_read` was 0 on all of them. That is the wrong unit for a stage-3 style run.
   `test:idor` alone is 18 fixtures at N=5 in one process, so it is ONE cold call and 89 warm
   ones. Costing it with a cold figure overstates it by roughly 2x.

   Measured on `fixtures/idor/positive/02-express.ts`, two real calls back to back in one
   process (artifact `docs/measurements/idor-percall-2026-07-22.json`, spend $0.03199755):

   | unit | USD | input | output | cacheCreation | cacheRead |
   |---|---:|---:|---:|---:|---:|
   | cold | 0.02047125 | 1,235 | 450 | 2,671 | 0 |
   | warm | 0.0115263 | 1,235 | 468 | 0 | 2,671 |

   **The cache term is a CONSTANT.** `cacheCreationInputTokens` was 2,671 on this call and on
   both prior idor captures, because it is the idor system prompt and nothing else. So the
   cold-minus-warm surcharge is exactly `2671 * 3 * (1.25 - 0.10) / 1e6` = **$0.00921495**, and
   the observed $0.00894495 is that constant minus the 18 extra output tokens on call 2. This
   supersedes the worst-case formula in items 4 and 8 with an exact one:

   ```
   cost_d(N) = (F_d x N) x W_d  +  P_d x 0.00921495
   ```

   one cold surcharge per PROCESS per DETECTOR, everything else warm. Item 8 was right that the
   premium is per distinct detector; what it could not say, because the warm unit did not exist
   yet, is that the premium is a surcharge over a warm baseline rather than the price of a call.

   **Method, and the trap it avoided.** The figures come from the raw `message.usage` via
   `lastCallCost`, never from the harness `estimatedCostUsd`. A free `FIXOR_REPLAY=1` rehearsal
   was run BEFORE spending and FAILED, catching that a direct `analyzeFile` call builds a
   different user message than `detect()` plus `buildSyntheticDiff` (which strips trailing blank
   lines), so the two produce different request keys. The paid run would otherwise have measured
   a request stage 3 never sends. Rule for the next paid measurement: enter by the same door as
   the thing you are costing, and prove it with a keyless replay rehearsal, which costs nothing
   and fails loudly when the door is wrong.

   **Do not turn this into a new flat constant.** $0.0115263 is one fixture's warm unit, chosen
   slightly above median with two pairs, where output tokens are about 61 percent of the unit.
   One-verdict fixtures and negatives will be lower. The lesson of item 4 applies to this number
   too: report the measured unit with its scope, not a single figure multiplied across a corpus.

   **UPDATE 2026-07-23 (PR #120): the harness now SELF-REPORTS measured cost.** Items 1 through 8
   above are hand-arithmetic and owner testimony because, at the time, the harness could only
   multiply a count by a constant. That is fixed. `runStabilityHarness` now sums the real
   per-call USD from the PR1 ledger and reports it in three labelled modes (MEASURED, NOT
   MEASURED with a `$0.00` actual, MIXED), so a live stage-3 run emits its own measured cost with
   no constant. The hand-arithmetic in this section is no longer the only way to get the number;
   it stands as the record of how the figure was derived before the harness could. Item 4's
   warning against the harness's PROJECTED-manifest figure still stands, but for a different
   projection: that one lives in `replay-harness`, not the stability harness.

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
detector fired at most once. **UPDATE 2026-07-22: the warm-call unit is now MEASURED for idor.**
The sentence that stood here, "The warm-call unit remains UNMEASURED", was true when written and
is now false; it is replaced rather than deleted, per this file's convention. Measured warm unit
for idor is **$0.0115263** against a cold **$0.02047125** on the same fixture in one process
(recording-cost lessons item 9; artifact `docs/measurements/idor-percall-2026-07-22.json`). The
warm unit is about 56 percent of the cold one, and the difference is the fixed cache surcharge
$0.00921495. This is measured for idor ONLY; the other five detectors' warm units remain
unmeasured, and the 0.00828 constant used for four of them has not been decomposed into cold and
warm. **As of PR #120 the C/W model here is the harness's PROJECTION fallback, not its cost
path**: a live run reports real summed cost from the ledger, and this model is used only to
project a would-cost-live figure when no real usage exists. The original requirement below is
what the idor measurement satisfied. Measuring it requires a
scope where one detector fires on two or more files inside the 5-minute cache TTL.

**UPDATE 2026-07-24 (PR A): `pricedCalls` now means "usage was present", not "the success path
ran".** The MEASURED versus NOT-MEASURED versus MIXED mode is selected purely by comparing
`pricedCalls` to `calls`, so a MEASURED reading is only as trustworthy as the priced count. Before
PR A, a successful call with no `message.usage` block still incremented `pricedCalls` at a
fabricated $0.00, which the mode logic would read as a real MEASURED figure. PR A guards the ledger
write on `usage` at the `callClaude` chokepoint, so an absent-usage success now counts toward
`calls` but not `pricedCalls`, and the harness reports NOT MEASURED or MIXED instead of a fabricated
MEASURED. See the RESOLVED bullet in Priority 1c for the measured proof. This changes no observed
count in `measure:stage3-calls`, whose canned response carries a zeroed-but-present usage block.

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
produces nothing. As of Run 1, Fixor had never been measured against a real vulnerability; that
gate was later DISCHARGED by the langflow C run (2026-07-19), on which idor returned
`isVulnerable: true` at HIGH (see L-010).

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
zero-spend structural rig), and Priority 1f (L-012 and L-013, reach / market-fit, structural
measurement).

### Temperature-0 is stable on the STRUCTURED verdict and variable in PROSE (n=1, 2026-07-22)

Incidental to the idor per-call cost measurement, at no extra call. Not a detector finding and
carries no `L-` id; recorded here because it sharpens a distinction the stability claims in this
file do not currently draw.

The live call reproduced the frozen recording for the same fixture, made twelve days earlier
(`fixtures/replay/idor-multi/`, recorded 2026-07-10), on EVERY structured field: both verdicts
`isVulnerable: true`, `confidence: "high"`, `callerAuth: "unclear"`, `operationClass:
"user_resource"`. The free-text `reasoning` and `suggestedFix` differ, so the tool input is not
byte-identical.

Sharper, from within the run itself: the two paid calls were seconds apart, same process,
`temperature: 0`, byte-identical request, and returned **450 versus 468 output tokens**. So
run-to-run prose variation at temperature 0 is directly observed, while the decision the
pipeline actually consumes did not move.

**What this does and does not say.** It does NOT disturb L-010's n=1 caveat, which rests on the
absence of repeated sampling of a real-world verdict and is untouched by one fixture
observation. It does NOT contradict the existing stability measurements (F-012 refuted, 12/12
HIGH; Phase 3D auth-bypass 6/6): those measured structured verdicts, which is the thing that
held here too. What it adds is that "deterministic at temperature 0" should be stated about the
STRUCTURED decision only. Anything that diffs raw model text, including a future recording
comparison, should expect prose drift and compare parsed fields instead. The replay gate already
does the right thing here, since it keys on the request rather than the response text.

## Current readiness verdict

**NOT-READY (F-004 is scoped work; detection is now demonstrated once on a real vulnerability but
not yet shown stable or cross-framework, so L-010 is a non-gating caveat and F-004 is the sole
substantive gate).**

The audit (`READINESS-AUDIT.md`) states that items 1 and 2 of its ordered work gate a
clean READY: item 1 was F-001, item 2 is F-004. F-001 is now RESOLVED. L-010, formerly the second
READY-gating blocker, is LIFTED PARTIAL and demoted to a non-gating caveat (see its body below),
so the sole substantive READY-gating blocker is now F-004.

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

The void L-006 + L-007 gate was REPLACED by L-010 (detection unproven on a real vulnerability),
not lifted. L-010 has since itself been LIFTED PARTIAL: the langflow C run demonstrated detection
once (see L-010's body). READY no longer stays blocked on "never measured"; it stays NOT-READY on
F-004 alone, with L-010 carrying a caveat that detection is not yet shown stable or
cross-framework. Untested became tested-once, not failed.

**Deliberate divergence from the audit's gate list.** The audit's formal gate is items 1 and
2 only. L-010 is not an audit item: it was surfaced by live detection-quality measurement
(see "Live detection-quality measurements"), a source the audit did not have. This tracker's
gate is therefore intentionally BROADER than `READINESS-AUDIT.md`'s. (CORRECTION of `346ed45`:
the extra gate here was L-001; L-001 is now retracted, so it is carried by L-010.) That
divergence is recorded on purpose and is not an inconsistency to be reconciled away by
narrowing this list back to the audit's. `READINESS-AUDIT.md` is left unedited; it remains an
accurate record of what the audit itself gated.

**UPDATE 2026-07-19: the divergence has since COLLAPSED.** L-010, the one extra gate that made
this tracker's list broader than the audit's, is now LIFTED PARTIAL and non-gating (the langflow
C run demonstrated detection once). With L-010 no longer gating, this tracker's substantive
READY gate is once again F-004 alone, the same as the audit's item 2. The block above is retained
as the record of why the lists diverged while they did.

- **F-004 - the live-LLM detection brain is guarded by a deterministic gate on every
  detector, and by nothing that tests model judgment.**
  All six detectors (env-exposure, webhook-unverified, auth-bypass, admin-check, idor, and
  secrets-exposure) are now covered by a deterministic CI gate, so **stage 2 is COMPLETE**.
  Stage 1 is merged (PR #77) and stage 2 sub-steps 2a (env-exposure, PR #79), 2b.0
  (shared harness, PR #81/#82), 2b.1 (webhook-unverified, PR #83/#84/#85), 2b.2 (auth-bypass,
  PR #87/#88/#89), 2b.3 (admin-check, PR #90/#91/#92), 2b.4 (idor, PR #95/#96/#97), and 2b.5
  (secrets-exposure, PR #115) are all merged. **F-004 is still NOT closed. Stage 3 step 3 (the
  opt-in live model-judgment workflow file) is now MERGED (PR #121, squash `419c6824`) but has
  NEVER executed; merging that workflow did NOT lift F-004, because a merged workflow that has
  never run closes nothing. F-004 stays OPEN pending a green RUN.**
  (Pointer, 2026-08-02: stage 3 HAS since executed and one detector passed live; "a green RUN"
  means across all six. See the UPDATE at the Priority 1 F-004 header.)

  Six of six detectors gated is progress, not readiness. Every gate landed so far is a
  wiring-and-parsing gate: none of them verifies detection quality. Stage 3 (live) has now
  produced its first datapoint (see "Live detection-quality measurements"). CORRECTION of a
  claim merged on `346ed45`: an earlier revision read this as "3 model calls emitted zero
  findings, including on a file with a known IDOR, and the reason is unresolved for all three",
  and called it the opposite of reassuring. The premise was false. The scanned file contained
  no IDOR (see L-001), so zero findings were correct on it and no detector was tested against a
  real vulnerability. The honest reading is narrower: the run proved the harness runs and that
  correct code produces nothing; detection quality remains unproven (L-010). F-004 stays
  NOT-READY.

  Note on wording: "covered by a deterministic CI gate" is a single phrase covering THREE
  different instruments, and the distinction is structural, not cosmetic. It is decided by how
  much of a detector's shipped path reaches the model:
  - **Replay gate only** (4): env-exposure, webhook-unverified, auth-bypass, idor. Every
    fixture reaches `callClaude`, so a recorded response covers the whole corpus.
  - **Both gates** (1): admin-check. It is MIXED: 30 fixtures reach the model and are covered
    by replay, while 12 terminate before it (3 pre-model drops, 9 Option G bypass) and are
    covered by a free deterministic gate. A replay gate alone cannot cover it (see the 2b.3
    entry).
  - **Free deterministic gate ALONE** (1): secrets-exposure. `registry.ts` constructs it with
    `llmValidation` false, so NO fixture reaches the model and a replay gate is not merely
    unnecessary but structurally impossible: no request means no key to record under, and
    `runReplayGate` asserts exact manifest coverage. This is a third shape, not a variant of
    the other two, and it is why 2b.5 cost $0 and shipped as one PR rather than two.

- **L-010 (READY gate - LIFTED PARTIAL, with caveat; NOT a defect) - detection DEMONSTRATED
  once on a real vulnerability; stability and cross-framework reach NOT established.**
  The existence gate this item held (Fixor had never been measured against a real vulnerability)
  is DISCHARGED. What one HIGH true positive does NOT prove is kept open below as a caveat, not
  closed. It is a non-gating caveat: F-004 is now the sole substantive READY gate.

  LIFTED ON INSPECTABLE EVIDENCE (2026-07-19; capture `test-output/cve-repro/realcall.out`,
  driver `test-output/cve-repro/real-call-driver.js`). The L-005 harness ran live (key present,
  no replay lock, exactly one `callClaude`) over a GENUINE, unguarded, ground-truthed IDOR:
  `langflow` `src/backend/base/langflow/api/v1/monitor.py`, pinned parent
  `4a9866696ce7576f499f925f734284dbcced025f`, candidate pair source L111 (`update_message`) to
  sink L117 (`session.get(MessageTable, message_id)`). idor returned, verbatim from the captured
  `toolInput`:
  - `isVulnerable: true`
  - `confidence: "high"`
  - `operationClass: "user_resource"`
  - `callerAuth: "authenticated"`
  - `ruleId: idor-fastapi_typed_path_param-sqlalchemy_session_get`
  - `systemPromptFingerprint: 5f5129f12b11` (the committed idor prompt)

  Ground truth, by reading the guard: the parent fetches by raw `message_id` under generic
  `Depends(get_current_active_user)` with no ownership filter and no post-fetch check, while
  sibling handlers scope by `Flow.user_id == current_user.id`; the fix adds
  `get_message_for_user(session, current_user.id, message_id)`. The finding is correct.

  COST: `$0.02712525`, real usage, cold call (`cacheReadInputTokens` 0; model
  `claude-sonnet-4-6`; input 4423 / output 256 / cacheCreation 2671). One observation.

  RETIRED: the sentence "no detector in this engine has yet been shown to catch a real
  vulnerability" is now FALSE and is removed. idor has been shown to catch one real
  vulnerability.

  **What this does NOT prove (why L-010 carries a caveat rather than closing clean):**
  - n=1, a SINGLE sample, so STABILITY under resampling is UNESTABLISHED. The standing
    convention in `How we work` (repeated sampling before a HIGH is entered as stable; the
    F-008 lesson) means one HIGH is not a stable verdict, and this one has not been
    repeat-sampled. The caveat rests on the ABSENCE of resampling, NOT on any observed
    instability. **CORRECTION of a claim merged on `c1f0204` (#112).** That revision justified
    this bullet with "F-012 records real temperature-0 non-determinism on an IDOR verdict".
    **That is false.** F-012 was REFUTED in Phase 3C: the anon-IDOR verdict was re-measured
    12/12 HIGH across both engines on byte-identical input and is stable at `temperature: 0`
    (the F-012 row and the Phase 3C section of `READINESS-FINDINGS.md`). No detector-verdict
    instability at `temperature: 0` has been observed anywhere in this project; both
    repeated-sampling measurements on record went the other way, on two different detectors
    (F-012/F-008: idor, 12/12 HIGH across both engines; Phase 3D: auth-bypass, 6/6 per engine,
    CONFIRMED STABLE). The caveat SURVIVES unchanged on the n=1 ground alone; only its
    stated reason was wrong. L-010's status is untouched by this correction: still LIFTED
    PARTIAL and non-gating, with F-004 the sole substantive READY gate.
  - CROSS-FRAMEWORK detection is UNESTABLISHED. The success is on the FastAPI path-param to
    `session.get` idiom (the `ruleId` says so). L-013 measures that the prefilter reaches ONLY
    that idiom cleanly and is structurally blind to service-layer sinks and cross-file flows. So
    this proves detection on the one idiom the detector reaches, and nothing about the idioms
    L-013 shows it misses.

**CORRECTION of a claim merged on `e394a09`.** That revision stated "Recall is NO LONGER clean,
and this is now CONFIRMED rather than suspected", on the basis that a file with two unscoped
`where` clauses was scanned and nothing was emitted. **The premise was false.** Both sites are
guarded by a preceding scoped read plus a 404 (see L-001). Nothing was missed, because there
was nothing to miss.

Recall is therefore NEITHER proven clean NOR proven broken. The earlier claim that "no missed
exploit survives re-measurement" is still withdrawn, but for a different and weaker reason than
that revision gave: not because a miss was found, but because the only live measurement so far
ran against correct code and so could not have found one. Recall has since been MEASURED ONCE, on
one FastAPI-idiom target (the langflow C run, a true positive idor caught; see L-010); broader
recall across other idioms and under repeated sampling remains unmeasured. The remaining
non-gating items are precision, signal-hygiene,
coverage-integrity, and the three structural gaps L-006, L-007, and L-009. **UPDATE
2026-08-02 (PR #141, squash `38d5c7ca`, then PR #143, squash `7cbc3893`): coverage-integrity
AS F-002 AND F-003 SCOPED IT is now closed on both engines and leaves this list.** #141
closed F-003 and F-002's Engine A half; #143 closed F-002's Engine B half, so on the CLI and
on the webhook path alike a thrown detector degrades the run and its zero findings cannot
read as clean. This annotation supersedes the 2026-08-01 one, which read "HALF closed and
stays on this list for its other half"; that half is the half #143 closed. What does NOT
leave the list is coverage-integrity in general: F-014 is a live input-fidelity gap on
Engine A, found while verifying the engine-symmetry claim #143 makes, and the scoped phrase
above is the reason it needs its own row rather than reopening this one. None of this moves
the READY gate, which is still F-004 alone.

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
  **CONFIRMED by 2b.5 (PR #115): the prediction held, and in its strongest form.**
  secrets-exposure turned out to be "instead of" rather than "alongside": measured keylessly,
  0 of its 20 fixtures reach the model, so it needed no replay gate at all and shipped as one
  PR rather than two.

  **Honesty constraints on 2b.3 (carried forward).**
  - A green replay check verifies wiring, tool-input parsing, and the verdict path ONLY. It
    does NOT verify detection quality. Stage 3 (live, repeated sampling) remains.
  - The #90 gate exercises **7 of the 11 literal-tier patterns**. Four are exercised by
    NOTHING: `email_eq_literal`, `py_email_endswith_at`, `role_fallback_admin`,
    `body_role_check`. Two of those four (`py_email_endswith_at`, `body_role_check`) are
    shadowed by an earlier match in the very fixtures meant to exercise them, so adding an
    assertion alone cannot reach them. They need NEW fixtures whose earliest match is the
    intended pattern. Follow-up, not done here.

    **SUPERSEDED by PR C1 (branch `fix/admin-check-prefilter-coverage`), and PARTLY
    CORRECTED.** The wording above is left as entered. Three of the four are now exercised
    (`email_eq_literal`, `role_fallback_admin`, `body_role_check`), taking the gate from 7 of
    11 to **10 of 11**. The fourth, `py_email_endswith_at`, does NOT need a new fixture and
    never did: it is unreachable by any input, because its `/i` regex is equivalent to
    `email_endswith_at`, which sits earlier in `PREFILTER_PATTERNS` and wins every tie under
    `prefilterRegex`'s strict `<`. It is dead code, not a coverage gap. Full reasoning, and
    the evidence that this was already true at `ba80fe0`, in the CORRECTION block under
    Priority 1c.

    **CLOSED by PR C2 (branch `fix/admin-check-drop-dead-py-pattern`).** `py_email_endswith_at`
    was DELETED rather than gated, so the denominator changed with it: the gate now reads
    **10 of 10**, full literal-tier coverage, not a gamed "11 of 11" obtained by keeping an
    unreachable pattern alive to be counted. Deletion was proven behaviour-preserving over all
    45 fixtures plus 14 synthetic shapes (0 wins, 0 outcome changes). Gating was rejected for
    four reasons — poorer Python explanation, SARIF ruleId-fingerprint churn re-opening triaged
    alerts, no Python instance of the shape ever observed in any scanned corpus, and the fact
    that deletion leaves the load-bearing `/i` guarded by `positive/08` while gating would have
    left two paths unguarded. Recorded in full under Priority 1c. Zero spend; no recordings
    moved.
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

    **FIXED by PR C1 (branch `fix/admin-check-prefilter-coverage`).** Both occurrences, not
    just the `:805` one logged here: the same sentence had a twin in the `llmValidation`
    field doc comment. Both now name all six. The adjacent Day 4 "6 FPs" claim was left
    alone; see the Priority 1c entry.

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

- **F-004 stage 2 sub-step 2b.5 (secrets-exposure) MERGED - PR #115.** The sixth and final
  detector gated, which COMPLETES STAGE 2. One PR, not the two 2b.3 needed and not the three
  2b.4 needed, because this detector has no model-reaching bucket to record.

  Exact scope: a free deterministic gate (`src/test/test-secrets-exposure-prefilter.ts`) over
  the existing 20-fixture `fixtures/secrets-exposure/` corpus, wired into `test:ci` right after
  `test:admin-check-prefilter`; a dated note appended to `fixtures/secrets-exposure/META.md`;
  and this sweep. No detector change, no new fixture, no recording.

  **Durable measured facts (execution, not reading).** Every number here came from running the
  detector keylessly over the corpus, per the 2b.3 lesson that a split regenerated by reading
  WILL be wrong:
  - **20 fixtures, 10 bypass and 10 pre-model drops, 0 model-reaching.** The drops split 4
    `server-only marker`, 5 `no regex match`, 1 `path filter`.
  - **Cost $0.00 over zero calls and zero recordings.** `llmValidation` is false from
    `registry.ts`, so the single `callClaude` site is unreachable on the shipped path.
  - **10 of the 15 `PREFILTER_PATTERNS` are exercised.** The 5 that are not split into two
    kinds, and the distinction is actionable: `aws_secret_literal` and `postgres_url_password`
    are SHADOWED (they match, but a different pattern matches earlier and wins, so adding an
    assertion cannot reach them; they need NEW fixtures whose earliest match is the intended
    pattern), while `google_api_key`, `stripe_live_publishable` and `private_key_literal` are
    ABSENT (no fixture matches them at all). Both shadowed patterns lose inside the very
    fixture named for them, the same failure mode 2b.3 measured on admin-check.
    **COVERAGE GAP CLOSED by PR B (branch `secrets-exposure-prefilter-coverage-15of15`),
    measured 2026-07-23.** The 2b.5 count and split above are preserved as the historical
    measurement; the state is now 15 of 15 exercised, re-measured keylessly (0 `callClaude`
    attempts). Five positives were added and pinned in `test-secrets-exposure-prefilter.ts`:
    the three ABSENT patterns get `positive/11-google-api-key-hardcoded.ts`,
    `positive/12-stripe-publishable-live.ts` and `positive/13-private-key-hardcoded.ts`; the
    two SHADOWED patterns get `positive/14-aws-secret-literal.ts` (no AKIA id present, so
    `aws_access_key` never precedes `aws_secret_literal`) and `positive/15-postgres-url-password.ts`
    (no `password: "..."` field before the URL, so `password_literal` never precedes
    `postgres_url_password`). Fixtures `positive/06` and `positive/08` are unchanged and still
    win under their earlier-line patterns; the new fixtures reach the shadowed patterns by
    removing the shadowing pattern from the file, not by reordering. This is the deterministic
    prefilter axis only; it does NOT touch the separate live-model-coverage gap (secrets-exposure
    remains excluded from stage 3), and it does NOT lift F-004.
  - **No fixture in the corpus is redaction-shaped.** The Day 13 exemption was validated
    against 21 ad-hoc cases that were never committed, so neither the full-exemption drop nor
    the partial `redactionSkipCount` path is exercised by anything. The gate pins that ABSENCE
    as an invariant rather than asserting over an empty manifest, which would look like
    coverage while providing none. Same treatment for the `bypass: unknown patternId`
    fail-safe, whose silent-drop behavior would otherwise lose a finding unnoticed.

  **Honesty constraints.** A green run here is a wiring-and-parsing gate: it proves the Option
  G regex bypass emits the finding it claims to emit, and verifies nothing about whether that
  finding is correct. Detection quality is stage 3. The 5 unguarded patterns and the
  unexercised redaction paths are real coverage gaps, stated in the test header and in
  `META.md` so a green check is not misread as completeness. It did NOT close F-004: **stage 3
  remains, and completing stage 2 does not lift the READY gate.**

- **F-004 2b.3-merged tracker update MERGED - PR #93, squash `ba80fe0`.** Documentation only:
  recorded F-004 stage 2 sub-step 2b.3 (admin-check, two gates) as merged. No code, test, or
  CI change.

- **F-004 SYSTEM_PROMPT/2b.4-scoping tracker update MERGED - PR #94, squash `5363d88`.**
  Documentation only: corrected the measured `SYSTEM_PROMPT` length table (withdrawing the
  inverted admin-check-vs-auth-bypass claim) and recorded the 2b.4 idor scoping facts. No
  code, test, or CI change.

- **F-004 stage 3 step 3 MERGED, NOT YET RUN - PR #121, squash `419c6824`.**
  (Pointer, 2026-08-02: this entry's TITLE is now stale. The file has since executed three times
  — rehearsals `30372496279` and `30467532167` at $0, then the first paid run `30754480093`,
  which passed `idor-tenant` for a measured $0.2713. F-004 is still OPEN; see the UPDATE at the
  Priority 1 F-004 header for what "a green RUN" must mean. Cite this entry's STATUS, not its
  title.)
  Adds
  `.github/workflows/stage3-live-detection.yml`, the `workflow_dispatch`-only live
  detection-quality gate (the six `runStabilityHarness` callers at n=5: env-exposure,
  webhook-unverified, auth-bypass, admin-check, idor, idor-tenant; secrets-exposure excluded),
  plus the tracker update recording it. Docs and workflow only, no entry-point change (N stays 5,
  thresholds stay 4/5 and 5/5). **The workflow file now exists on `main` but has NEVER executed,
  so it closes nothing.** F-004 stays OPEN pending a green RUN, which spends and is a separate
  owner decision. Guardrails baked into the file: single node 20.x with no matrix, `contents:
  read`, a `stage3-live-detection` concurrency group with `cancel-in-progress: false`, a 60-minute
  timeout, fail-loud guards that reject a keyless or replay-diverted run before any npm call, a
  `SKIPPED:`-marker belt-and-suspenders check, and a MEASURED-cost line summed into the job
  summary. Verified at merge: the three required checks (build+typecheck+tests on 20.x and 22.x,
  gitleaks+pattern scan) passed bound to the head SHA, and the `stage3-live-detection` workflow
  registered on `main` with ZERO runs, confirming the `workflow_dispatch`-only trigger did not
  fire on the merge (no spend).

- **F-004 stage-3 pre-spend defects W-001 through W-004 MERGED - PR #135, squash
  `9fa1b0046408c0044ac29b390c236f804e5e5bcb`.** Moved here from "Priority 1g - IN REVIEW" under
  NOT-DONE / DEFERRED when #135 merged, per this file's rule that an open PR is "in review,"
  never done. The entry's claims below are preserved as written; only the status tags changed
  (IN REVIEW to MERGED), and the one claim that turned out to be wrong is amended by the
  CORRECTION block at the end rather than by editing what an earlier revision asserted.

  Provenance, and it is the point of the entry: these four were found by READING
  `.github/workflows/stage3-live-detection.yml` and the code it calls, before any dispatch and
  before any key existed. No model call, no dispatch, no spend produced them. Distinct from
  Priority 1d (surfaced by Run 1, which was paid) and from Priority 1e (surfaced by the structural
  rig, which runs the real detector under a replay lock). This provenance is cheaper than either:
  the cost of finding all four was zero, and each would have been paid for in full on first
  dispatch. Fixes landed on `fix/stage3-pre-spend-defects` and merged as PR #135.

  A keyless rehearsal dispatch (run `30372496279`, 2026-07-28, conclusion `failure` in 13 s) proved
  guard 1 fires on a genuinely absent secret and that steps 4-7 skip. It cost $0 and validated only
  the guard-1 path; everything downstream of it remains unexercised. It did NOT surface these four
  — the dry read did, before it.

  - **W-001 (MERGED; availability of evidence) - `timeout-minutes: 60` was marginal, and
    marginal is the worst setting.**

    The six detectors at N=5 issue about 710 model calls plus about 11.3 minutes of aggregate
    sleeps. Allowing ~3 min for checkout, setup-node and npm ci, a ceiling tolerates
    `(ceiling - 11.3 - 3) / 710` per call: 60 min tolerates ~3.9 s/call, 120 min tolerates
    ~8.9 s/call. 4 s/call is an ordinary latency for these prompts.

    COST HAD WE DISPATCHED BLIND, at 4 s/call: the runner completes about 685 of 710 calls
    (~96%) and is then SIGKILLed at the 60-minute wall. The aggregate-total footer is written
    only after the detector loop, so it never runs. That is roughly **$6.16 of the ~$6.41
    spent for an aggregate total of nothing**, compounded by W-002 below, which threw the
    per-fixture logs away too. Raised to 120. Raising it does NOT raise maximum spend — spend is
    bounded by the call count, not the clock — and Actions minutes bill at zero on this public
    repo, so the only cost of a genuinely hung job is that a human waits up to 2 h instead of 1 h.

  - **W-002 (MERGED; availability of evidence) - no `upload-artifact` step; a paid evidence run
    discarded its own evidence.**

    The run step writes `stage3-$d.log` per detector into the workspace and the workspace dies with
    the runner. The step summary retained one grepped `cost:` line per detector; every verdict,
    every per-fixture pass/fail behind that line was destroyed at job end.

    COST HAD WE DISPATCHED BLIND: **the full ~$6.41 buys six summary lines.** Any FAIL verdict
    would be undiagnosable, and re-obtaining the logs means paying ~$6.41 again. The loss is
    strictly worse on a red run, which is exactly when the detail is needed, because the failing
    step exits non-zero and later steps skip by default. Fixed with `if: always()` and
    `if-no-files-found: warn` — `warn` rather than `error` so a guard abort, which legitimately
    produces no logs, does not stack a second misleading failure over the real one.

  - **W-003 (MERGED; guard integrity, NOT a dollar loss) - guard 1 tested `-z`, so a
    whitespace-only key cleared it.**

    `[ -z "${ANTHROPIC_API_KEY:-}" ]` is false for a secret of `" "`, so the guard passed and the
    job proceeded through npm ci into the detector run. Verified locally at zero cost: the old form
    exits 0 on `" "`, the new form exits 1.

    COST HAD WE DISPATCHED BLIND — **stated precisely, because the obvious guess is wrong.** The
    natural reading is "it proceeds to spend", and the dollar figure is in fact about **$0**: a
    blank key cannot authenticate, so the API rejects the calls unbilled. Nor does it become a
    silent green: `test-env-exposure.ts` guards with `!process.env.ANTHROPIC_API_KEY`, and `" "` is
    truthy in JS, so the entry point does NOT print `SKIPPED:` and the belt-and-suspenders
    `^SKIPPED:` net is never reached. The real cost is integrity and time, not money: the guard
    advertises a promise it does not keep, and the failure arrives as an opaque 401 storm partway
    through a job that has already run npm ci, instead of as a labelled 18-second guard failure.
    Tightened to reject empty-after-trimming.

    DELIBERATE NON-FIX, recorded so no later session "completes" it: this guard checks PRESENCE,
    never VALIDITY. A well-formed but revoked, wrong-account or rate-limited key still passes and
    still fails at the API boundary mid-spend. Proving a key WORKS costs a live call; a guard
    implying "this key is good" while proving only "this key is not blank" would buy false
    confidence at real cost. The honest gap stays.

  - **W-004 (MERGED; silent under-reporting of measured spend, plus loss of the aggregate on the
    failure path) - the summary parser knew two cost-line shapes; the harness emits four.**

    The old parser was `sed -n 's/^cost: MEASURED \$\([0-9.][0-9.]*\).*/\1/p'`, which matches only
    a line beginning `cost: MEASURED`. Enumerated from `stability-harness.ts`, which is the sole
    lib all six entry points route through, the real set is FOUR shapes:

    1. `cost: no calls made`
    2. `cost: MEASURED $X over N priced call(s)` (plus a NOTE suffix when the figure is `$0.00`)
    3. `cost: NOT MEASURED, actual $0.00 over N call(s), 0 returned usage | would-cost-live
       PROJECTION ~$Y at $Z/call (ESTIMATE, not a cost)`, or the same with
       `| no projection (no rate supplied)`
    4. `cost: MIXED. MEASURED $X over N priced call(s); M call(s) unpriced and NOT included in
       that figure`

    Shape 4 carries REAL measured dollars and was dropped silently, so a partially priced run
    under-reported its own spend. Shape 3 is the opposite trap and is why the fix is not simply a
    looser regex: it contains a PROJECTION, an ESTIMATE, and a naive "first dollar figure on the
    line" parser would book an estimate as money spent. The new `classify()` tags each line
    MEASURED / MIXED / UNMEASURED / NOCALLS and sums ONLY the measured subtotals of shapes 2 and 4;
    it never reads a figure out of shape 3.

    HOW THE SUMMARY KEEPS THE MODES APART, which is the whole point of the harness having three
    tagged modes: the footer prints a single measured total and beside it a mode census counting
    detectors per mode. MIXED contributes its priced subset and flags the total as a **LOWER
    BOUND**. NOT MEASURED contributes nothing and is labelled explicitly as NOT a measured zero.
    `no calls made` contributes nothing. A detector that produced NO `cost:` line is counted
    separately, with its spend called UNKNOWN rather than zero. An unknown shape is tagged
    UNRECOGNIZED, excluded from the total, and raises a `::warning::` — a future harness format
    change must SHOUT, because silently undercounting is the defect being closed here, and a fix
    that could fail the same silent way would not be a fix.

    DECISION TAKEN BY THE OWNER (2026-07-28), recorded because it is a judgment call and not an
    obvious default: **the aggregate footer is now emitted on the failure path as well as the
    success path.** A red run is exactly when we need to know what was already spent before the
    abort; losing both the money and the record of the money is the worst available outcome. The
    old code took `exit "$status"` mid-loop, which skipped the footer entirely, AND parsed the cost
    line only AFTER the abort decision, so the failing detector's own spend was never recorded even
    though it had already been incurred. Both are fixed: the cost line is now recorded BEFORE the
    abort check, and the footer is emitted from an `EXIT` trap.

    THE FOOTER DOES NOT SWALLOW THE FAILURE, which was the standing objection to doing this. The
    trap captures `rc=$?` as its first act and ends with `exit "$rc"`, so the step's status is
    exactly what it would have been untrapped, and `set +e` inside guarantees a hiccup writing the
    summary cannot turn a red run green. Proven locally at zero cost: the shipped `run:` block was
    extracted from the YAML and executed against a fake `npm`, and the abort case exits 1 while
    still recording the failing detector's $2.5000 in a $3.7345 total over "2 of 6 reported".

    HONEST LIMIT, so nobody reads more into the trap than it does: an `EXIT` trap does not run on
    SIGKILL. A hard timeout kill still loses the footer. W-001's 60 -> 120 raise is what addresses
    that case; this trap addresses the abort case only.

  **CORRECTION of the "before any dispatch" provenance claim, entered by `d174c746` and merged in
  PR #135, squash `9fa1b004`.** The provenance sentence above reads "found by READING ... before
  any dispatch and before any key existed." The second half is true, and the run itself
  corroborates it: the dispatch below failed precisely because no key existed. The first half is
  false, by about an hour. Rehearsal (a), run `30372496279`, was dispatched at 2026-07-28T15:15:52Z;
  the first fix commit `c3a5820` was authored at 2026-07-28T16:12:10Z. A dispatch therefore
  preceded the commit that recorded these findings, so "before any dispatch" is wrong as written.

  What this CORRECTION does NOT touch, because it is independently true and separately evidenced:
  that dispatch made no model call and spent nothing (it died at guard 1, before `npm ci`), and it
  did not surface W-001 through W-004. The dry read did. The provenance argument is unaffected;
  only the word "any" was wrong.

  **CORRECTION of the item count in the two sentences above, an inconsistency entered by
  `d174c746` and merged in PR #135, squash `9fa1b004`.** Those two sentences previously read "the
  cost of finding all three was zero" and "It did NOT surface these three." They now read "four."
  The count was never wrong about the world, it was stale: this entry was drafted for three
  defects (W-001 through W-003, the wording `c3a5820` merged), and W-004 was appended later in the
  same PR by `d174c746`, which updated the opening "these four were found by READING" and left the
  two trailing counts at three.

  Recorded here rather than renumbered silently, for one substantive reason: nothing else in this
  entry states that it grew from three items to four, and that growth is evidence for the entry's
  own thesis. W-004 was found by reading the code WHILE the first three were being fixed, which
  makes it the cheapest-provenance item of the four and the strongest case that a dry read keeps
  paying. A silent renumber would have erased that, and would have put a word into the merged
  revision's mouth that it did not use. Deliberately NOT changed: the "three" later in W-004, which
  counts the harness's three tagged cost modes and is correct.

  **REHEARSAL EVIDENCE.** Two zero-spend dispatches now exist. Neither is a detection-quality run
  and neither may be read as one.

  - **Rehearsal (a), run `30372496279`, 2026-07-28, conclusion `failure` in 13 s. Cost $0.**
    No secret was set. PROVED: guard 1 fires on a genuinely absent key and steps 4 through 7 skip.
    COVERAGE: the guard-1 path only. Everything downstream of guard 1 stayed unexercised.

  - **Rehearsal (b), run `30467532167`, 2026-07-29, conclusion `failure` in 54 s. Cost $0.**
    A dummy secret was set, `idor-tenant` alone was dispatched (the cheapest entry point, 6
    fixtures), and the secret was deleted immediately after and verified gone by a 404 on the
    secret endpoint. Every call was rejected at authentication: `401 authentication_error,
    invalid x-api-key`, 30 distinct `request_id` values for 30 calls, with `attempts: 1` logged on
    each, which confirms at runtime that a 401 is retried by neither the repo retry layer nor the
    SDK. The harness reported `0 priced` and `actual $0.00`. Actions billing reports
    `billable.UBUNTU.total_ms: 0`, so the rehearsal was free in minutes as well as in dollars.

    PROVED, and every item here was unexercised before (b): the `case "$SELECTION"` mapping
    resolves a single detector; guard 2, setup-node and `npm ci` all pass; `PIPESTATUS` propagates
    the detector's exit 1 through the `tee` pipe, which is load-bearing, because had it not, the
    pipeline would have taken `tee`'s 0 and the red run would have read GREEN; the emitted cost
    line is recognized and classified (shape 3, tagged UNMEASURED, its projection correctly NOT
    summed); W-004's pipe escaping keeps that shape-3 line inside its markdown cell; the `EXIT`
    trap emits the footer on the FAILURE path and still exits 1, so it does not swallow the
    failure; the cost row is written BEFORE the abort check; and W-002's artifact upload survives
    the red run and yields a downloadable 17,289-byte log.

    NOT exercised even by (b): the `^SKIPPED:` belt-and-suspenders net, because the abort exits on
    the detector's status before that grep is reached.

  **FIRST PAID RUN — run `30754480093`, 2026-08-02, conclusion `success` in 3m57s. MEASURED
  $0.2713.** Selection `idor-tenant` alone, dispatched on `main` at `f8090ade`. A real
  `ANTHROPIC_API_KEY` was set as a repository secret by hand through the GitHub UI, never passing
  through tooling, and was deleted immediately after the run and verified gone by a 404 plus a
  `total_count=0` on the secrets list. Live exposure of the credential on a PUBLIC repo: about 25
  minutes. Before the secret was set, the repo held ZERO secrets and no workflow could spend; the
  spend surface was re-enumerated at `f8090ade` before dispatch and `stage3-live-detection.yml` is
  the only path to the key (`ci.yml` names it in a COMMENT with no `env:` block, `pages.yml` uses
  no secrets, `secrets.yml` uses only the auto-provided `GITHUB_TOKEN`, and no workflow uses
  `pull_request_target`).

  **TWO RESULTS OF DIFFERENT SCOPE. Do not collapse them into one sentence in either direction.**

  1. **The DETECTION result is NARROW.** `idor-tenant`, 6 fixtures, n=5, one of six detectors.
     Every fixture at maximum: the 3 positives `flagged 5/5` (bar is >=4/5) and the 3 negatives
     `correctly-skipped 5/5` (bar is 5/5, zero-FP). Aggregates 3/3, 3/3, 6/6. `PASS`. The harness
     states its own ceiling and it is repeated here rather than paraphrased: *n=5 catches
     stochasticity at 20% resolution. Zero FP at n=5 means "no FP at this resolution," not
     "calibrated."* Six fixtures cannot support a rate. **This does NOT lift F-004**, which gates
     on all six detectors.
  2. **The WORKFLOW result is BROAD, and is the first of its kind in this project.** The entire
     paid path executed end to end: both guards, the `case "$SELECTION"` mapping, setup-node,
     `npm ci`, the detector, a cost shape that had never been emitted live, the success footer, and
     the artifact upload. Hedging this into the narrow claim would understate what $0.2713 bought.

  **WHY THIS IS A MEASUREMENT AND (b) WAS NOT — the internal control.** In rehearsal (b) the three
  negatives also read `5/5` and meant NOTHING: nothing was flagged because every call errored, so
  the passes were hollow and the harness said so. Here the POSITIVES flagged 5/5 on the SAME run,
  which demonstrates the detector was actively emitting findings. **That is what turns the
  negatives' silence into evidence rather than absence.** A negative passing by not-firing is only
  informative when something else fired alongside it. Transport was clean: `LLM calls: 30 (OBSERVED
  at callClaude; 30 priced), no-verdict: 0, transport failures: 0`. `SYSTEM_PROMPT` fingerprint
  `5f5129f12b11`, unchanged from (b).

  **COST, MEASURED AGAINST THE PROJECTION IT BEAT.** The projection for this detector is
  `30 x $0.0115263 + 1 x $0.00921495` = **$0.355** (the source of the `$0.36` row). Measured
  **$0.2713**, about 24% under. Backing out the implied warm unit: `($0.2713 - $0.00921495) / 30`
  = **$0.008736 per call**, which lands INSIDE the band this tracker predicted for itself — the
  cost-model section calls $0.0115263 a "CONSERVATIVE UPPER" taken from a deliberately
  above-median two-pair positive and states that one-verdict fixtures and negatives "will come in
  lower, plausibly $0.008 to $0.010". So the measurement CONFIRMS the model's own self-assessment
  rather than merely beating its point estimate, which is the stronger and more useful result.

  **DO NOT RESCALE THE REMAINING FIVE BY THIS DATAPOINT.** It licenses a correction to the
  `idor-tenant` component and nothing else. `test:idor` (18 fixtures) and `test:idor-multi` (2)
  share idor's prompt but not its fixture mix, and the four non-idor detectors run on a SUPPLIED
  $0.00828 constant that has never been measured and, in this file's own words, "carries the SAME
  cold-versus-warm ambiguity and has not been decomposed". Multiplying $6.41 by 0.764 would be
  exactly what the cost-model section warns against — the flat-constant mistake at a third number.
  Cost shape 2 was also PARSED correctly by the workflow's `classify()` on first contact, with no
  `::warning::`: the measurement path works end to end, which is a fact about the instrument, not
  about the other five detectors.

  **UPDATE 2026-08-02 (run `30754480093`): the six items below are the PRE-RUN prediction and are
  now partly resolved. Resolved in place, item by item, rather than rewritten, so the prediction
  and the outcome can be read side by side.** (1) CLOSED for this corpus only. (2) HALF: shape 2
  (MEASURED) was emitted AND parsed live for the first time; shape 4 (MIXED) and the LOWER BOUND
  flag remain unexercised. (3) CLOSED — the success footer rendered (`All selected detectors
  passed. Measured total: $0.2713`). (4) STILL OPEN — the run finished in 3m57s, which tells us
  nothing about the 120-minute ceiling. (5) CLOSED — key validity is proven by 30 priced calls.
  (6) **NARROWED, NOT CLOSED.** The thresholds have now run against real verdicts, but EVERY
  fixture scored at the maximum, so `perPositiveThreshold: 4` never had to discriminate: a
  5/5-only run cannot distinguish a threshold of 4 from a threshold of 5. The threshold logic
  executed in the region where it cannot fail, which is the ninth reasoning guardrail pointed at
  our own green result.

  **WHAT REMAINS PROVABLE ONLY BY A PAID RUN.** Recorded because a paid run is the next step, and
  the record should state what that run is buying.

  1. DETECTION QUALITY. Zero verdicts were produced by either rehearsal. In (b) every positive
     scored `flagged 0/5 FAIL` and every negative `correctly-skipped 5/5 PASS`, and those negative
     passes are HOLLOW: a negative passes when nothing is flagged, and nothing was flagged because
     every call errored. The harness states this itself ("Any pass on a negative may be hollow")
     and failed the run on `totalLlmErrors`, which is that gate working as designed.
  2. COST SHAPES 2 (MEASURED) and 4 (MIXED). Both require calls that return usage, so neither has
     ever been emitted live. The summing arithmetic and the MIXED LOWER BOUND flag remain
     unexercised end to end. Only shape 3 has been observed live.
  3. THE FOOTER ON A SUCCESSFUL RUN. Only the aborted path has rendered. The success path, without
     the RUN ABORTED banner, has never been produced.
  4. W-001's TIMEOUT ARITHMETIC. The 120-minute ceiling remains theory: run (b) finished in 54
     seconds, so nothing has tested the wall.
  5. KEY VALIDITY. Guard 1 proves presence and never validity, exactly as the DELIBERATE NON-FIX
     note under W-003 states. Rehearsal (b) is the live demonstration of that gap: a well-formed
     key cleared the guard and failed at the API boundary.
  6. THE 4/5 AND 5/5 THRESHOLD LOGIC. `perPositiveThreshold: 4` and `perNegativeThreshold: 5` have
     never been evaluated against real verdicts, only against the degenerate all-error case.

- **F-003 RESOLVED, F-002 NARROWED - PR #141, squash
  `38d5c7cae71a97c2f3924d7a946d4f8e1734000e`.** The coverage-integrity gate on Engine A now sees
  two failure classes it was structurally blind to. Both were the shape the second reasoning
  guardrail names: an error path that kept going and produced zero findings indistinguishable from
  "analyzed and found clean". Neither reached the gate, because the gate counts `callClaude`
  outcomes at the client chokepoint and both failures happen OUTSIDE it. The demonstration was a
  two-file repo with both files unreadable: it reported both as scanned, zero findings, full
  coverage, exit 0 — a scan that read nothing, presenting as clean. That is an AFFIRMATIVE false
  assurance, not a silence, which is why it was treated as more than a missing warning.

  Exact scope, and only this scope:
  1. A file whose analysis aborted is recorded as `FileScanResult.notAnalyzed` carrying the STAGE
     it died at (`read`, `build-diff`, `resolve-route-guard`, `detect`), so an operator can tell a
     permissions problem from a bug. The outer catch always spanned more than the read; naming the
     stage is what makes that catchment legible.
  2. A detector that threw is recorded as a `FileScanResult.detectorFailures` entry carrying the
     detector id. Casualties BY NAME, never as a count, per the guardrail.
  3. Both render by name in the report's "Coverage gaps" section, and both feed
     `countCoverageDegradations` (`cli/report-builder.ts`), whose single total drives the banner,
     the summary block AND the exit code, so the report and the exit code cannot disagree.
  4. `coverageExitCode` keeps its signature and its one job. What COUNTS as degradation is composed
     by the caller, so the exit-code mapping stays the one place that maps "something went wrong" to
     a number.
  5. The three channels are deliberately NOT merged into the `llm-coverage` tally. That tally means
     "detection calls attempted/failed" and is read by the SARIF invocation record and by spend
     measurement; laundering an unreadable file into it as a failed API call would corrupt both.
     They share a verdict, not a counter.
  6. "Total files scanned" counted files the scan never opened. The report now separates files
     ENUMERATED from files fully ANALYZED.
  7. New deterministic keyless test `src/test/test-scan-coverage-integrity.ts`, wired into `test:ci`
     as `test:scan-coverage`. No API spend.

  **BREAKING, and recorded as such because it changes an automation contract:** the scan CLI exits
  2 on two failure classes that previously exited 0. Runs that were green may now be red. That is
  the point — those runs were never clean.

  **UPDATE 2026-08-02 (PR #143, squash `7cbc3893`): the paragraph below is a dated record of the
  state at #141, not a live status. F-002's Engine B half is now CLOSED and its ledger row reads
  RESOLVED.** The paragraph's closing observation held up: the half-fixed finding was not read as
  done at a glance, and the half it named as carrying the larger blast radius is exactly the half
  #143 closed.

  **F-002 is NARROWED, NOT CLOSED, and the ledger row stays OPEN.** Item 2 above fixes the detector
  throw on Engine A only. The identical defect is live on Engine B (`runAuditorWorkflow`), the
  CUSTOMER-FACING path, so the larger blast radius is precisely the part still open. Recorded
  explicitly because a half-fixed finding whose visible half is fixed is the easiest kind to read as
  done at a glance.

  **`docs/READINESS-AUDIT.md` deliberately NOT edited, weighed and accepted.** It carries F-003 on
  four surfaces (the Evidentiary-gaps summary bullet, the MEDIUM entries for F-002 and F-003, and
  item 3 of its ordered work list), all now stale. Left alone anyway: the audit is a DATED snapshot
  ("Date: 2026-07-01 ... Diagnosis only - no fixes applied") and this file already records that it
  "is left unedited; it remains an accurate record of what the audit itself gated". The settling
  evidence is the file's own behavior, per the `scope a convention before enforcing it` guardrail:
  the audit has been touched exactly once, at creation in PR #75, and was NOT touched when F-001 —
  its own headline gate, still described in its VERDICT banner as the thing blocking READY — was
  resolved. A MEDIUM does not earn an edit that a HIGH did not. Recorded here so a later reader
  knows this was decided rather than missed, which is the whole cost of a deliberate deferral.

- **F-002 RESOLVED - PR #143, squash `7cbc3893e0b8c40667d446952f638ee6c69de883`.** The Engine B
  half, `runAuditorWorkflow`, the shipped customer-facing path. A detector that threw was caught
  by `Promise.allSettled`, captured to Sentry, logged, and skipped; the run then reported
  `status: "no_action"`, `errors: []`, and SARIF `invocations[0].executionSuccessful: true` with
  no notification. Better OBSERVED than Engine A's pre-#141 path and just as invisible to the
  run's own verdict, which is the point: Sentry is read by us, and SARIF is read by GitHub Code
  Scanning with no human in the loop. That flag was an AFFIRMATIVE false assurance, not a missing
  warning.

  Exact scope, and only this scope:
  1. A thrown detector is recorded as `WorkflowResult.detectorFailures`, carrying the detector id.
     Casualties BY NAME, never as a count, per the guardrail. Same field name and shape as Engine
     A's `FileScanResult.detectorFailures`, so the correspondence is visible rather than
     coincidental.
  2. It pushes a `WorkflowError` through the SAME channel as the LLM-coverage failure and the
     route-guard degradation, so the status machine cannot tell the three apart. `status` can
     never read `no_action` or `success` while any of them is set.
  3. SARIF `executionSuccessful` is now COMPOSED from every coverage channel (failed LLM calls
     AND thrown detectors) rather than read off the LLM tally alone, and the notification names
     each cause. Route-guard failures are deliberately NOT in this composition; see F-014.
  4. The channels are NOT merged into `llmCoverage`. That tally means "detection calls
     attempted/failed" and is read by spend measurement; laundering a thrown detector into it as
     a failed API call would corrupt the spend record. They share a verdict, not a counter.
  5. `errText` extracted to `src/lib/err-text.ts` and imported by BOTH engines. Two copies of a
     truncation helper would let one failure render two ways depending on which engine saw it.
     One implementation is what makes the symmetry claim in item 7 true rather than approximately
     true.
  6. New deterministic keyless test `src/test/test-workflow-coverage-integrity.ts`, wired into
     `test:ci` as `test:workflow-coverage`, beside its Engine A twin `test:scan-coverage`. Zero
     API spend, by four independent locks (key deleted; base URL pointed at a dead loopback port;
     a benign diff that clears no prefilter; and both workflow cases ASSERT
     `llmCoverage.attempted === 0`, so a prefilter that ever starts matching fails the test loudly
     instead of quietly starting to spend). The first three PREVENT, the fourth DETECTS.
  7. **The symmetry claim, stated narrow on purpose.** The engines are symmetric ON THE
     DETECTOR-THROW CHANNEL: same field name, same shape, same rendering helper, same inability to
     read as clean. They are NOT symmetric on the route-guard channel, and F-014 is that
     asymmetry. Written narrow because a PR that removes three false claims must not add a fourth,
     and "the engines are symmetric" unqualified would have been one.

  **VERIFIED BY NEGATIVE CONTROL, not by a green run.** 25 assertions passing proves nothing on
  its own. Reverting ONLY the SARIF composition predicate (item 3) back to `cov.failed > 0`
  failed EXACTLY the three case-1 assertions and no others, with every workflow-side assertion
  still green. That reproduces the false-closure scenario mechanically and demonstrates the test
  DETECTS the defect rather than agreeing with the fix. This is the standard recorded as the
  ninth reasoning guardrail.

  **Recorded, not defended with code:** the injected failure is an `async` detector whose promise
  rejects, which is the only shape reachable from shipping code today — all six shipping detectors
  are declared `async detect(`, so a SYNCHRONOUS throw (which would escape `Promise.allSettled`
  and crash the run rather than degrade it) cannot occur. That is an observation about the current
  registry, not a guarantee. It lives in the test's doc comment, which is what a person changing
  the registry reads; a ledger row for an unreachable hypothetical would be noise, on the same
  reasoning that rejected a duplicate guardrail two stages earlier.

- **Merge read-back: the four assertions are NOT four independent proofs.** CLAUDE.md §5 requires
  asserting all four after any merge — squash SHA on `main`, PR-head tree == `main` tree, head ref
  404, local branch absent — and flagged the case as owed here. Recorded now, measured at #143
  (gh 2.91.0, git 2.53.0, Windows).

  What the assertions are actually worth. **Assertion 3 (head ref 404) is satisfied by the
  server-side `delete_branch_on_merge` setting, which has been `true` since 2026-08-01,
  REGARDLESS of what the client did.** It therefore cannot distinguish "`--delete-branch` worked"
  from "the repo setting cleaned up after it", and it is not evidence about the client at all.
  Only assertion 4 tests the client half, which is the half that silently survived at #141.
  **Assertion 2 (tree equality) is the strongest of the four** and is the one that does real work:
  `main`'s tree and the PR head's tree were both `6a52974c`, byte-identical, which transfers the
  PR's green CI verdict to the squash commit as proof rather than as inference.

  Mechanism, because it is not obvious and it is the reason assertion 4 passed. `gh pr merge
  --delete-branch` cannot delete the branch the working copy is standing on, so gh fetched,
  fast-forwarded local `main` `185542c..7cbc389`, switched HEAD to `main`, and only then deleted
  the local branch. Assertion 4 passing is therefore a property of gh's behaviour when invoked
  FROM the merged branch, not a property of the repo. A merge driven from a detached HEAD, from
  another branch, or from the web UI would not exercise that path, and the local branch would
  survive again exactly as it did at #141.

### IN REVIEW (open PR, awaiting merge command - NOT merged, NOT done)

- None. No open tracker PR is awaiting the merge command. (Stage-3 step 3 merged as PR #121;
  see the DONE entry "F-004 stage 3 step 3 MERGED, NOT YET RUN".)

  **Convention, so a later session does not "fix" this section into a lie.** A tracker PR does
  NOT list ITSELF here while it is open. Such a row would be accurate only until the merge
  command and false on `main` forever after, since the text freezes at merge while the status it
  asserts does not. Leaving "None." is stale only transiently and heals itself on merge, which is
  the strictly smaller error. Settled by precedent, not preference: PR #122 wrote this very line
  while it was itself open and awaiting the merge command.

---

## NOT-DONE / DEFERRED (ordered worklist)

### Priority 1 - F-004 remaining stages (HIGH; the READY gate)

**UPDATE 2026-08-02 (run `30754480093`): stage 3 HAS now executed and one detector has passed
live. F-004 REMAINS OPEN. Read the phrase "pending a green RUN" below as "pending a green run
ACROSS ALL SIX DETECTORS" — a one-detector canary does not satisfy it.** This annotation covers
SIX passages falsified by the same cause, and they are named here rather than corrected
separately: this paragraph; "F-004 is still NOT closed ... never run closes nothing" under the
stage-2 completion note; "The workflow file now exists on `main` but has NEVER executed" in the
PR #121 DONE entry; "STEP 3 STATUS (workflow file MERGED, NOT YET RUN)"; "This does NOT lift
F-004. A merged workflow that has never executed closes nothing"; and "Stage 3 has never
executed, so this is true of ALL SIX harness bars". Each carries a one-line pointer back here.

**Why this annotation is the urgent part of the run's record.** Every one of those passages read
correctly until 2026-08-02. The paid run falsified them WITHOUT changing what F-004 requires, so
a reader arriving at any of them now finds a sentence whose literal condition is satisfied by a
canary that measured one detector out of six. That is F-002's shape one level up: a gate whose
canary went green reading as a gate that passed. The run armed it; this block defuses it.

**Stage 2 is COMPLETE**: sub-step 2a (env-exposure), sub-step 2b.0 (the shared harness),
sub-step 2b.1 (webhook-unverified), sub-step 2b.2 (auth-bypass), sub-step 2b.3 (admin-check),
sub-step 2b.4 (idor), and sub-step 2b.5 (secrets-exposure) are all merged, so every shipping
detector now has a deterministic keyless gate in CI. **F-004 is still NOT closed. Stage 3 step 3,
the workflow_dispatch file, is MERGED (PR #121, squash `419c6824`) but has never run (see the
Stage 3 bullet below); merging it did NOT lift F-004, because a workflow that has never executed
closes nothing. F-004 stays OPEN pending a green RUN.** The model-judgment gate (stage 3) is only ever
exercised by opt-in live runs, never free-in-CI, so completing stage 2 does not lift F-004 and
the READY verdict is unchanged.

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
  - **Sub-step 2b.5 (secrets-exposure): DONE, merged (PR #115).** See DONE above. The sixth
    and last detector gated, and the only one needing NO replay gate at all: `registry.ts`
    constructs `SecretsExposureDetector()` with no options, so `llmValidation` is false and
    the single `callClaude` site is structurally unreachable on the shipped path. Measured
    keylessly over the 20-fixture corpus: 10 Option G bypass positives and 10 pre-model drops,
    zero model-reaching, so **measured recording cost $0 over zero calls and zero recordings**,
    matching the estimate. `assertEnvFlagUnset(...OPT_IN_GUARD.SECRETS)` is its opt-in guard
    (PR #114). Now an enforced keyless CI guard; previously secrets-exposure was ungated in CI
    entirely.
    Separately, secrets-exposure carries F-010 (a known false positive on an obvious
    placeholder). Every expectation pinned by the gate FREEZES current behavior as a wiring
    sample only; it does NOT endorse that verdict as correct. Fixing F-010 is separate
    precision work (see Priority 3) and is new work. **CORRECTION of the re-recording clause
    written before 2b.5 landed:** that clause said a fixture "must then be re-recorded", which
    is a category error for this sub-step. 2b.5 has no requests, no responses and no
    recordings, so an F-010 fix cannot invalidate a recording here; what it could invalidate is
    a pinned expectation in the gate, which is a code edit at $0. Measured further: no fixture
    in the corpus exhibits F-010's self-identifying-placeholder shape, so no pin is currently
    believed to encode that bug.

- **Stage 3 - opt-in live workflow (manual, spends only when run).** A GitHub Actions
  workflow on `workflow_dispatch` only (NO fork-PR trigger, NO nightly schedule), reading
  `ANTHROPIC_API_KEY` from a repo secret the owner sets, running the live detector tests
  with repeated sampling so a single flaky verdict cannot pass as stable. This is the only
  gate that exercises the model's judgment.

  **STEP 3 STATUS (workflow file MERGED, NOT YET RUN; PR #121, squash `419c6824`).**
  (Pointer, 2026-08-02: superseded — the file has now executed three times, twice free and once
  paid. See the UPDATE at the Priority 1 F-004 header.) The file is
  `.github/workflows/stage3-live-detection.yml`, now on `main` and never executed. It triggers on
  `workflow_dispatch` only, runs
  one job on a single node 20.x (no matrix, which would double the spend), holds a
  `stage3-live-detection` concurrency group with `cancel-in-progress: false`, and times out at
  60 minutes. Its one input is a detector selector (`all` or one of env-exposure,
  webhook-unverified, auth-bypass, admin-check, idor, idor-tenant), so a single-detector canary
  can run without editing code. There is deliberately NO N input: the six entry points pass
  `nRuns: 5` as a literal and hardcode `perPositiveThreshold` 4 and `perNegativeThreshold` 5, so
  any N below 5 makes the thresholds unsatisfiable and every fixture FAILs. Two fail-loud guards
  run before any npm invocation: one asserts `ANTHROPIC_API_KEY` is present and non-empty (the
  entry points exit 0 when keyless, so without this a keyless run would print SKIPPED and read as
  a pass that tested nothing), the other asserts `FIXOR_REPLAY`, `FIXOR_RECORD` and
  `FIXOR_ESCALATE_MEDIUM` are unset (a replay-diverted run spends nothing and measures nothing, a
  false-green; escalation silently doubles cost on medium verdicts). A belt-and-suspenders check
  fails if any script prints a `SKIPPED:` marker. The run tees each script's stdout, greps the
  harness `cost: MEASURED` line into the job summary, and sums the invoked detectors into a run
  total shown next to the pre-run projection; since PR #120 the MEASURED ledger figure takes
  precedence over the 0.00828 projection on a live priced run.

  **DIVERGENCE FROM THE AUDIT, recorded here as the primary location (the YAML header carries the
  same text for the person pressing Run).** The audit asked for a gated CI lane or a nightly
  required check. This ships neither. RESIDUAL RISK, stated plainly: a detection-quality
  regression is caught ONLY when a human presses Run, never automatically on a PR and never on a
  schedule, so a commit that degrades model judgment can merge and ship without this gate ever
  firing. MITIGATION IS BY CONVENTION, NOT AUTOMATION: this workflow is a REQUIRED manual check
  before flipping READY and before any tagged release, a required check on a rare event
  deliberately traded against paying it on every PR. The audit's stronger posture is a known,
  accepted gap, not an oversight. COVERAGE GAP to reaffirm at F-004-lift time: secrets-exposure
  has NO live coverage at all, and idor-multi, the two lane tests (auth-bypass-lane,
  express-lane), and h8 exercise live model judgment but cannot route through the
  positive/negative harness, so they are outside this gate.

  **This does NOT lift F-004.** A merged workflow that has never executed closes nothing. F-004
  lifts only on a green RUN, which spends and is a separate owner decision.
  (Pointer, 2026-08-02: the workflow has since executed and `idor-tenant` passed live for
  $0.2713. F-004 still does NOT lift — "a green RUN" means across all six detectors. See the
  UPDATE at the Priority 1 F-004 header.)

  **CORRECTION of the sampling claim written before step 1 landed.** The sentence above
  previously said the workflow runs "the live detector tests through the existing
  `stability-harness`", which presumed they already plug into it. **They did not.**
  `runStabilityHarness` had exactly TWO callers (`test-idor`, `test-idor-tenant`); the rest
  called `detect()` once per fixture, so a live run would have produced NO repeated sampling
  while looking green, defeating the point of the stage. The related "N>=3" phrasing also
  understated the repo's own practice: the established convention is the **nRuns rule at
  N=5** with a >=4/5 per-fixture threshold, implemented independently in several places.
  The real inventory, as of step 1 (PR #116):
  - **Routed through `stability-harness` (6):** `test:idor` and `test:idor-tenant` (already
    were), plus `test:auth-bypass`, `test:admin-check`, `test:env-exposure` and
    `test:webhook-unverified` (wrapped by step 1). All at n=5, positives >=4/5, negatives
    5/5, aggregates corpus-relative and all-passing.
  - **Self-replay at N=5 OUTSIDE the harness, correctly (4):** `test:idor-multi` (exact
    expected/forbidden sink-line SET, which the harness's boolean `flagged` cannot express),
    `test:auth-bypass-lane` and `test:express-lane` (lane fires/silent classification, no
    positive/negative corpus), and `test:h8-escalation` (Opus 4.8 escalation anchors, K=5,
    binary all-must-hold). Wrapping any of these would LOSE assertions, so they stay out by
    design, not by omission.
  - **EXCLUDED from stage 3 (1): secrets-exposure.** `registry.ts` constructs it with
    `llmValidation` false, so its shipped path never calls the model and is already fully
    gated for $0 by 2b.5. Sampling it live would either make zero calls (a duplicate of the
    free gate) or exercise the opt-in LLM path the product never runs and that Day 7
    deliberately disabled for leaking secret values into PR output. **Consequence to state
    at F-004 lift time: one of six detectors will have NO live model-judgment coverage.**
  - **Not yet sampled, and inconsistent with its siblings:** `test:idor-lane` is single-shot
    while the other two lane tests are at N=5. See Priority 1c.

  **CORRECTION of the entry-point count, by MEASUREMENT (stage-3 step 2).** The inventory
  above says the model-reaching set is reached through the SIX harness-routed entry points.
  It is not. Those six enumerate **142**, not 144. The missing two are `fixtures/idor-multi`,
  reached only by `test:idor-multi`, which the very next bullet correctly places OUTSIDE the
  harness because it asserts exact sink-line sets that the harness's boolean `flagged` cannot
  express. **Reaching the full model-reaching set therefore requires SEVEN entry points, one
  of which does not use `runStabilityHarness`.** Anyone driving "all of stage 3" from the
  six-item list will silently measure 142 and read the 2-call gap as a discrepancy that does
  not exist. The IDOR replay spec already spanned all three corpora (`fixtures/idor` 18,
  `fixtures/idor-tenant` 6, `fixtures/idor-multi` 2 = 26); this list did not.

  **CORRECTION of the "all-passing" claim in the six-item inventory above, entered by `f62921e`
  (PR #116, 2026-07-22).** The bullet says all six harness-routed entry points are
  "corpus-relative and all-passing". Five are. `test:idor` is not, and never was.
  `src/test/test-idor.ts` has carried `positivesMinPassing: 6` / `negativesMinPassing: 6` /
  `combinedMinPassing: 12` since `07fe2d3` (#52, 2026-05-15), when its corpus was 8 and 8;
  `ff3c364` (2026-05-28) grew it to 9 and 9, leaving a 6-of-9 bar (67 percent) on BOTH sides.
  PR #116 wrapped the four tests that were not yet harness-routed and correctly noted that
  `test:idor` and `test:idor-tenant` "already were", then generalized to all six a property it
  had just conferred on four, without inspecting the two it had not touched. `test:idor-tenant`
  happens to be all-passing already (3/3/6 against 3 and 3), which is why only one of the two
  carries the defect. Corrected to 9/9/18 on branch `fix/idor-aggregates-all-pass`.

  **The corrected bar is UNVERIFIED at its new height.** Raising these aggregates is a POLICY
  change, not a measurement: no live n=5 run of `fixtures/idor` has ever been taken at 9/9/18.
  Stage 3 has never executed, so this is true of ALL SIX harness bars at their current heights,
  not only idor's. The frozen replay recordings are n=1 and establish no stability.
  (Pointer, 2026-08-02: stage 3 has since executed once, paid, for `idor-tenant` ONLY. That bar
  — 3/3, 3/3, 6/6 — is now verified at its current height; the claim above still holds for the
  other five, and `fixtures/idor` at 9/9/18 remains untaken. See the UPDATE at the Priority 1
  F-004 header.)

  **MEASURED, not estimated: 144 model-reaching calls per sample.** `measure:stage3-calls`
  (`src/test/measure-stage3-calls.ts`, zero spend, not in `test:ci`) counts at the SDK
  boundary with a canned response, driving all seven entry points at n=1. Result:

  | detector | calls | enumerated | pre-filtered | coverage attempted | harness llmCalls | divergence |
  |---|---:|---:|---:|---:|---:|---:|
  | env-exposure | 17 | 20 | 3 | 17 | 17 | 0 |
  | webhook-unverified | 34 | 35 | 1 | 34 | 34 | 0 |
  | auth-bypass | 37 | 45 | 8 | 37 | 37 | 0 |
  | admin-check | 30 | 42 | 12 | 30 | 30 | 0 |
  | idor | 18 | 18 | 0 | 18 | 18 | 0 |
  | idor-tenant | 6 | 6 | 0 | 6 | 6 | 0 |
  | idor-multi | 2 | 2 | 0 | 2 | n/a | n/a |
  | **total** | **144** | **168** | **24** | **144** | 142 | 0 |

  Identity: 168 enumerated minus 24 pre-filtered equals 144 model-reaching. Zero real network
  calls (the real transport was invoked 0 times). **Since PR #119 the `divergence` column means
  observation against observation**, not inference against observation: the harness counter is
  now read from the call ledger at the `callClaude` chokepoint. A 0 there is therefore a
  stronger statement than it was when this table was first written. This CONFIRMS the inherited 144 by
  execution. It did not have to: the previous 144 was the size of the replay recording set,
  and the replay gate asserts recordings cover EXACTLY the manifest, so a replay run can only
  ever return 144 or fail loud. Replay restates the manifest; it cannot verify it. The
  manifests are also hand-curated and self-documented as error-prone (the admin-check spec
  warns that regenerating it by searching for pattern names WILL get it wrong), so an
  independent count was worth taking.

  **This measures CALLS, not DOLLARS.** The canned response carries zero token usage, so no
  price follows from it. A spend figure still multiplies this count by an ESTIMATED per-call
  constant. Step 2 converts "estimated calls times estimated price" into "measured calls times
  estimated price". That halves the uncertainty; it does not remove it. Closing the IDOR price
  needed a live sample and was NOT in step 2's scope. **It has since been measured; see the
  next block.**

  **IDOR per-call cost, MEASURED (2026-07-22, artifact
  `docs/measurements/idor-percall-2026-07-22.json`, spend $0.03199755 against an approved
  ~$0.035 cap).** Two real calls on `fixtures/idor/positive/02-express.ts`, one process, back
  to back, taken from the raw `message.usage` via `lastCallCost` and NOT from the harness
  `estimatedCostUsd`. All seven pre-agreed guardrails held; the transport was invoked exactly
  twice under a hard ceiling.

  | unit | USD | input | output | cacheCreation | cacheRead |
  |---|---:|---:|---:|---:|---:|
  | `C_idor` cold | **0.02047125** | 1,235 | 450 | 2,671 | 0 |
  | `W_idor` warm | **0.0115263** | 1,235 | 468 | 0 | 2,671 |

  The cache term is a CONSTANT, not an estimate: `cacheCreationInputTokens` was 2,671 here and
  on both prior idor captures, because it is the idor system prompt and nothing else. Cold
  minus warm is therefore a fixed `2671 * 3 * (1.25 - 0.10) / 1e6` = **$0.00921495**; the
  observed $0.00894495 is that constant minus the 18 extra output tokens on call 2.

  **Cost model.** A stage-3 run is not `calls x constant`, because only the FIRST call of each
  process is cold:

  ```
  cost_d(N) = (F_d x N) x W_d  +  P_d x 0.00921495
  ```

  where `F_d` is the measured model-reaching fixture count, `W_d` the warm unit, and `P_d` the
  number of separate PROCESSES. **idor is three processes, not one**: `test:idor`,
  `test:idor-tenant` and `test:idor-multi` are three npm scripts. So at N=5, idor is
  `130 x 0.0115263 + 3 x 0.00921495` = **$1.526**, non-idor is `590 x 0.00828` = **$4.885**,
  and **`stage3_total(5)` is approximately $6.41** against roughly $6.19 under the old flat
  default. The flat 0.01 UNDERSTATED the idor share by about 17 percent and the run total by
  about 3.5 percent.

  **CONSERVATIVE UPPER, not a point value.** $0.0115263 is THIS fixture's warm unit. The
  fixture was deliberately chosen as a slightly-above-median two-pair POSITIVE, and output
  tokens dominate the warm unit at about 61 percent of it. One-verdict fixtures and negatives
  will come in lower, plausibly $0.008 to $0.010, so the $1.526 idor share is a conservative
  upper estimate. **Treating $0.0115263 as an exact per-call constant would repeat the
  flat-constant mistake at a different number.** The honest fix is a cost model that separates
  the cold and warm units and the per-process cache term, which is why `test-idor.ts` and
  `test-idor-tenant.ts` were deliberately NOT given the measured figure here; see Priority 1c.
  Note also that the 0.00828 constant used for the other four detectors carries the SAME
  cold-versus-warm ambiguity and has not been decomposed.

  **This projection is now the PRE-RUN estimate, not the figure of record (PR #120).** The
  `~$6.41` table above lives in `measure:stage3-calls` and is a projection built from the
  measured idor warm unit and the supplied 0.00828 non-idor rate. A real stage-3 run no longer
  needs it: `runStabilityHarness` self-reports its own MEASURED cost from the ledger, in labelled
  modes, with no constant. So this cost line means "measured when live, projected before". The
  projection stays a conservative upper bound for the reasons in the next paragraph.

  **Measure through `detect()`, not `analyzeFile()`.** A free `FIXOR_REPLAY=1` rehearsal run
  BEFORE spending failed with `ReplayFixtureMissing`: a direct `analyzeFile` call produced a
  different request key than the frozen recording, because `buildSyntheticDiff` strips trailing
  blank lines and the two paths therefore build different user messages. Switching to
  `detect({ diff: buildSyntheticDiff(...) })` made the key match. Without the rehearsal the run
  would have spent real money measuring a request stage 3 never sends. `test:idor` and
  `test:idor-tenant` go through the harness and therefore `detect()`; only `test:idor-multi`
  calls `analyzeFile`. Any future paid measurement must enter by the same door as the thing it
  claims to be costing, and a keyless replay rehearsal is the cheap way to prove it does.

  **Hand-counting these corpora requires the sidecar filter.** A raw `ls` of
  `fixtures/idor/negative` reads 12, not 9: three entries are `.policy.sql` and companion
  sidecars that `isFixtureFile` excludes. The same trap produced the inherited "29 recordable"
  figure for idor. Every number in the table above is enumerated through `isFixtureFile`, and
  any hand re-derivation must be too.

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

- **Four literal-tier admin-check patterns are exercised by nothing: THREE OF FOUR FIXED on
  branch `fix/admin-check-prefilter-coverage` (PR C1); the fourth is not fixable and is
  reclassified below.** `email_eq_literal`, `py_email_endswith_at`, `role_fallback_admin`,
  `body_role_check`. The #90 gate covers 7 of 11. Two of the four are shadowed by an earlier
  match in the very fixtures meant to exercise them, so this needs NEW fixtures whose earliest
  `m.index` is the intended pattern; adding assertions alone cannot reach them. No API spend
  (all four are bypass-tier, no model call).

  PR C1 adds `positive/22-hardcoded-admin-email-equality.js` (`email_eq_literal`),
  `positive/23-role-nullish-fallback-admin.js` (`role_fallback_admin`) and
  `positive/24-client-supplied-role-no-route-def.js` (`body_role_check`), each shaped so the
  intended pattern is the earliest `m.index`, taking the #90 gate from 7 of 11 to 10 of 11.
  The corpus moves 42 -> 45 (24 positives, 21 negatives) and `test-admin-check.ts` moves to
  24/21/45 in the SAME commit, because landing three positives against a 21 bar would have
  decayed it to 21-of-24 and reintroduced the exact defect closed by #131. All three new
  fixtures are Option G bypasses, so the replay MANIFEST stays at 30 and no recording was
  added, moved or re-recorded. Zero spend.

  **CORRECTION of the "needs NEW fixtures" remedy as applied to `py_email_endswith_at`,
  entered by `ba80fe0` (PR #93, F-004 2b.3).** That remedy is stated above for "two of the
  four" shadowed patterns. It is correct for `body_role_check` (shadowed by
  `express_route_def` in `positive/06`, and duly fixed by `positive/24`, which defines no
  route). It is FALSE for `py_email_endswith_at`, and was false when written, not overtaken
  by later events: NO fixture can make that pattern fire, so it is dead code rather than a
  coverage gap. Its regex `/\bemail\.endswith\s*\(\s*['"]\s*@/i` is case-insensitive, which
  makes it character-for-character equivalent to `email_endswith_at`
  `/\bemail\.endsWith\s*\(\s*['"]\s*@/i` — the two differ only in the case of one literal
  letter, which `/i` erases. The two therefore match exactly the same inputs at exactly the
  same index; `email_endswith_at` sits earlier in `PREFILTER_PATTERNS`; and `prefilterRegex`
  breaks ties with a STRICT `<` (`m.index < earliest.idx`), so the earlier entry always keeps
  the slot. Verified against `ba80fe0` itself: that commit already carried both `/i` regexes
  in this order and the same strict `<`, so nothing about the detector changed afterwards to
  invalidate the claim — it did not hold on the day it was entered. `py_email_endswith_at` is
  therefore deliberately OUT of scope for PR C1 (no fixture, no gating, no deletion) and is
  deferred to PR C2 as a dead-code decision: delete it, or make it non-redundant by removing
  the `/i` flag or narrowing it to a Python-only shape. Writing a fixture for it would only
  re-prove that `email_endswith_at` wins. Still no API spend either way.

  **RESOLVED by PR C2 (branch `fix/admin-check-drop-dead-py-pattern`): DELETED, not gated.**
  The C1 diagnosis held up under a second look: `py_email_endswith_at` was unreachable by any
  input. Its regex `/\bemail\.endswith\s*\(\s*['"]\s*@/i` differed from `email_endswith_at`
  `/\bemail\.endsWith\s*\(\s*['"]\s*@/i` only in the case of one literal letter, and BOTH
  carried `/i`, which erases that difference. The two accepted exactly the same strings at
  exactly the same index; `email_endswith_at` sits earlier in `PREFILTER_PATTERNS`; and
  `prefilterRegex` breaks ties by definition order via a strict `<` (`m.index <
  earliest.idx`). The earlier entry therefore always kept the slot. Deletion was verified
  behaviour-preserving before committing, by simulating `prefilterRegex` with and without the
  pattern over the actual committed bytes of all 45 corpus fixtures plus 14 synthetic shapes
  built specifically to fire it: **0 inputs where it won, 0 differences in winning patternId
  or match index.** Literal tier goes 11 -> 10; total 17 -> 16; the gate now reads 10 of 10.
  Zero spend, and no recording moved (it never produced a callClaude request, so it never had
  one).

  Gating the pair by language was the alternative and was REJECTED on four grounds, recorded
  here because the reasoning is the durable part:
  - **The Python explanation was strictly poorer, not merely redundant.** Set side by side, it
    added only the parenthetical "(Python `email.endswith`)" — naming the syntax the reader is
    already looking at — while DROPPING the two clauses that carry the security reasoning: the
    attack surface ("any public provider with the matching suffix, or any subdomain the
    attacker controls") and the provenance caveat ("the email value itself may be spoofable if
    not from a verified source"). Gating would have shipped WORSE output to Python users, on
    the language where `email.endswith("@corp.com")` is the idiomatic spelling, for a pattern
    with a known FP class (see `docs/STEP4-PRODUCTION-VALIDATION.md`, 8 admin-check FPs).
  - **Gating would have re-opened already-triaged alerts.** `sarif-output.service.ts` builds
    finding identity as `` `${ruleId}:${file}:${line}` `` under the comment "Stable fingerprint
    for a finding, so re-runs reuse the same SARIF id". Gating changes the emitted ruleId on
    Python findings from `admin-check-email_endswith_at` to `admin-check-py_email_endswith_at`,
    so every consumer keyed on that fingerprint — GitHub code scanning baselines above all —
    would close the dismissed alert and open a new one. Deletion cannot do this: that ruleId
    was never emitted, because the pattern never won.
  - **No Python instance of the shape has ever been observed.** Across every corpus this repo
    has scanned, the shape appears three times, all camelCase in `.ts`/`.md`
    (`calcom/packages/lib/isSmsCalEmail.ts` — the Step 4 source-path FP — plus
    `Cap/.../Loom/Http.ts` and one doc table). Gating would have been a production behaviour
    change serving a file population never once seen in practice.
  - **Deletion leaves the invariant guarded; gating would not.** After deletion there is ONE
    regex, and its `/i` is what covers the Python spelling. `positive/08-flask-endswith-domain.py`
    is Python and is pinned to `email_endswith_at` in `BYPASS_EXPECTED`, so dropping `/i` makes
    that fixture match nothing, drop pre-model instead of bypassing, and fail
    `test:admin-check-prefilter`. The guard is mechanical and already exists. Under gating,
    NOTHING would have exercised camelCase-in-`.py` or snake_case-in-`.ts`; both would have
    rested on a `/i` on each side that no fixture touches.

  **CORRECTION of the remedy this very block proposed, entered by `f2010e2a` (PR #132,
  2026-07-27) — i.e. by C1 itself.** The sentence above offers "make it non-redundant by
  removing the `/i` flag" as an acceptable alternative to deletion. That was FALSE WHEN
  WRITTEN, and it is the most dangerous line in the entry: `/i` is load-bearing on BOTH
  patterns. Simulated, dropping it loses four detection classes outright — camelCase in `.py`
  (transpiled or docstring code), snake_case in `.ts` (templates, typos), and any ALLCAPS
  spelling in either language — every one of which admin-check flags today. A reader following
  that suggestion would have silently narrowed detection while believing they were tidying a
  redundancy. The `/i` on `email_endswith_at` is now documented in the detector as load-bearing
  and named as such at its `BYPASS_EXPECTED` pin. Do not remove it.
- **Stale comment at `admin-check.detector.ts:805`: FIXED on branch
  `fix/admin-check-prefilter-coverage` (PR C1).** It claims the judgment tier is
  "currently only role_string_compare"; there are six judgment-tier patterns
  (`role_string_compare` plus the five route-def patterns). Comment-only fix. Left untouched
  by the 2b.3 PRs on purpose.

  PR C1 replaces BOTH occurrences, not just the one filed here. The stale sentence had a twin
  inside the same file: the `llmValidation` field doc comment carried
  "Judgment-tier patterns (currently only `role_string_compare`)" and the Option G bypass
  comment carried "Judgment-tier patterns (currently only role_string_compare) stay on LLM
  path". Both now name all six. Anchored by quoted text rather than by the `:805` line number
  this item cites, which had already drifted. Deliberately NOT touched: the adjacent sentence
  "Judgment-tier patterns keep LLM in the loop because the Day 4 cognitive negatives all match
  `role_string_compare` — wholesale bypass would have produced 6 FPs." That claim is about a
  Day 4 measurement, and correcting or confirming it needs the Day 4 evidence, which PR C1 did
  not check. Fixing what can be verified and leaving what cannot is the point; it stays open.
- **Stale comment in `secrets-exposure.detector.ts` (twin of the admin-check one above; filed
  here by twin-matching): FIXED by PR B.** The `PrefilterPattern.explanation` doc comment named
  a nonexistent env var `FIXOR_SECRETS_LLM_VALIDATION=false` as the toggle for the regex-only
  bypass path. The real flag is `FIXOR_SECRETS_LLM_OPT_IN` (read in the `SecretsExposureDetector`
  constructor; default false, so the bypass is the shipped path). Verified by search: the old
  name appeared in that one comment and nowhere else in `src`. Comment-only fix, rode along with
  PR B (branch `secrets-exposure-prefilter-coverage-15of15`). This item was found this session
  and was NOT previously in the tracker; it is filed beside its already-filed admin-check twin
  per the twin-matching guardrail. Its twin (`admin-check.detector.ts`, above) stays OPEN and
  rides along with PR C, not this PR. No API spend.
- **idor diagnostic is lossy for lane anchoring (opened by 2b.4).** `idor.detector.ts:862`
  exposes only pair 0's verdict on `diag.verdict`; `idor.detector.ts:957` assigns
  `diag.laneDeferral` inside the per-pair loop (last-writer-wins). Neither affects shipped
  findings, but any path-anchored `EXPECTED_LANE` gate on idor is incomplete across the 14
  multi-pair files until both are widened to per-pair arrays. `EXPECTED_LANE` on idor is
  therefore deferred (kept `{}`). No API spend.
- **Generalize `assertEnvFlagUnset(name, why)` (opened by 2b.4): DONE, merged (PR #114).**
  `assertAdminCheckOptInUnset` was detector-specific in a shared harness. It is removed
  outright (no dead alias) and replaced by `assertEnvFlagUnset(name, why)` plus the
  `OPT_IN_GUARD` constant carrying `ADMIN_CHECK` and `SECRETS` entries. The constant is not
  decoration: a bare-string flag name would compile with a typo and the guard would then never
  fire, silently invalidating the very manifest partition it protects, so naming every flag in
  one checked constant restores the compile-time check the detector-specific function got for
  free. 2b.5 is its second caller (`OPT_IN_GUARD.SECRETS`). No API spend.

- **Decayed absolute thresholds in the live accuracy tests (opened by stage-3 step 1).**
  Every live detector-accuracy test gated on ABSOLUTE constants (`POSITIVES_MIN`,
  `NEGATIVES_MIN`, `COMBINED_MIN`) calibrated when the corpora were about 10 positives and 10
  negatives. The corpora grew; the constants did not. Measured decay at the time step 1
  landed: auth-bypass 7 of 22 positives (a **32 percent** bar), webhook-unverified 7 of 17
  (41 percent), admin-check 11 of 21 (52 percent), env-exposure 7 of 11 (64 percent),
  secrets-exposure 7 of 10 (70 percent). A test could pass while most positives were missed.
  **FIXED for the four wrapped by step 1** (PR #116) by moving to corpus-relative
  all-passing aggregates. **STILL OPEN for `test-secrets-exposure.ts`**, which is excluded
  from stage 3 and so was not touched: its constants remain 7/9/16 against a 10/10 corpus.
  Either retire that test or make its thresholds corpus-relative. No API spend to fix.

  **CORRECTION of the "STILL OPEN" scope of this item, entered by `f62921e` (PR #116,
  2026-07-22).** This item names `test-secrets-exposure.ts` as the sole remaining instance. It
  is not the only one. `src/test/test-idor.ts` was a second still-open instance, at
  `positivesMinPassing: 6` and `negativesMinPassing: 6` against a 9-and-9 corpus: a 6-of-9 bar
  (67 percent) on BOTH sides, inside the band this item tabulates and a looser bar than the
  env-exposure 64 percent it does list. It was omitted because it was ALREADY routed through
  `runStabilityHarness` and so fell outside step 1's scope, not because it was clean. The decay
  tabulation above is incomplete for the same reason: idor's bar decayed on `ff3c364`
  (2026-05-28), which added a ninth positive and a ninth negative without touching the constants
  set in `07fe2d3` (#52). Fixed to 9/9/18 on branch `fix/idor-aggregates-all-pass`, which leaves
  `test-secrets-exposure.ts` as the last open instance, unchanged and still 7/9/16.

  **CLOSED by PR C3 (branch `chore/retire-test-secrets-exposure`): the last open instance was
  RETIRED, not re-gated.** The either/or above ("Either retire that test or make its thresholds
  corpus-relative") is resolved on evidence, and the deciding question was not which constants
  were right but whether the file covered anything at all. It did not:
  - **Strict duplicate.** `test-secrets-exposure.ts` asserted exactly one thing per fixture, a
    `flagged` boolean (`findings.length > 0`), rolled into three aggregate bars.
    `test-secrets-exposure-prefilter.ts` runs the SAME corpus through the SAME construction
    (`new SecretsExposureDetector()`, shipped default) and asserts, per fixture, the exact
    finding count, `preFilterReason`, `flagged`, `type`, `severity`, `confidence` AND `ruleId`,
    plus zero LLM call attempts per fixture and globally, plus three corpus invariants. On the
    only axis they shared it was also strictly stricter: 15-of-15 and 10-of-10 EXACT, against
    the retired test's `>= 7` / `>= 9` / `>= 16`.
  - **It could not reach the model.** `secrets-exposure.detector.ts` returns from the Option G
    bypass under `if (!this.llmValidation)` UNCONDITIONALLY - there is no per-pattern gating as
    in admin-check - so `callClaude` is unreachable for ANY input under the shipped default,
    not merely for this corpus. The file nevertheless gated on `ANTHROPIC_API_KEY` and printed
    `SKIPPED` without one: a key-gated test that needed no key and measured no live accuracy,
    while its header advertised "~ $0.02 per run - only positives reach the LLM". Both halves
    were false; the true cost was $0 and the true model-reaching count was 0.
  - **It gated nothing.** Verified mechanically BEFORE removal: absent from the `test:ci` chain
    (only the `-prefilter` variant appears), absent from the stage-3 selector list (which is the
    six spending detectors), and invoked by no workflow - the sole `.github/` mention is the
    comment stating secrets-exposure has no live coverage, which stays true. Nothing imported
    the module (it had zero `export` statements) and its `parseMeta` / `printDiagnostic` /
    local `loadFixture` / `buildSyntheticDiff` appeared nowhere else. Retirement therefore
    could not loosen any gate.

  **IF LIVE SECRETS ACCURACY IS EVER WANTED** (i.e. `FIXOR_SECRETS_LLM_OPT_IN=true` is
  deliberately enabled), build it on `runStabilityHarness` as the other five detectors do. Do
  NOT resurrect the retired file: it was single-shot (no `nRuns`, against the standing n=5
  convention and the F-008 "a single sample is not a verdict" lesson) and hardcoded its
  denominators. The right scaffold already exists; the retired one was the wrong shape.

  **APPENDED STATUS on the tabulated figure "secrets-exposure 7 of 10 (70 percent)" above -
  NOT a correction.** That figure was accurate when `f62921e` (PR #116, 2026-07-22) entered it:
  the corpus held 10 positives at that commit, verified by reading the tree at `f62921e`. It was
  overtaken afterwards, so the original wording stands as entered and this status is appended
  beside it. The true bar at retirement was **7 of 15 (46.7 percent)** against a 15-positive,
  10-negative corpus - looser than every figure this entry tabulates, including the
  auth-bypass 32 percent it cites as the worst. The combined bar was 16 of 25 (64 percent), and
  the printed denominators were wrong in the same direction: the summary would have rendered
  `Positives caught: 15/10` and `Combined accuracy: 25/20 (125%)` while PASSING, and the
  failure printer's `${10 - caught}/10` would have rendered a negative numerator.

  **THE LESSON, recorded because the defect class recurred on the one test this item left
  open.** This entry tabulates a decay pattern - a corpus grows, absolute constants do not, the
  bar silently falls - and then left exactly one instance unfixed. That instance decayed AGAIN,
  silently, after this entry was written: `5efa432` (PR #123) added positives 11-15 to complete
  prefilter pattern coverage without touching `POSITIVES_MIN`, taking the bar from 7-of-10 to
  7-of-15. Documenting a defect class does not arrest it; only a corpus-relative gate or
  deletion does. The remaining live tests are corpus-relative, so the class is now closed by
  construction rather than by vigilance.

- **Hardcoded `/10` and `/20` denominators (opened by stage-3 step 1).** The same family of
  tests printed literal `${caught}/10` and `${combined}/20` in their summaries while
  `scanDir` iterated the real directory, so the reported denominator was simply wrong once a
  corpus grew. env-exposure has 11 positives and could print "Positives caught: 11/10".
  **FIXED for env-exposure and webhook-unverified by step 1** (the harness prints real
  denominators). **STILL OPEN in `test-secrets-exposure.ts`**, same reason as above. This is
  a reporting defect, not a gate defect, but it makes a green line unreadable. No API spend.

  **CLOSED by PR C3 with the file itself.** `test-secrets-exposure.ts` was the last carrier of
  this defect and was retired rather than repaired, so the hardcoded `/10` and `/20` went with
  it. The prediction in this entry was right and, if anything, understated: it warns that
  env-exposure "could print `Positives caught: 11/10`"; the retired file would have printed
  `Positives caught: 15/10` and `Combined accuracy: 25/20 (125%)` and still exited PASS. No
  remaining test hardcodes a denominator - `runStabilityHarness` prints real ones and
  `test-secrets-exposure-prefilter.ts` iterates its manifests. Class closed.

- **`test-idor-lane.ts` is single-shot while its two siblings sample at N=5 (opened by
  stage-3 step 1).** `test-auth-bypass-lane.ts` and `test-express-lane.ts` both implement the
  nRuns rule (`N_RUNS = 5`, fires >=4/5, silent <=1/5); `test-idor-lane.ts` calls the detector
  once. Lane routing is exactly the kind of verdict-dependent behavior that a single sample
  cannot establish. It needs the lane-shaped K-of-N treatment its siblings already have, NOT
  `runStabilityHarness` (it has no positive/negative corpus; it runs over
  `fixtures/real-shape/fastapi-saas`). Zero spend to write; spends only when run live.

- **RESOLVED (PR #119): `runStabilityHarness` INFERRED `llmCalls` instead of observing the
  call (opened by stage-3 step 2).** The harness increments its call counter when `lastDiagnostics[0]` carries no
  `preFilterReason`. That is an inference from a diagnostic, not an observation at
  `callClaude`, and it has two structural blind spots: it reads only the FIRST diagnostic
  entry, so a fixture whose diff carried more than one file would collapse to one count; and
  it can never see the escalation second call, which produces no diagnostic entry of its own
  and is tagged `coverage: "auxiliary"` so it is skipped by the coverage tally too. **Not a
  wrong number today, and that is worth stating plainly:** `measure:stage3-calls` compared the
  inferred counter against the observed count fixture by fixture and found **divergence 0
  across all six harness-routed stanzas (142 vs 142)**. The inference is currently correct
  because every fixture is a single-file diff issuing exactly one call. The defect is that
  nothing holds that invariant in place. **Deliberately NOT fixed in step 2**, so that the
  measured column exists as an independent oracle to validate the fix against; fixing the
  counter in the same change would leave the new counter checked only by itself. No API spend.

  **FIXED 2026-07-22 (PR #119), validated against the step-2 oracle at zero spend.** The count
  is now OBSERVED at the chokepoint. A new `src/lib/llm-call-ledger.ts` keeps three O(1)
  accumulators (`calls`, `pricedCalls`, `costUsd`) with snapshot and delta reads, mirroring
  `src/lib/llm-coverage.ts`, and `callClaude` records into it at each of its five terminal
  returns WITHOUT the auxiliary skip that the coverage tally applies. That is what catches the
  escalation call: escalation goes through `callClaude` like everything else, and only the
  tally filters it out, not the function. No array is kept, because `server/webhook-server.ts`
  is long-lived and a per-call array would leak.

  Two acceptance tests, both zero spend, live in `measure:stage3-calls`:
  - **Test A, per fixture:** the observed counter equals the spy count on all **166**
    harness-routed fixtures, not merely in aggregate. This is now observation against
    observation.
  - **Test B, the falsification test, and the real gate:** with escalation OFF every fixture
    makes exactly one call, so test A only ever confirms 1 equals 1. Test B manufactures the
    multi-call case that does not occur naturally: a canned `isVulnerable: true` verdict at
    MEDIUM with `FIXOR_ESCALATE_MEDIUM=true`. Measured result, **old inferred counter 142,
    new observed counter 304, with 166 escalation calls observed**. The escalation second call
    is visible to the ledger and invisible to the inference. A fix for "blind to the escalation
    call" that was never run against a corpus containing one would be asserted, not verified.
    Test B's numbers are a COUNTING CEILING, never a cost figure: a constant canned verdict
    fabricates the MEDIUM rate.

  **The `llmErrors` counter was deliberately NOT switched to the coverage tally**, contrary to
  the obvious reading of "observe instead of infer". All six detectors return a null verdict on
  a MALFORMED tool input from a SUCCESSFUL call, so the old `llmErrors` is the union of
  transport failures and parse failures while `llmCoverageSince().failed` counts transport
  failures only. Switching would have DROPPED parse-failure detection, loosening a gate whose
  entire purpose is to stop a hollow pass on a negative. Instead the observed transport-failure
  count was ADDED as a separate term, so the gate is strictly tighter and no run that failed
  before can start passing. Cost reporting is untouched here and remains open below.

- **RESOLVED (PR #120): `estimatedCostUsd` was a flat per-call constant (opened by stage-3
  step 2).** The harness
  computes `totalLlmCalls * costPerLlmCallUsd`, defaulting to a single flat figure. The four
  detectors wrapped by step 1 pass an explicit per-call constant; `test:idor` and
  `test:idor-tenant` pass none and inherit the default. IDOR is whole-file and batches its
  candidate pairs into ONE call, so there is no reason its per-call cost matches a
  single-trigger detector's, and the inherited default has no measured basis for that shape.
  Consequence: a stage-3 paid run would self-report a cost line built on a constant that is
  least trustworthy exactly where the call is most expensive. `measure:stage3-calls` fixes the
  CALL side of the product (144, measured) but cannot fix the PRICE side: its canned response
  carries zero token usage by construction. Closing this needs a small live sample of IDOR
  calls, which spends and is therefore a separate decision. No API spend to record.

  **UPDATE 2026-07-22: the PRICE side is now measured for idor, and the defect is WORSE than
  this bullet stated.** Measured `W_idor` (warm) $0.0115263, `C_idor` (cold) $0.02047125
  (artifact `docs/measurements/idor-percall-2026-07-22.json`). Two consequences.

  First, the flat default UNDERSTATED idor by about 17 percent, so the direction of the error
  is now known, not just its existence.

  Second, and more important, **the harness cost model is missing a whole term, not just a
  better constant.** `totalLlmCalls * costPerLlmCallUsd` has no way to express that the first
  call of each process is COLD and every later call to the same detector is WARM. The correct
  shape is `(F_d x N) x W_d + P_d x 0.00921495`, where the surcharge is a measured constant and
  `P_d` is the process count. No single value of `costPerLlmCallUsd` can represent that, because
  the cold and warm units differ by roughly 1.8x and the mix depends on how many processes the
  run uses. **This is why `test-idor.ts` and `test-idor-tenant.ts` were deliberately NOT given
  the measured figure when it was taken.** Writing $0.0115263 into `costPerLlmCallUsd` would
  multiply a WARM unit across the cold call too, which is the same flat-constant defect wearing
  a more accurate number, and it would fix two of the three idor entry points anyway since
  `test-idor-multi.ts` does not use the harness. The code change belongs AFTER the cost model is
  fixed here, not before it.

  **FIXED 2026-07-23 (PR #120), zero spend, validated offline against the step-2 oracle.** The
  harness no longer multiplies a count by a constant. It sums the REAL per-call USD from the
  PR1 ledger (`llmCallsSince(before).costUsd`, computed from real `message.usage` and including
  any escalation call) and reports in three labelled modes keyed on `pricedCalls` versus
  `calls`, never the environment: MEASURED (all priced, real sum, no constant), NOT MEASURED
  (none priced, so the run's actual spend is `$0.00` because no API call was made), and MIXED
  (the measured subset reported and the unpriced remainder named and excluded, never blended
  into one total). The would-cost-live line on an unpriced run is a PROJECTION labelled as an
  estimate, printed on its own line and never called a cost. `costPerLlmCallUsd` is retained
  and demoted to that projection rate; its numeric default is REMOVED, so absent rate prints no
  projection rather than a fabricated constant. That deliberately surfaces the two idor entry
  points as lacking a measured rate until `0.0115263` is supplied on purpose. `passed` and every
  assertion are untouched: nothing reads a cost field, and `passed` has no cost term. Three
  offline assertions in `measure:stage3-calls` cover all three modes (canned MEASURED `$0.00`,
  replay NOT MEASURED, a manufactured MIXED case). The cost MODEL `(F_d x N) x W_d + P_d x
  0.00921495` survives only as the projection fallback and as the pre-run table in the spy, not
  as the live cost path, since a live run now self-reports its measured cost.

- **`src/test/lib/production-scan.ts` carried a stale `0.004` per-call constant and the same
  inferred counter (found and FIXED in PR #120).** This Step 4 production-shape scanner is dead
  code (no importer anywhere in `src`), which is why the stale figure survived unnoticed. Its
  `COST_PER_LLM_CALL_USD = 0.004` is the exact Haiku-class figure `detector-test-rules.md`
  records as wrong for Sonnet detection, and it also inferred its call count from
  `lastDiagnostics[0].preFilterReason`. PR #120 routed both through the ledger (observed count,
  real summed cost, mode-aware reporting) and removed the constant. Fixed in place, not deleted:
  deletion is a destructive op and was deliberately not taken. Naming it here so the RESOLVED
  bullet above is true across the whole tree, not just the stability harness.

- **RESOLVED (PR A): `recordLlmCall` treated "the success path ran" as priced, not "usage was
  present" (found in PR #120, fixed in PR A).** In `anthropic-client.ts`, `lastCallCost` is
  assigned unconditionally on a successful call; when `message.usage` is undefined every token
  field defaults to 0 and `costUsd` is 0, yet `recordLlmCall(lastCallCost)` still marked the call
  priced. The sibling `recordCost` guards with `if (installationId !== undefined && usage)`, so
  the repo was internally inconsistent about what counts as priced. In practice the Messages API
  always returns `usage` and the `| undefined` is defensive, so this never produced a wrong figure
  in production, which is why it was ranked low and shipped isolated rather than urgently.

  **FIXED 2026-07-24 (PR A, branch `recordllmcall-usage-guard`), zero spend.** The success path
  now calls `recordLlmCall(usage ? lastCallCost : null)`, matching the sibling `recordCost` guard,
  so `pricedCalls` means "usage was present", not "the success path ran". Directly asserted at the
  chokepoint by a usage-absent spy variant (deleted after use, zero spend): a success whose canned
  response OMITS the usage block is counted in `calls` but NOT in `pricedCalls` (`calls=1,
  pricedCalls=0, costUsd=0`), while a success WITH a zeroed usage block stays priced (`calls=1,
  pricedCalls=1, costUsd=0`). End to end, `runStabilityHarness` over `fixtures/env-exposure` under
  the usage-absent spy reported `cost: NOT MEASURED, actual $0.00 over 17 call(s), 0 returned
  usage`, not the fabricated `MEASURED $0.00` the old code would have printed (17 priced == 17
  calls). The `measure:stage3-calls` acceptance proofs are UNCHANGED by the guard, because their
  canned response carries a zeroed-but-present usage block, so every canned call stays priced:
  test A per-fixture equality (166 fixtures), the ledger mode check (`pricedCalls 142 == calls
  142`), MEASURED `$0.00 over 142 priced`, NOT-MEASURED replay `counted 1 / priced 0`, MIXED `2
  calls / 1 priced / $0.0100`, and test B falsification (old inferred 142, new observed 304, 166
  escalation calls) all still pass, and the model-reaching total is still 144. No API spend.

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

**SECOND CORRECTION of the namespace definition (2026-08-02), the same shape as the first.** The
sentence above reads "`F-` is what the READINESS DIAGNOSTIC found by READING". That was true when
it was written, and again only because the audit was the sole instance of reading that existed;
"the readiness diagnostic" was describing that instance, not the boundary — precisely the error
the 2026-07-17 correction fixed on the other side of the split. It has now aged the same way:
F-014 was found by READING `route-guard-resolver.ts` in order to check the engine-symmetry claim
PR #143 was about to make, which is reading, and is not the audit. The definition is therefore
WIDENED to "`F-` is what we found by READING (the readiness diagnostic, or later source
verification)". The organising axis is again UNCHANGED and is again the thing worth preserving:
READING versus RUNNING. Filing F-014 in `L-` was considered and REJECTED — nothing was run — and
so was opening a provenance sub-section for one item, because `F-`'s sub-sections are severity
headers ("Priority 2 - MEDIUM", "Priority 3 - LOW") rather than provenance headers, and a
severity header stays true no matter who found the item.

TWO passages state this definition and this block corrects both, rather than splitting one cause
into two corrections: the sentence above beginning "The organising axis of the `F-`/`L-` split",
and the parenthetical in the **Priority 1f** header beginning "Its provenance is L- by the
tracker's own axis". The 1f passage does NOT become false, only incomplete, and its ARGUMENT is
untouched: the widening is entirely on the READING side, while 1f turns on the RUNNING side, so
"filing reach as F- would force F- to absorb found-by-running" holds exactly as written.

Provenance within the namespace is recorded per sub-section, not per item: **Priority 1d** holds
L-001 through L-010, surfaced by Run 1 (live). **Priority 1e** holds L-011, surfaced by the
zero-spend structural rig. **Priority 1f** holds L-012 and L-013, both surfaced by structural
measurement but kept separate from 1e because 1e's header says "defects" and neither is one (both
are reach findings, framed like L-010). The recurring alternative — filing an item under
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

- **L-010 (READY gate - LIFTED PARTIAL; NOT a defect) - detection demonstrated once on a real
  vulnerability; stability and cross-framework reach not established.**
  See the readiness verdict for the capture path, the raw verdict fields, the cost, and the
  caveat. Recorded here so it is trackable alongside the items it replaced.

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
  DEFERRED to E'. The READY gate is now F-004 alone (L-010 is a lifted-partial, non-gating
  caveat); this is neither. (A rationale of the form
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
separate subsection from 1e because 1e's header says "defects" and the items here (L-012, L-013) are NOT defects. Its
provenance is L- by the tracker's own axis (`F-` is what the readiness diagnostic found by
READING; `L-` is what we found by RUNNING the detector). Reach was found by running the real
`analyzeFile` over the corpus, so it is L- by that axis, not F-, regardless of the fact that it
bears on readiness. Precedent: L-010 is a READY-gate, explicitly "NOT a defect", surfaced by
measurement, and it lives in L-; readiness-relevance is orthogonal to the namespace. Filing this
as an F- item would have forced F- to absorb "found by running" — which is L-'s definition — so
F- and L- would overlap and stop being a partition. This subsection needs no definition change.
(Pointer, 2026-08-02: the `F-` half of the parenthetical above is now incomplete — see "SECOND
CORRECTION of the namespace definition" under Priority 1d. The argument here is unaffected,
because that widening is on the READING side and this argument turns on the RUNNING side.)

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
  vulnerability — that is C's job (the CVE target that lifted L-010; now demonstrated, see the
  readiness verdict). It neither lifts nor pressures F-004 or L-010; the READY gate stands where
  it is (F-004), and L-010 was lifted by the C run, not by this reach finding. It is filed as a
  first-order market-fit finding the product owner must weigh, not as a gate.

  CAVEAT, in its own words: n=43, a SAMPLE not a census (GitHub search caps at 1000/query),
  TS/JS only, with churn and language bias carried from sourcing. "The detector reaches ~5% of
  the ICP" is DESCRIPTIVE of these 43 repos; the Wilson interval [1.3%, 15.5%] is descriptive of
  this sample, not an inference to all ICP repos. Acting on it as market truth needs a larger
  sample or explicit acceptance of that interval.

  CROSS-REFERENCE: L-011 owns the reason 7 of the 8 reaching files are what they are (the
  `trpc_input_access` pattern dominates the reach surface). L-012 owns the reach fact; L-011
  owns the pattern. Neither restates the other's figures. L-013 is the framework-idiom companion
  to this ICP-market figure: L-012 owns market applicability (2/43), L-013 owns which code idioms
  the prefilter reaches on a patched-fix probe. They interlock and share no number.

- **L-013 (OPEN; MEASURED; reach / framework-idiom coverage; NOT a defect; NON-gating) - the
  detector's clean reach is FastAPI-shaped, and two request-id ownership idioms are structurally
  invisible to it.** Confirmed under real execution (the reach probe over recently-patched
  ownership/authorization fixes, logged as the "CVE-surface probe"; that log name overpromises,
  see Scope below).

  Twin of L-012, filed beside it in Priority 1f: same provenance (found by RUNNING the real
  detector, not by reading), same axis (reach, not recall or precision), NOT a defect,
  NON-gating. It carries no witnessed/unwitnessed adjective, for the reason L-012 does not: that
  word is a recall-axis word, and this is a fact about WHERE the detector applies. DISTINCT from
  L-012, not folded into it: L-012 owns ICP MARKET APPLICABILITY (how much of the ICP is the kind
  of app IDOR detection applies to, 2/43); L-013 owns FRAMEWORK-IDIOM COVERAGE (given a request-id
  ownership flow, which code idioms the prefilter reaches at all). Neither restates the other's
  figures.

  **Scope, stated before the finding so it is not overread.** This is a STRUCTURAL-INVISIBILITY
  finding, NOT a witnessed missed vulnerability, and NOT advisory-grounded. The exemplars below
  are OWNERSHIP-SCOPED, guarded code, not IDORs: reading their guards (the L-001 discipline),
  paperclip's routes carry `assertCompanyAccess` and membership / `companyId` scoping, and
  payload's `findOne` scopes its `where` by `user.value`, its patched flow having lived in
  `preferenceAccess`, not the sink cited here. So L-013 claims only that the prefilter never
  builds a candidate pair on these idioms; it makes NO claim that a real vulnerability was missed.
  No GHSA or CVE covers either exemplar. The one advisory in the captured probe (CVE-2025-61687,
  Flowise) is a MIME-type-spoofing issue, not an IDOR, and is not used here. The corpus is
  therefore described as what the evidence supports: recently-patched real-world
  ownership/authorization fixes, pinned by SHA.

  MEASURED (2026-07-19; recently-patched ownership/authorization fixes, pinned by SHA). The idiom
  the prefilter reaches cleanly is the FastAPI shape: a request-id path parameter into
  `session.get(Model, id)`, where the ORM read-by-id matches `SINK_PATTERNS` and the path param
  matches a source. Two request-id ownership idioms are structurally invisible:
  - Service-layer sinks do not match `SINK_PATTERNS` (mechanism from source; read-side companion
    to L-006). Every `SINK_PATTERNS` entry is an ORM read literal or a raw-SQL shape; a request-id
    that flows into a bare service-layer method (for example `access.getMembership(...)`) matches
    none, so no pair is built. This is the READ-side counterpart to L-006's WRITE-side gap: L-006
    owns the missing write sinks, L-013 owns the read that hides one indirection behind the ORM
    call the pattern keys on. EXEMPLAR, WEAK and CONTAMINATED: the paperclip router
    (`paperclipai/paperclip`, authz-hardened in `ac664df8e48326135a913e97ee7ed937d913586b`, PR
    #3315) mixes service-layer calls with direct drizzle reads that are themselves ownership-scoped
    (`.where(and(eq(id), eq(companyId)))`); those drizzle reads WOULD match `SINK_PATTERNS`, so
    paperclip is suggestive, not a clean witness. It is cited un-pinned (fix commit only, no
    vulnerable-parent SHA; see the SHA note). The mechanism stands on the source read, not on this
    exemplar.
  - Cross-file flows cannot pair under single-file analysis (CLEAN, pinned exemplar). In
    `payloadcms/payload` (vulnerable state `99d61db85bacf0d1386da55747de6266ae70781a`, the sole
    parent of fix `2dc2e7c07f24529a28326bd7f5a3fc3597245ebf`, PR #15425), the request handler
    (`findByIDHandler`) and the ORM sink (`payload.db.find({ ... where })` inside `findOne`) live
    in different files. `analyzeFile` is single-file, so the request-derived source and the sink
    never co-occur in one analysis unit and no pair forms. The structural point holds independent
    of that commit's own fix, which isolated auth collections in `preferenceAccess`.

  **SHA note (the #110 pin-from-evidence discipline).** payload is pinned to a vulnerable-parent
  SHA with certainty: the fix has a single parent. paperclip is NOT: its captured router source
  reads as already guarded, three separate authz-hardening commits touch that surface, and the
  file is sink-contaminated, so no single "vulnerable parent" can be stood behind as ground truth.
  It is anchored to the FIX commit `ac664df8` (a real, verifiable object) and cited un-pinned.
  payload is the load-bearing exemplar; paperclip corroborates the source-level mechanism only.

  **Why NON-gating, live rationale.** Reach says nothing about detection quality on a real
  vulnerability (that is L-010's axis). L-013 neither lifts nor pressures F-004 or L-010; the
  READY gates stand where they are. It is a first-order coverage-idiom finding the owner must
  weigh, in the same class as L-012.

  CAVEAT, in its own words: this is a small-n probe over patched fixes, NOT a market census. It
  characterizes which idioms the prefilter reaches; it does not measure how frequent each idiom is
  in ICP code. The exemplars are worked cases (one pinned, one un-pinned and contaminated), not a
  rate. A rate needs a larger sample or explicit acceptance of the limit.

  CROSS-REFERENCE: L-012 owns the ICP market figure (2/43) and L-013 owns the idiom shape on the
  patched-fix probe; they interlock but share no number. L-006 owns the ORM-write sink gap;
  L-013's service-layer idiom is its read-side companion. `ICP-REACH.md` and
  `IDOR-STRUCTURE-EXPOSURE.md` carry the reciprocal pointers. L-010's cross-framework caveat
  rests here: the one demonstrated HIGH is the FastAPI path-param to `session.get` idiom, and
  L-013 is the evidence that the prefilter does not cleanly reach the non-FastAPI idioms, so that
  single success does not generalize across frameworks.

### Priority 2 - MEDIUM findings (precision and coverage-integrity)

- **F-002 - RESOLVED, moved to DONE (Engine A: PR #141, squash `38d5c7ca`; Engine B: PR #143,
  squash `7cbc3893`).** Kept as a pointer rather than deleted outright for the same reason
  F-003's row is: a reader working down this worklist from an older reference must not read
  the gap as an oversight. Cite the STATUS, not the title — the row's old name asserted that a
  detector throw is NOT counted as degraded coverage, which was the hypothesis this row was
  opened on and is now false on both engines.
- **F-003 - RESOLVED, moved to DONE (PR #141, squash `38d5c7ca`).** Kept as a pointer rather
  than deleted outright so a reader working down this worklist from an older reference does
  not read the gap as an oversight.
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
- **F-014 (LOW; OPEN; precision, with a silent input-fidelity cause) - on Engine A, a
  parent-layout guard that EXISTS but cannot be READ is dropped in silence.**

  `nodeGuardFs.read` (`detectors/shared/route-guard-resolver.ts`) is `try { readFileSync }
  catch { return null }`, and `resolveRemixRouteGuard` pushes a guard only `if (content !==
  null)`. `GuardFs.read`'s `string | null` return therefore conflates two different facts —
  "no layout there" and "a layout is there and we could not read it" — and the `catch`
  discards the error at the one point where it exists. `cli/scan.ts` calls the resolver with
  the default `nodeGuardFs` and has nothing outside it watching for read failures, so the
  route is judged WITHOUT its parent-layout guard and the scan reports no `notAnalyzed`, no
  `detectorFailures`, no coverage degradation, and exit 0. Secondary effect: the `break` sits
  outside the `content !== null` test, so an unreadable `_layout.tsx` also suppresses the
  remaining `LAYOUT_BASENAMES` candidates in that same directory.

  **Engine B does not have this gap, and the contrast is the evidence.**
  `resolveRouteGuardSidecars` (`integrations/github/whole-file-scan-input.ts`) fetches the
  candidates itself, records every non-404 failure in `failedCandidates`, and pushes a
  `routeGuardErrors` entry naming the route, which becomes a `WorkflowError` — so the run can
  never read `no_action` or `success`. It recovers the distinction OUTSIDE the resolver, which
  is why its `memFs.exists` is false for a failed fetch and the resolver never meets the
  exists-true/read-null shape at all. The asymmetry is in the fs adapter and its callers, not
  in the shared resolver, which is used unchanged by both.

  **Harm shape, stated precisely, because it is NOT the F-002 shape.** A correctly gated route
  judged without its guard is the F-001 shape: a HIGH FALSE POSITIVE from auth-bypass or
  admin-check. Nothing is reported clean that is not clean. This makes a run NOISIER, never
  falsely quieter, so it is a precision defect with an input-fidelity cause and must not be
  filed as false assurance. LOW because the trigger is narrow (`existsSync` true AND
  `readFileSync` throwing — EACCES, EISDIR on a directory named `_layout.tsx`, or descriptor
  exhaustion on a large scan; a broken symlink makes `existsSync` false and does not trigger
  it), and because Engine A is the CLI, which this tracker consistently treats as the smaller
  blast radius than the webhook path.

  **This row is what makes a claim in shipping code true.** `sarif-output.service.ts` on `main`
  says route-guard degradation is "an open question, tracked, not decided here". That word was
  FALSE when it was written and merged at #143: nothing in this file carried it, so a reader
  following the pointer could not tell deliberate deferral from forgotten. It was not caught in
  authoring and not caught in review.

  **The open question that comment names, ANSWERED for Engine B: design, not defect.** Excluding
  route-guard failures from SARIF `executionSuccessful` is correct. The route WAS analyzed;
  §3.14.11's flag is about whether the tool ran, not whether its input was ideal; and the
  degradation already forces `status` off `no_action`/`success` through its own `WorkflowError`.
  Engine B is the STRONGER engine on this channel, not the weaker one. What stays OPEN is
  Engine A having no signal at all. A fix confined to `nodeGuardFs` would not be enough — the
  resolver's `if (content !== null)` would swallow the distinction again — so the fix has to
  widen `GuardFs.read` or give `GuardFs` an error sink. Not decided here; no code in this PR.

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
