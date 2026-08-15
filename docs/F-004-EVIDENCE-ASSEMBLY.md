# F-004 stage-3 evidence assembly, for a ruling that is Abo Jad's and has not been made

**The ruling on F-004 is Abo Jad's, and it has not been made.** This document assembles the
evidence such a ruling would be made from. It does not make it, recommend it, anticipate it, or
record progress toward it. Nothing here closes anything, and no count moves.

Every figure below was re-read from tracked surfaces at `6c7d9842` — the tracker, the workflow, the
`docs/measurements/` artifacts and `registry.ts` — and not carried over from any earlier assembly
text. Earlier assembly text is untracked output, and CLAUDE.md §8's rule applies to it exactly as it
applies to §8 itself: no sweep reaches it, so nothing invalidates a number in it once it goes stale.

## 0. The drift this document is written against, stated first because it acts on the reader

The table in §2 is complete and every entry in it passed. **A complete table of passes pulls every
sentence written from it toward "therefore".** There is no "therefore" here, and the pull is the
reason to say so explicitly rather than to rely on omitting one.

Two specific guards follow from that, and they are structural rather than stylistic:

- **The residuals in §4 are at the same altitude as the table in §2**, in the same artifact, and are
  not a footnote, an appendix, or a caveats section. They are not qualifications on a result; on the
  evidence below, several of them are the result.
- **A reader who finishes this document holding only "six of six green" has read it wrong.** Two of
  the six rows rest on no `docs/measurements/` artifact at all, one row is one sample away from not
  being green by its own artifact's instruction, and four of the six are green only under an emit
  policy that was itself a contested decision.

## 1. What the six are — the corrected vocabulary, which the arithmetic does not enforce

This tree uses "all six" for **two different sets that differ by exactly one member on each side**.
The counts match, so the arithmetic gives a reader no warning when the referent is carried from one
sentence into another.

- **The stage-3 GATE set** — the `detector` selector options in
  `.github/workflows/stage3-live-detection.yml`, which CLAUDE.md §8 names as the authority for it:
  `env-exposure`, `webhook-unverified`, `auth-bypass`, `admin-check`, `idor`, `idor-tenant`.
- **The SHIPPING DETECTOR set** — `SHIPPING_DETECTOR_IDS` in
  `src/analysis-engine/detectors/registry.ts`: `auth-bypass-multi`, `admin-check-multi`,
  `idor-multi`, `env-exposure-multi`, `secrets-exposure-multi`, `webhook-unverified-multi`.
- **The swap is one-for-one.** Stage 3 carries `idor-tenant` where the shipping set carries
  `secrets-exposure`. Everything else is common.

**`idor-tenant` is not a detector.** The tree holds six `*.detector.ts` files — `admin-check`,
`auth-bypass`, `env-exposure`, `idor`, `secrets-exposure`, `webhook-unverified` — and no tenant
variant, and `DETECTORS` in `registry.ts` instantiates one class per shipping detector. `idor-tenant`
is a **second corpus** run against the idor detector through its own entry point, which is why the
two report the same `SYSTEM_PROMPT_FINGERPRINT` `5f5129f12b11`. **The gate set covers five shipping
detectors, one of them against two corpora.**

**`secrets-exposure` has no stage-3 gate, by design and not by omission.**
`FIXOR_SECRETS_LLM_OPT_IN` defaults false, so the shipped path is regex-only and makes no model
call. A stage-3 gate measures model judgment, and on that path there is none to measure. A gate that
flipped the flag to create some would be measuring a configuration that does not ship. Its
appropriate instrument is `test:secrets-exposure-prefilter`, which exists and runs keyless.

**Consequence for any sentence written from this assembly.** "Six of six stage-3 gate entries are
green" is true. **"All six detectors are verified live" is false** on the shipping-detector reading,
and one shipping detector — `secrets-exposure` — has no live model-judgment coverage at all. Whoever
writes such a sentence must name which six it means.

## 2. The six gate entries, with provenance grade

Each row is the per-detector green the F-004 gate counts, under the owner's 2026-08-08 ruling that
the gate is six per-detector greens rather than one green `all` run. That ruling is recorded, is not
restated here, and is not reopened here.

