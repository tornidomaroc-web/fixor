# Discharge of the condition blocking the twelve-repository walk, 2026-09-14

Written and committed BEFORE the walk runs. Not after it, and not as a line inside its
results: a discharge recorded beside the numbers it unblocked cannot be read independently of
them, and the point of this file is that it can.

## What was blocking, in its own words

`path-population-prereg-2026-09-12.md` pre-registered the consequence of a failed arm:

> **Consequence, pre-registered.** If any predicted departure fails to appear, that is a STOP.
> It is reported, not repaired in the same execution, and the twelve-repository run does not
> follow it. The harness exits non-zero.

W2-twenty failed. The harness exits 1 and still does. **That sentence is not amended, deleted
or reinterpreted here**, and the run that follows this file is not a claim that it was
satisfied. It is a claim that the owner has ruled the condition it guards DISCHARGED, on the
record, before the run, with reasons that are written down and can be disagreed with.

## The ruling, and the reasoning it rests on

Ruled by the owner, 2026-09-14. The reasoning is his and is recorded as given:

The condition existed to stop the walk proceeding on a check whose **discriminating power was
assumed**. That is the whole of what it guarded. W2-prime measured that power **on twenty
itself** - the repository where it was in doubt - **to the unit**, against an integer committed
before the run, **through a code path independent of the one it tests**.

Read from `path-population-witness-w2prime-2026-09-13.json`, not recalled:

| field | value |
|---|---|
| `w2primeReading/predicted` | `exactly 11758` |
| `w2primeReading/observed` | `11758` |
| `w2primeReading/baseline/excluding_generated` | `11747` |
| `w2primeReading/perturbed/excluding_generated` | `11758` |
| `stopConditions/anyValueOtherThan11758/fired` | `false` |
| `preRegistration/note` | prediction and harness committed in ONE commit before the run, so neither could be shaped to the other |

The pre-registration and the harness were committed together in `806aa72` before the run, and
both blobs were re-read from `main` after the squash of #225 and found identical to their
values in that commit. The ordering that makes the prediction a prediction survived.

## What is NOT discharged, and travels into the walk unchanged

- **W2 remains FAILED and stays recorded as failed.** `witnessStateAfterThisRun` reads
  `armsHolding` 6, `armsFailed` 1, `failedArm` `W2-twenty`, `W2 twenty` =
  `FAILED, permanently recorded`, `harnessExitCode` 1, `every_prediction_holds` `false`.
  W2-prime does not erase W2 and this file does not either.
- **The census explains the null; it does not convert it into a pass.** The W2-twenty null came
  from a **REDUNDANT** segment on twenty - not an idle one, and not a blind check. That
  explanation is why a replacement arm was possible at all, and it is not a finding that the
  arm held.
- **W2-prime cross-checks the IMPLEMENTATION, not the rule.** In the artifact's own words:
  *"that the definition of path population is right. It cross-checks the IMPLEMENTATION, not
  the rule, the same limit the twelve-row match carries."* **This limit travels into the walk's
  artifact unchanged**, and is the same limit the twelve-row reproduction carries, so the walk
  gains no independent support for the definition from either.
- **The original pre-registration decides this question neither way.** It did not anticipate a
  replacement arm. The discharge is therefore an owner's ruling filling a silence, not an
  entailment of the pre-registered text, and it is recorded as such.

## Scope

This discharges exactly one thing: the pre-registered STOP that prevented the twelve-repository
walk from running. It is not a finding about the definition of path population, not a
retirement of W2, not a change to any threshold, rule or constant, and it creates no
identifier. Nothing in `path-population-prereg-2026-09-12.md` is edited by it.

## Pre-run verification, read before the walk

Checked against the pre-registration before this file was committed:

| pinned item | pre-registered | read on main |
|---|---|---|
| `path_population.py` blob | `2526845a` | `2526845a` |
| `commit-gated.sh` blob | `399e66c5` | `399e66c5` |
| `path_population_witness.py` blob | `12db2e07` | `1a02f428` |
| `EXT` sha256 | `8685bb02…a577` | identical |
| `SKIP` sha256 | `20506ff8…2652` | identical |
| `GEN` sha256 | `1e7ac9af…5aa4` | identical |

**The witness blob moved and the walk does not consume it.** It changed in `400c25d` (#225),
which added the W2-prime harness; the walk's instrument is byte-identical to the pre-registered
one. Recorded rather than passed over, because the pre-registration pins three blobs and says
nothing about one of them moving.

**Corpus identity, checked rather than assumed.** The walk runs over `../fix-pairs-corpus/`,
the blobless twelve named in `README.md`. It does NOT run over
`test-output/step4-scans/repos/`, which holds thirteen directories - the twelve plus `lemmy` -
is SHALLOW, and which the step-4 manifest forbids touching. A walk pointed there would have
produced a thirteenth row against a twelve-row table and counted commits from truncated
histories. `lemmy` is excluded from this corpus for a recorded reason: Rust is outside the nine
languages in `SUPPORTED_LANGS`. Verified: `../fix-pairs-corpus/` contains exactly the sizing
table's twelve, no extras and none missing.

## Cost

Zero. No API key, no model call, no network. The walk is tree-only and `GIT_NO_LAZY_FETCH=1`
enforces that rather than intending it.
