# Pre-registration: forced routing, shipped prompts, 2026-09-28. NOT RUN.

Written after `verdict-read-2026-09-28.md` and before any code for it exists. Nothing here has
been run, rehearsed or priced by a live call. Anchored by the push of the commit that carries it.

## Why this experiment and not a prompt A/B

The $0 read found no prompt bias: 16 of 17 vulnerable-side "no" answers are explained by the
defect not being in front of the lane that owns it. A shipped-versus-revised prompt comparison
would change the variable the evidence does not implicate, and a revision that makes auth-bypass
ask object-ownership questions would break lane discipline (R10). So the first paid question is:
**handed the defect's file, by the lane that owns it, with the shipped prompt, does the model
flag it?** If yes, the build item is routing; if no, a prompt experiment is warranted and is
pre-registered below as a conditional second stage.

## Arm

One arm, F: each file is sent to its OWNING lane's shipped detector prompt, bypassing the
prefilter, with the payload built by that detector's shipped payload code. No
`SYSTEM_PROMPT_FINGERPRINT` may differ from `main` at the run's commit; a mismatch stops the run.
Model: the shipped `claude-sonnet-4-6`. Escalation, replay and record flags unset. n = 5 per file,
the repository's `nRuns`.

Anchor rule, mechanical, from diff metadata only (no file is read to choose it):
- auth-bypass, admin-check: whole file (every file below is under the 200 KB cap); anchor line =
  first changed line of the first fix hunk in that file (parent numbering on the parent side,
  fix numbering on the fix side).
- idor: one candidate pair; sink = that same anchor line; source = the nearest `SOURCE_PATTERNS`
  hit at any distance, else the anchor line itself. Whole-file payload.

**Stated limit:** the anchor tells the lane where the fix touched. This measures the model stage
behind an ideal router, a ceiling on what routing work can buy, not shipped behaviour.

## Cases

**Judged set: the held-out ten** (`detector-reach-2026-09-27/held-out-admission-2026-09-27.md`),
owning lane = the admission table's primary lane. Files = every manifest row, parent and fix side;
misskey's file that the fix ADDED is excluded on both sides. 15 files × 2 sides = 30 per run.
**Correction to the admission record, which stays byte-frozen:** its closing section says "All 14
blobs were checked"; the manifest has 15 fetched files, and the fetch asserted the git blob sha
of all 15. The 14 was a miscount in prose, not a missing check. These
cases have been used to write no prompt, and under this design no prompt is written at all.

**Diagnostic set, NOT judged** (the $0 read used these, so they cannot count): Arm A 02
`groups.ts` (admin-check), 04 `app-sync.ts` (idor), 07 `knowledgeBase.ts` (idor), 10
`page/index.js` (idor), 05 `server/runtime/scripts/index.js` (auth-bypass); parent and fix, 10 per
run. Its purpose is to confirm or refute the read case by case.

**Clean set, false positives:** 30 production files from the six clean repositories at their
pinned heads (`field-trial-corpus-2026-09-19/live-heads.tsv`), drawn by ascending
`sha256("forced-routing-2026-09-28" + repo + path)` among files the shipped skip rule does not drop:
10 matching `EXPRESS_ROUTE_DEF_RE` or `APP_ROUTER_ROUTE_DEF_RE` for auth-bypass, the next 10 such
files for admin-check, 10 carrying a `SINK_PATTERNS` hit for idor; anchor = the first hit. The
draw is computed and committed before the run.

## Rules, fixed now

- **Per-file hit:** `isVulnerable: true` at high or medium confidence (both emit under the
  shipped Option C policy) on ≥4 of 5 parent runs AND on ≤1 of 5 runs of the same file's fix side.
- **Per-case hit:** at least one of the case's files is a per-file hit.
- **Recall criterion, held-out only:** ≥4 of 10 case hits = PASS (routing and context are the
  constraint; the next build item is lane routing, and no prompt changes). ≤1 = FAIL (the model
  misses defects it is handed; stage 2 triggers). 2 or 3 = INCONCLUSIVE: reported, no build.
- **Noise criterion:** a clean file flagged on ≥4 of 5 runs is a clean-flag. More than 3 of 30
  clean-flags = forced routing is too noisy to ship regardless of recall. Every clean-flag is read
  blind afterwards and reported as true finding or false positive; that reading cannot rescue the
  criterion. Fix-side flags are reported beside them.
- **Stop conditions:** a call to a file or lane not listed here; a fingerprint mismatch; the
  ceiling. A stop is reported, never repaired in the same execution.

## Money

| part | calls per run | projected per run |
|---|---|---|
| held-out, 15 files × 2 sides | 30 | $1.15 |
| diagnostic, 5 files × 2 sides | 10 | $0.56 |
| clean, 30 files | 30 | $1.13 |
| **per run** | **70** | **$2.84** |
| **total, n = 5** | **350** | **$14.21** |

Cost model: input tokens = lane base + slope × file bytes, fitted on the trial's recorded calls
(auth-bypass 6,023 + 0.266/byte, admin-check 5,664 + 0.266/byte, idor 3,333 + 0.353/byte), priced
at $3 per million input plus 3% for cache writes, and $15 per million output at 320, 240 and 740
output tokens. It reproduces the recorded large-file calls within 1% and OVERSTATES small-file
calls by up to 2×, because it ignores cache reads; clean files are priced at 15 KB each. The
trial's measured mean was $0.0355 per call; this plan averages $0.041. **Hard ceiling $18.00**,
enforced by an observer that refuses the next call once cumulative measured cost would pass it,
as `run-arm-a.cjs` did. The MEASURED total is the figure of record, never this projection.

## Built first, at $0, before any dollar

A forced-routing runner reusing `trial-observer.cjs`; a rehearsal against a mock that answers
true and false, showing the scorer registers both; the anchor list and the clean draw printed and
committed. The paid run happens only on the owner's named approval of the amount above.

## Stage 2, conditional, not priced here

Triggered only by a FAIL or a noise failure. A revised prompt may be written using Arm A and the
2026-09-27 held-out set; it is judged on a THIRD held-out set, frozen and committed before the
revision is written, against the same clean set, and priced when triggered.
