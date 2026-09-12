# Selector B and its precision check: pre-registration, 2026-09-11

Written and committed BEFORE any selector B candidate is drawn. Consequence of the shape
sample (`shape-sample-twenty-result.json`, MISSES A LOT at the threshold, M = 5 of 500, and
0 of 11 keyword candidates a class fix on blind reading). The keyword list stays byte-identical
and is NOT edited by this file.

## Definition of selector B

A commit is a selector B candidate when all of the following hold:

1. Non-merge, reachable from the clone HEAD recorded in the run artifact.
2. Its diff touches at least one file with an accepted extension (js, jsx, ts, tsx, py, go,
   rb, java, kt) outside the `SKIP_PATH_RE` segments AND outside these generated-content
   segments, added from the shape sample's evidence (47 of 224 pre-screen positives were
   generated locale files): `generated`, `locale`, `locales`, `i18n`, `translation`,
   `translations`, `vendor`, `node_modules`, `dist`, `build`. Those files are the
   "population files" of the commit.
3. The unified diff over its population files has at most 600 changed lines.
4. At least one changed line in the population files matches a pre-screen shape, verbatim
   from `shape-sample-twenty.md` (the six class shapes, added-line or removed-line as stated
   there). The shapes are NOT drawn from `PREFILTER_PATTERNS`.
5. The blind reader labels it a fix of one of the six classes.

Point 5 is part of the definition, not a later filter: the shape sample measured 5 fixes in
224 pre-screen positives, so a count of pre-screen positives is not a count of candidates and
must never be reported as one. "Selector B candidate count" means blind-read fixes.

Selector B is applied to a DRAW, never to a whole population: applying the pre-screen to
every population commit would fetch every touched blob and is the full clone the protocol
declined. Draws are uniform without replacement from each repository's path population
(points 1 and 2), seeded per repository with the integer value of the first 8 hex of that
repository's HEAD, so every draw is reproducible from the artifact. Draw order is recorded.

Blind reading protocol, unchanged from the shape sample: fresh subagents that may read only
`docs/detector-capabilities.md` and the diffs; never the detector source, fixtures, or
scripts; never told which arm or repository a diff came from; batches of at most 56 diffs;
one class-or-none verdict with one sentence and the defect lines quoted. Diffs from the
keyword arm (below) are interleaved into the same batches so readers cannot tell arms apart.

## Precision check, first

Stage P: from each of the twelve repositories, draw population commits in seed order until
25 pre-screen-positive, readable (not over the cap) commits are collected, giving 300
pre-screen positives. Read all 300 blind. Precision = fixes found / 300.

Thresholds, written before the draw:

- USABLE: at least 12 fixes of 300 (4 percent or more; at most 25 reads per fix).
- UNUSABLE: at most 5 fixes of 300 (under 2 percent; 60 or more reads per fix). Selector B
  stops. The bias measured by the shape sample is then recorded as measured and not
  repairable by shape at a finite reading budget, and the case-source question returns to
  the owner. No shape is added or tuned to rescue it.
- REFUSED: 6 to 11 fixes. No verdict. A second draw of 300 is the owner's call and is
  pre-registered again if taken.

Fixes found in stage P are admitted as pairs on the ordinary protocol whatever the verdict.

## Pair budget, sized before the draw

Reading is the only finite budget left. One blind batch of 56 diffs cost about 200 to 350
thousand session tokens and about four minutes of reader time in the shape sample. The cap
for the whole admission, stage P included, is 2,100 blind reads, about 38 batches, staged as
rounds of 50 pre-screen positives per repository (600 per round) so no repository is
half-read when the cap lands: stage P, then up to three rounds. Rounds run in full or not at
all; the cap is on reads, never on pairs, so the count floor is met by the corpus or not met.

What the cap buys, at the precision the shape sample measured (about 2 percent), is roughly
40 fixes across twelve repositories; at the USABLE bound it is roughly 80 or more. The
shape sample's five fixes fell in three classes (admin-check, idor, auth-bypass) and none in
env-exposure, secrets-exposure or webhook-unverified, so at either precision those three
classes are expected to stay under the 10-pair floor and to list cases without a count line.
That expectation is written here so that a thin count for them is read against it.

