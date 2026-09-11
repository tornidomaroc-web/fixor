# Handoff: the fix-pair measurement as of 2026-09-12

This file is the durable state of the measurement. It lives beside the pre-registrations
because they are the only tracked, swept surface the measurement has: CLAUDE.md is
gitignored and its own rule forbids derived facts there, and a session's context is not a
record (an approved paragraph was lost between two sessions on 2026-09-11 and had to be
resupplied verbatim). A fresh session continues from here without reading a word of the
sessions that wrote it. Update this file in the same commit as any change it describes.

## Goal

Three numbers per shipped detector on real code (owner's definition of "ready for a first
customer"): known defects caught, missed, false alarms raised. Counts, never rates; the
10-pair floor per detector; the corpus is mature open source, not the customer's code.
Protocol: `README.md` in this directory (committed 2026-09-11 as #202 before any clone was
read). Nothing in it has been edited since.

## Where things are

- Clones: `../fix-pairs-corpus/<name>` relative to the Fixor checkout, twelve repositories,
  blobless and no-checkout (`--filter=blob:none --no-checkout`), 697 MB at clone time.
  Lemmy is excluded (Rust). The step-4 evidence clones under `test-output/step4-scans/repos`
  are a different thing and must not be touched.
- Candidate counts of the keyword selector, the shape-sample draw, diffs and blind verdicts:
  `../drafts-2026-09-11-tree-scan/` beside the checkout (untracked working files; everything
  that must survive is in this directory).
- This directory: `README.md` (protocol), `keywords.json` (the keyword list, byte-identical
  since #202, 28 `pattern_adjacent` marks), `shape-sample-twenty.md` and
  `shape-sample-twenty-result.json` (+ `.verdicts.json`, `.sample.txt`) landed as #203,
  `selector-b.md` (this branch), `pairs/` (the records and `MANIFEST.json`).

## What is fixed and may not be edited

- README.md: admission rules, the three populations (catch/miss on the parent answer range;
  false alarm on the child at the same range; everything else Population C, unread), the
  reach-stage rules (out-of-scope removes; any other stop is a miss; reaching blind is a miss
  and gets no spend), the floor (10 admissible pairs for a count line; no rate at any size),
  the stage-2 cost rule and halt ceiling.
- shape-sample-twenty.md: thresholds and consequences; the result is scored and landed.
- selector-b.md: selector B's definition (blind reader inside the definition), the
  precision-check thresholds (USABLE >= 12 of 300, UNUSABLE <= 5, REFUSED 6 to 11), the read
  cap (2,100 blind reads, rounds of 50 per repository), the keyword arm and its 150-read
  status test, the sibling rule.

## What was found, and what it forbids concluding

- Keyword selector, twelve repositories: 620 admin-check candidates of which 710 message
  matches come from the single word "rbac" (grafana, strapi); webhook 97; idor 52; secrets
  44; auth-bypass 38; env-exposure 2. The list stays byte-identical: removing a word after
  seeing its yield is the selector moving after the measurement.
- Shape sample on twenty (500 of 5,689 server commits, blind-read): 5 class fixes, all 5
  outside the keyword selector, M = 5, MISSES A LOT at the threshold exactly; 0 of the 11
  keyword candidates in the sample was a fix. Forbidden conclusions: any rate; anything
  about the other eleven repositories; anything about pre-screen negatives (unread); that
  env-exposure's two candidates say anything about the class in mature code (that reading
  was the MISSES LITTLE branch and did not occur).
- Consequence taken: selector B (pre-registered in `selector-b.md`). The keyword list is a
  COMPARISON ARM, not a live selector, until its 150-read test says otherwise.

## The records

Seven records in `pairs/`, all from twenty, all `selector: shape-sample-twenty`, all
ADMITTED, none contested (measuring session and blind reader agree on every class):

| child commit | class | files | note |
|---|---|---|---|
| 0edc3a385c0c | admin-check | 1 | child carries a safety-asserting comment, recorded, not stripped |
| 23aa859502a8 | idor | 1 | |
| 77574594f2d6 | admin-check | 1 | grounds marked moderate in the record |
| 921a0f01c8a9 | idor | 3 | three sibling records, ONE blind verdict copied across them; count as one toward the floor |
| cdd667b1066e | auth-bypass | 1 | |

Toward the floor: 5 distinct commits, 7 pairs. Every record carries both 40-hex commits,
the parent-file answer range, the grounds, the blind reader's sentence, the verbatim hunk.

## Open, in order

1. The sizing table in `selector-b.md` has a NAMED GAP for strapi and twenty. The counting
   job was alive at commit time; the two rows land in a follow-up commit BEFORE any selector
   B candidate is drawn. If the job died, the gap stays stated.
2. Selector B stage P (300 pre-screen positives, 25 per repository, blind read) and the
   keyword arm's 150 reads, interleaved. Not drawn yet. Draw seeds are per-repository HEAD.
3. Stage 1 reach instrument (keyless, on the IDOR rig's triple lock): not built.
4. Stage 2 (spend): only on the owner's approval by detector, against a computed number.

Process rules that bind every step: branch, pull request, merge only on the owner's explicit
command through the three-condition gate (required checks from app_id 15368, MERGEABLE OPEN,
head tree equal from API and local git; main's tree matching it is the only strong
confirmation); gitleaks replay over the staged files both ways before every commit;
Measured date in every commit body that carries a measurement; no key in the environment
for anything in this measurement; no `git fetch --prune`; no touching
`feat/auth-bypass-enable-pending-pairs`.

## Next action, one line

Fill the strapi and twenty rows in `selector-b.md` from
`../drafts-2026-09-11-tree-scan/selector-b-population.txt`, then draw stage P.