| # | gate entry | green run | ref | date | aggregates | priced calls | measured | fingerprint | prov. |
|---|---|---|---|---|---|---:|---:|---|:--:|
| 1 | `env-exposure` | `31649593669` | `907cb59a` | 2026-08-12 | 12/12 pos, 8/8 neg, **20/20** | 85 | $0.6457 | `ef92d1311a1e` | **A** |
| 2 | `webhook-unverified` | `31208881040` | `72598ba6` | 2026-08-07 | 17/17 pos, 18/18 neg, **35/35** | 170 | $1.2032 | `c2c5deba87c9` | **B** |
| 3 | `auth-bypass` | `31277606806` | `c02b37fe` | 2026-08-08 | 22/22 pos, 23/23 neg, **45/45** | 185 | $1.5967 | `45a17ae07c26` | **A** |
| 4 | `admin-check` | `30821994020` | `25fa0116` | 2026-08-03 | 24/24 pos, 21/21 neg, **45/45** | 150 | $1.2001 | `ed52ebe3db91` | **C** |
| 5 | `idor` | `30769713479` | `593ed02` | 2026-08-02 | 9/9 pos, 9/9 neg, **18/18** | 90 | $0.9204 | `5f5129f12b11` | **D** |
| 6 | `idor-tenant` | `30754480093` | `f8090ade` | 2026-08-02 | 3/3 pos, 3/3 neg, **6/6** | 30 | $0.2713 | `5f5129f12b11` | **D** |

### The provenance grades, and what each one is a grade of

The grade is about **the evidentiary standing of the row's verdict-class figures**, not about whether
the run passed. All six passed; they are not equally well evidenced.

- **A — own artifact, machine-written census.** The run has its own `docs/measurements/` file and
  its class counts are the harness's own printed `VERDICT CENSUS` block.
  Rows 1 and 3. Artifacts: `env-exposure-stage3-2026-08-12.json` (`RESOLUTION_2026_08_12`, 22
  pre-registered keys asserted byte-identical, 0 edited) and `auth-bypass-stage3-2026-08-08.json`.
- **B — own artifact, but the census is not in it.** `webhook-unverified-stage3-2026-08-07.json`
  records aggregates and named exceptions and **no counts by class**; its class figures were
  hand-censused from the run's `stage3-detector-logs`. A further trap on that one: its `vuln/medium`
  row carries hardcoded `SUPPRESSED (not emitted)` text that PR #153 removed — **read the count, not
  the label**. The label was the defect; the count never was.
- **C — own artifact, hand census.** `admin-check-stage3-2026-08-03.json` exists, but the run
  predates the census renderer and prints no census block, so its class counts are a **hand census**,
  re-derived from the run's own per-iteration `LLM:<class>` lines.
- **D — no artifact of its own, hand census.** Rows 5 and 6 have **no `docs/measurements/` file at
  all**. Their class counts are a hand census from retained run logs. This is also why §8 forbids a
  glob over `docs/measurements/` as the authority for the gate set: a glob undercounts while carrying
  a command's authority, and two of the six rows could not have been built from that directory.

### The primary evidence behind the three weakest rows expires from 2026-10-31

Every figure in the two hand-census grades is re-derivable at zero spend from the
`stage3-detector-logs` artifact of the run named beside it, and all nine paid runs still carry one,
unexpired. **Those are Actions artifacts, not tracked in this repository, and they expire from
2026-10-31** (run `30754480093`) **through 2026-11-11.** After the first of those dates the three
earliest runs — rows 4, 5 and 6, which are exactly the three weakest-provenance rows — rest on
**transcription alone**, with no primary source left to check the transcription against.

This carries no identifier and is not filed as work: it is not a defect in the tree, no action
completes it, and the only thing that happens to it is that the date passes.

### Two per-row qualifiers the aggregates hide, carried at unequal strength because the evidence is unequal

These two look alike at a glance and are not alike. Flattening them into "both had a wobbly fixture"
would misreport both.

- **Row 1, `env-exposure` — the green is one sample away from not being green, and its own artifact
  says so.** `positive/11-redacted-diagnostics.js` returned `vuln/medium` on runs 1–4 and `safe/low`
  on run 5. **It scored 4/5, not 5/5**, and passed only because `perPositiveThreshold` is 4. Had that
  identical single flake landed on any negative — where `perNegativeThreshold` is 5 with zero slack —
  the run would have been RED. The gate is satisfiable with exactly zero slack on the negative side:
  a single flake on any one of the eight negatives is a full red. The artifact's own instruction is
  **"Do not cite 20/20 without citing this"**, and this assembly is bound by it.
