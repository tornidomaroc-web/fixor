# Pre-registration: the secrets-exposure skip-list change, written before any detector line moved

Date: 2026-09-12. Status: PRE-REGISTERED AND STOPPED before the run. Two findings below
need the owner's ruling; the detector is unchanged on this branch.

## What the change would be (candidate, not applied)

`SKIP_PATH_RE` today, in all six detectors, byte-identical:
`(^|/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(/|$)`, case-insensitive.

Candidate for secrets-exposure: the same segments plus `script` (singular), `e2e`,
`e2e-<anything>`, `api_tests` / `api-tests`, `app-tests`; and a basename rule
`\.(test|spec)\.[a-z]+$` so `*.test.tsx` and `*.spec.ts` are skipped wherever they sit.
Exact source in `secrets-skip-list-prereg-2026-09-12.json` (`candidateSegments`,
`candidateBasename`).

## Predicted effect, computed from the 70 flagged paths (deterministic, no run)

| corpus | flags today | candidate removes | keeps | of the removed, real credentials |
|---|---|---|---|---|
| 13 step-4 clones (mature) | 58 | 23 | 35 | 0 |
| 43 ICP repositories | 12 | 7 | 5 | 0 |

Self-check: the current rule removes 0 of the 70 (they were all scanned), so every removal
is attributable to the candidate.

Mature, the 23: the ten discourse `script/` operator placeholders; the nine flags the
harness categorised as test paths; and FOUR siblings the segment rules sweep with them that
the "19" on record did not count: `strapi/packages/utils/api-tests/strapi.js` and
`auth.js` (the `api-tests` segment), `lemmy/api_tests/src/shared.ts` (the `api_tests`
segment), and `grafana/e2e-playwright/…` was already in the nine. So the prediction on the
record, 19 of 58, becomes 23 of 58 for this candidate, the extra four being the same kind
of file as their neighbours. Kept: 35, of which 20 are Go `*_test.go` files (grafana 17,
gitea 3), a convention the candidate does NOT name; adding `_test\.go$` would remove those
too and take the mature count to 15. That is a separate decision, not made here.

ICP, the 7: every ICP false alarm under `e2e/` or a `*.test.ts` name, in two repositories.
The three real keys sit in `commands/*.js` and are untouched. So the expectation on the
record, "no change at all on ICP", is FALSE on the facts before any run: the candidate
takes the ICP number from 12 flags (9 wrong, 3 real) to 5 flags (2 wrong, 3 real). The
owner's instruction was that a moving ICP number is a finding and a stop; this is that
finding, found in the prediction rather than the run, so the run was not made.

## The second finding: this is not a secrets-only knob

`docs/detector-capabilities.md` ("Out of scope across the board", the `SKIP_PATH_RE` row)
and `docs/measurements/skip-path-cross-detector-bound-2026-09-10.json` record the rule as
one cross-detector bound, six byte-identical copies, with the invalidation clause "goes
false if any of the six regexes diverges". Two designs:

- (a) change secrets-exposure only: the six diverge; the bound row is re-audited in the
  same commit to say five share the old rule and secrets carries the wider one; the other
  five detectors' populations are untouched, which matters because their fix-pair
  measurements are in flight on the old rule (stage P not drawn, pairs recorded under it).
- (b) change all six: the instrument of five detectors mid-measurement changes, which is
  the R12 family the owner's own sequencing ruling forbade for secrets.

Ruling asked of the owner. I would rule (a), for the reason in its own line, and re-measure
the cross-detector bound's three pinned repositories with the secrets copy in the same
commit so the row stays true.

## What the run will do once ruled

Apply the ruled regex on its own branch as detector work with a negative fixture per new
segment class (`script/`, `e2e/`, `api_tests/`, `app-tests/`, basename `.test.`) and the
gate manifest updated; re-audit the capabilities-doc row; then rerun BOTH false-alarm
readings with the unchanged harness under the same lock and report side by side with
today's numbers. Pass condition: mature 58 to exactly 35 with the 23 named paths gone and
no other change; ICP 12 to exactly 5 with the seven named paths gone and the three real
keys still flagged. Any other difference is a finding and a stop.