Sizing table, path population per repository (trees only, counted 2026-09-11; the second
column excludes generated segments, point 2 above):

| repository | non-merge commits | path population | excluding generated segments |
|---|---|---|---|
| caddy | 2,663 | 2,234 | 2,234 |
| discourse | 64,257 | 33,558 | 33,251 |
| documenso | 3,696 | 2,621 | 2,612 |
| full-stack-fastapi-template | 1,509 | 236 | 236 |
| gitea | 20,488 | 12,489 | 12,257 |
| grafana | 68,750 | 48,805 | 48,515 |
| hoppscotch | 5,149 | 2,387 | 2,387 |
| langchain | 16,638 | 9,805 | 9,805 |
| mastodon | 21,811 | 10,753 | 10,634 |
| plane | 6,667 | 5,845 | 5,829 |
| strapi | 26,173 | 18,677 | 18,489 |
| twenty | 15,344 | 12,759 | 11,747 |

Sum of the twelve rows, excluding generated segments: 157,996 commits.

GAP FILLED 2026-09-12, before any selector B candidate was drawn: strapi and twenty had not reported when the previous commit was made; the counting job finished both (strapi 1,367 s, twenty 2,072 s) and then crashed on its final JSON write, which came after the twelve rows were printed, so the rows are from the job's own output and nothing here is estimated. This fill changed the two rows and this paragraph only: no threshold, no cap and no rule in this file was touched.

## The keyword list: comparison arm, not a live selector

Ruling recorded here: the keyword list continues unedited but stops being the source of
selector-drawn candidates. It becomes a COMPARISON ARM. Its status is settled by
measurement, not preference: 150 keyword candidates are drawn (25 per class; a class with
fewer than 25 contributes all it has and the remainder is spread over the other classes),
seeded as above, and read blind, interleaved with selector B reads.

- At least 6 fixes of 150: the keyword list is reinstated as a live selector beside B.
- At most 2 fixes of 150: it stays a comparison arm for the rest of the measurement.
- 3 to 5: refused; the arm continues at 150 and the owner decides on a second 150.

Why 150: at a true precision of 5 percent the chance of 2 or fewer fixes in 150 is about
2 percent, and at 1 percent the chance of 6 or more is under 1 percent, so 150 separates
"as good as selector B at its usable bound" from "no better than the shape sample showed".
Eleven could not.

Fixes found in the keyword arm are admitted as pairs with `selector: keyword-arm` in the
record. Excluding a real fix because of which arm found it would waste a true case; what the
arm's status governs is whether more of its candidates are drawn, not whether its fixes
count.

## Records

Every pair record names its selector (`shape-sample-twenty`, `selector-b`, or
`keyword-arm`) and its blind reader's verdict; the contested flag is set from disagreement
between the measuring session and the blind reader. Same-commit siblings are listed in each
record. A commit touching several defective files yields one record per file, as ruled.
SIBLING RULE, owner's ruling 2026-09-12: same-commit siblings count as ONE toward the
10-pair floor, otherwise one commit could satisfy the floor alone and the floor would stop
meaning anything. Case that prompted it: `921a0f01c8a9` fixes the same missing
caller-application ownership check in three validator files and yields three records
(`twenty--921a0f01c8a9--flat-field-permission-validator.json`, `...flat-object-permission-validator.json`,
`...flat-permission-flag-validator.json`); toward the floor they are one. Those three records
carry ONE blind verdict copied across them, not three readings: the reader returned one
class-or-none per commit, and its sentence names all three validators. The copy is recorded as
a copy so that it is visible rather than tidy. Counts in every report state pairs AND
distinct commits side by side.

## Cost and key

Network only: blob fetches for drawn commits. No API key is present in the environment; the
readers run on the measuring session's runtime. No model call through this repository, no
recording.