- **Row 3, `auth-bypass` — the divergence was confidence-only, and the alarming reading is
  explicitly forbidden by the artifact.** `positive/15-app-router-with-account-api-key-no-enforce.ts`
  returned `vuln/medium` on runs 1–4 and `vuln/high` on run 5: it **flagged 5/5**, and only its
  confidence moved. Sign fidelity across the run is 37 of 37; confidence fidelity is 36 of 37.
  Because `scoreNegative` ignores confidence entirely, transposing this divergence onto a negative
  does **not** produce a red, and the artifact records that correction against itself: *"Any claim
  that this run shows n=1 seeding could have returned a full RED is overstated and must not be
  cited."* Row 3 used **zero declarations**.
- **Row 2, `webhook-unverified`, carries a third thing that is neither of the above.** Two of its
  eighteen negatives — `negative/14` and `negative/15` — are recorded as *"clean 5/5, 5 excused by
  declaration"*. They passed clean, and they also carried declarations. Row 3's artifact states the
  contrast directly: auth-bypass's zero-declaration default is *demonstrated rather than assumed*.
  Row 2's is not.

## 3. The paid-run ledger, and the arithmetic check run against it

Nine paid stage-3 runs exist. Six of the nine are the greens in §2; one is the `all` dispatch; two
are env-exposure runs that did not produce a green.

| # | run | date | selection | ref | priced calls | measured | outcome |
|---|---|---|---|---|---:|---:|---|
| 1 | `30754480093` | 2026-08-02 | `idor-tenant` | `f8090ade` | 30 | $0.2713 | GREEN 6/6 |
| 2 | `30769713479` | 2026-08-02 | `idor` | `593ed02` | 90 | $0.9204 | GREEN 18/18 |
| 3 | `30821994020` | 2026-08-03 | `admin-check` | `25fa0116` | 150 | $1.2001 | GREEN 45/45 |
| 4 | `30903038957` | 2026-08-04 | `env-exposure` | — | 85 | $0.6649 | not a green; 15 `vuln/medium` discarded under the pre-#152 policy, falsifying L-015 and the cost calibration |
| 5 | `31208881040` | 2026-08-07 | `webhook-unverified` | `72598ba6` | 170 | $1.2032 | GREEN 35/35 |
| 6 | `31277606806` | 2026-08-08 | `auth-bypass` | `c02b37fe` | 185 | $1.5967 | GREEN 45/45 |
| 7 | `31435865020` | 2026-08-10 | `env-exposure` | `820b1647` | 85 | $0.6671 | **RED 19/20** — `negative/08-flask-env-keys-only.py` flagged `vuln/medium` 5/5; opened L-016 |
| 8 | `31649593669` | 2026-08-12 | `env-exposure` | `907cb59a` | 85 | $0.6457 | GREEN 20/20 |
| 9 | `31711397888` | 2026-08-13 | `all` | `6a4c1373` | 710 | $5.8273 | GREEN 169/169 |

**Cumulative stage-3 spend: $12.9967 across nine paid runs.**

**Arithmetic check, run rather than asserted.** The nine measured figures accumulate to $12.9967 and
reproduce **every** cumulative checkpoint the tracker states independently along the way — $2.3918
after run 3, $4.2599 after run 5, $5.8566 after run 6, $7.1694 after run 8. The `all` run's six
per-detector figures ($0.6500, $1.2029, $1.5911, $1.2023, $0.9205, $0.2605) sum to $5.8273, and the
remainder identity `ceiling_k == run budget - sum(measured 1..k-1)` reproduces all six printed
ceilings from an $8.00 budget exactly: $8.0000, $7.3500, $6.1471, $4.5560, $3.3537, $2.4332. **No
figure in this assembly diverged from the tracked surfaces on re-reading.**

**Row 8's green followed a prompt amendment, and that must be visible rather than inferred.** Run 7
red on `negative/08`. The owner ruled the shape **out of env-exposure's lane**: the corpus was ruled
correct and the prompt defective. The prompt was amended (Variant C, `d2ca2f022d99` →
`ef92d1311a1e`), **no fixture was edited, relabelled, moved or retired**, and run 8 measured whether
the amendment carried the ruling at n=5. This is recorded here because "the prompt changed after a
red" is the exact shape R8 and R11 exist to catch, and the distinction between a scope ruling and
fitting a prompt to a wanted verdict is a distinction a reader must be able to check rather than be
told.

