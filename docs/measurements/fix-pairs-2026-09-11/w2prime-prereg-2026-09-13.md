# W2-prime: pre-registration, 2026-09-13

Written and committed BEFORE the arm is run, in the same commit as the harness that runs it, so
neither can be shaped to the other. A departure observed and then described is not a witness.

## Why this arm exists

`path-population-witness-2026-09-12.json` recorded five arms holding and one failing: W2 on
twenty predicted that dropping `locales?` from `GEN` would raise the excluding-generated column,
and the column stayed at 11,747 exactly. The pre-registered consequence fired: the
twelve-repository walk did not follow, and nothing was repaired in that execution.

`gen-segment-census-2026-09-12.json` then established, descriptively and without choosing between
the explanations on offer, that the null came from a REDUNDANT segment rather than an idle one or
a blind check: on twenty `locales` touches 1,072 commits and would remove 995 on its own, but its
unique contribution is 0, because every commit it removes is also removed by another segment.

W2-prime supplies the arm W2 was meant to be, on a segment with MEASURED unique bite.

## The prediction

| field | value |
|---|---|
| repository | twenty |
| clone HEAD required | `2badd5da7db126e9b8e41c90bfa9617486205866` |
| seed | 732812762 (`0x2badd5da`) |
| perturbation | `GEN` with the `build` segment dropped |
| baseline `path_population` | 12,759 |
| baseline excluding-generated | 11,747 |
| predicted `path_population` | 12,759, unchanged: `GEN` does not touch that column |
| **predicted excluding-generated** | **exactly 11,758** |

Derivation, stated before the run: the census counted `build` on twenty at touches 121,
removes_alone 11, **unique 11**. A commit leaves the removed set when `build` alone is dropped
exactly when some qualifying file of that commit matched `build` and no other segment, which is
what `unique` counts. So the removed set falls from 1,012 to 1,001 and the column rises from
11,747 to 12,759 - 1,001 = 11,758.

`build` is the only segment on twenty at or above ten in `unique`; `generated` is 4, `i18n` 1,
`translations` 1. This measurement publishes no count under ten, so `build` is the only choice
that can carry a published figure.

## What the arm tests, and what it does not

It cross-checks the IMPLEMENTATION, not the rule. The census derives `unique` from per-file
segment bitmasks and a drop-one-out test; this arm derives the column from the conjunction over a
perturbed `GEN` inside `walk()`. Two different code paths over the same `git log` output.
Agreement to the unit says those paths agree; disagreement says one of them is wrong and finds it
before 157,996 identifiers are drawn on it. It says nothing about whether the definition of path
population is right - the same limit the twelve-row match carries, and it is repeated here rather
than allowed to fade.

An exact integer is the point. A direction can barely fail; an integer can.

## Stop conditions, pre-registered

Each is a STOP and a report. None is repaired inside the same execution, and none licenses a
re-prediction in the beat that observes it.

1. Any observed value other than **11,758**, **a larger increase included**.
2. The tracked constants failing their before-and-after digest check.
3. `union_mismatch_files` non-zero on the twenty walk.
4. twenty's clone HEAD reading anything but `2badd5da7db126e9b8e41c90bfa9617486205866`, on which
   the seed and the whole census rest.

## How it runs

Through `tools/path_population_witness.py`, which IMPORTS the tracked constants from
`tools/path_population.py`, reads them, and passes its own perturbed copies as parameters. No
tracked constant is edited in place, so there is no restoration step that can be skipped. The
module's digests are asserted identical before and after. `GIT_NO_LAZY_FETCH=1`, trees only, zero
spend, no API key, no model call.

**W2 STAYS IN `ARMS` EXACTLY AS IT WAS.** A failed arm is recorded, never removed. The run
therefore re-executes all seven arms and the harness still exits non-zero, because the witness as
a whole still carries a failed arm. W2-prime does not erase W2; it supplies what W2 was meant to
supply, and the earlier failure travels with every claim made about this witness.

## Pinned at this commit

Harness blob `1a02f428a2deb2c9b6873611f3d74401c94feb21`; instrument blob
`2526845a24fac0d47ccbd9b29cb2bd2a1b4ec30b`; constants `EXT` `8685bb02`, `SKIP` `20506ff8`,
`GEN` `1e7ac9af`. twenty's HEAD was read before this file was written and matched the value
required above.

## What a pass would and would not discharge

If the observed value is 11,758, the witness stands at six arms holding and one, W2, permanently
failed. Whether that discharges the pre-registered condition blocking the twelve-repository walk
is the owner's ruling and not a session's: the original pre-registration did not anticipate a
replacement arm, so nothing in it decides the question either way.