## 4. The six residuals, at the strength their evidence supports

Same altitude as §2, same artifact, not a footnote. Each carries what its evidence actually is,
because they are not equally evidenced and reporting them at a uniform strength would misreport four
of the six.

### R1 — Simultaneity: closed as worded, and replaced by a weaker residual

**Strength: measured, one run.** The ruling's stated residual was that six greens at six different
SHAs do not prove the six pass simultaneously at one SHA. Run `31711397888` (2026-08-13, `main`
`6a4c1373`) passed all six aggregate gates **simultaneously at one SHA, 169/169**, at the same six
fingerprints the per-detector greens were obtained at, every one against a gate demanding 100% of its
corpus. Single dispatch was proven by **enumeration** — the workflow's run list holds 11 runs and
exactly one at `6a4c1373`, `run_attempt` 1 — and not by the printed link. **The simultaneity residual
is closed as worded.**

What replaces it is weaker but is not nothing: **one simultaneous green is one sample at one moment
and binds no future run.** That is definitional, not measured.

### R2 — The transfer argument is not merely retired; it was measured false

**Strength: measured, and it contradicts a premise this tracker asserted as sound.** Three greens
(`idor-tenant`, `idor`, `admin-check`) predate PR #152 and transferred to the shipped emit policy on
the argument that their censuses show **zero `vuln/medium` across 270 calls**, so option C could not
have changed them. Re-measured on those same three corpora at those same fingerprints, the figure
came back **5 in 270** — all five on `admin-check/positive/14-app-router-with-route-on-admin-action.ts`
at 5/5. Discard those five as the pre-#152 policy did and `admin-check` scores 23/24 positives and
**RED at 44/45**.

The three no longer *need* the argument, because all six now also rest on a run at post-#152 code.
The argument is recorded **false** rather than retired **because it was cited as sound**, and because
the two failure directions do not cover for each other: R1 closing makes the evidence look weaker
than it is, while an argument the same run refuted makes it look better founded than it was.

**And the dependence appeared between two windows, which ties this residual to R6.** In
admin-check's own green run (`30821994020`, row 4) the same corpus at the same fingerprint produced
**zero** `vuln/medium`, re-censused from raw logs and matching its artifact field for field. The five
appeared in the 2026-08-13 window. The premise was true when written and false ten days later,
without the prompt or the corpus moving.

### R3 — Option C is load-bearing for four of the six rows

**Strength: measured, per row, from each row's own artifact.** Under the retired pre-#152 emit policy
— where a `vuln/medium` is discarded to the review queue rather than emitted — four of the six gate
entries score red on the very runs recorded green above:

| row | under the shipped policy | under the retired pre-#152 policy |
|---|---|---|
| `env-exposure` | 12/12 positives, 20/20 | positives fall to **9/12** |
| `webhook-unverified` | 17/17 positives, 35/35 | **16/17, FAILS** |
| `auth-bypass` | 45/45 | **44/45, FAILS** |
| `admin-check` | 45/45 | **44/45** on the 2026-08-13 re-measure |
| `idor` | 18/18 | unaffected — zero `vuln/medium` in both windows |
| `idor-tenant` | 6/6 | unaffected — zero `vuln/medium`; its two `safe/medium` exit early |

**These gates did not become satisfiable because a threshold was lowered; they became satisfiable
because the detector stopped discarding what it had already found.** That distinction is the whole
of it, and it cuts both ways rather than one: option C is shipped, its alternatives are rejected on
the record, and **a MEDIUM reaches the customer**. Four of the six rows are green in a configuration
where that is true, and would not be in the configuration where it is not.

### R4 — Resolution, not calibration

**Strength: a stated property of the instrument, not a measurement — it is a ceiling on what every
figure above can mean.** The harness prints it itself, six times in the `all` run: *n=5 catches
stochasticity at 20% resolution. Zero FP at n=5 means "no FP at this resolution," not "calibrated."*
Six fixtures cannot support a rate. Nothing in §2 or §3 shows that any threshold **discriminates**;
`idor`'s aggregate bar was raised from 6/6/12 to 9/9/18 as a policy change and every fixture scored
maximum on the run that verified it, so the raise is verified as **satisfiable** and remains
unverified as **discriminating** (L-014).

The one place a threshold was observed doing work is row 1's `positive/11` at 4/5, and there it
absorbed a flake rather than discriminated against one.

### R5 — What the gate does not cover, structurally

**Strength: structural, verified from source, and not a sampling limitation that more runs would
fix.** `secrets-exposure` has **no live model-judgment coverage at all** — `registry.ts` constructs
it with `llmValidation` false, so its shipped path never reaches the model, and a stage-3 gate on it
would have to measure a configuration that does not ship. Separately, `idor-multi`, the two lane
tests (`auth-bypass-lane`, `express-lane`) and `h8` exercise live model judgment but cannot route
through the positive/negative harness, so they sit **outside this gate**; and `test:idor-lane` is
still single-shot while the other two lane tests are at N=5.

Reaching the full model-reaching set requires **seven** entry points, not the six the gate drives:
the six enumerate 142 of the 144 model-reaching calls, and `fixtures/idor-multi`'s 2 are reached only
by `test:idor-multi`.

### R6 — Serving-window transfer: the sign half transfers, the confidence half does not

**Strength: measured, 710 calls on each side, and the counts are explicitly lower bounds.** L-022's
census — built by hand from named runs, never from a glob over `docs/measurements/`, each pair
fingerprint-matched so the prompt is held constant and each pair's pre-filtered counts identical so
the corpus is held constant — found **one sign move and at least 31 confidence-class moves** between
each row's own green and the 2026-08-13 window, with every guard green throughout. The counts are
aggregate deltas in which offsetting moves cancel, so the true number is **at least** 31 and could be
higher; citing them as exact would be the lines-are-not-occurrences error.

**Drift is detector-specific in this data, not a global model shift**, and the two longest intervals
produced the least movement: `webhook-unverified` was bit-identical class for class across 5 d 19 h
and all 175 runs, while `admin-check` moved at least 25 of 150 across 10 d. A reader must not convert
elapsed time into an expected drift rate.

**The consequence is what makes this a residual on every row above rather than an item beside them.**
Confidence is customer-visible: the detector sets it on the emitted `Finding`, `Confidence` is
`"high" | "medium" | "low"` with no remapping, and `buildComment` renders it three times on the PR
comment — one of them the finding's own title line, read without expanding the row. **No claim about
what a customer sees may be transferred across serving windows on a fingerprint match alone, and
every "verified live" claim in this tree currently carries that transfer implicitly.**

**No keyless test can catch it, and the blind spot is structural rather than an oversight.** The one
instrument that reads confidence — `confidenceParity` and `verdictLaneOutcome` in `replay-harness.ts`
— compares against `fixtures/replay/**`, frozen recordings that by construction cannot drift, so it
is silent precisely when the reference is what went stale. The only way to refresh that reference is
`record:*`, which §3 forbids for this exact shape of reason.

### Named and deliberately not counted among the six, so the boundary is checkable

Two further standing residuals qualify the **gate's design and the spend machinery** rather than the
evidence assembled above. They are named here rather than omitted, because omitting them from an
assembly for a closure ruling would be advocacy by silence:

- **The gate fires only when a human presses Run.** No fork-PR trigger, no schedule. A
  detection-quality regression is caught only on a manual dispatch, so a commit that degrades model
  judgment can merge and ship without this gate ever firing. Mitigation is by convention — this
  workflow is a required manual check before flipping READY and before any tagged release — and not
  by automation. Recorded as a known, accepted divergence from the audit's stronger posture.
- **The #148 seam is not validated.** The shell half is closed: the run-budget remainder handoff
  holds exactly at all six k. The inner claim — that a detector honours the ceiling it was handed —
  is untouched and is unreachable by any stub. In the $1.88 replay case the shell handed detector 3 a
  ceiling of **$0.0271** against a detector whose measured cost is **$1.5911**, and the run
  continued; at that point the entire protection is an in-process guard that **has never fired** in
  any live run. No run may be cited as evidence for it, and none was engineered to obtain it.

## 5. What this assembly does not do

It does not lift F-004, propose lifting it, or argue for or against lifting it. It does not reopen
the owner's 2026-08-08 ruling on what the gate counts, and it does not restate it. It does not
calibrate anything, does not corroborate any cost model — a pre-registration that refused an
inference in advance still binds when the number turns out flattering — and does not license a drift
script that globs `docs/measurements/`, which §8 forbids and whose reason is R2 and the two D-grade
rows above.

**The ruling is Abo Jad's. It has not been made, and nothing in this document should be read as
having made any part of it.**
