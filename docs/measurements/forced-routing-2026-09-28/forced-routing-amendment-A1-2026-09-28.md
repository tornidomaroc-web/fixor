# Forced routing, amendment A1: the anchor rule, and the inputs frozen before the run

Written 2026-09-28 while building the runner, before any paid call and before any rehearsal
result existed. Amends `../arm-a-verdict-read-2026-09-28/forced-routing-prereg-2026-09-28.md`,
which is left byte-identical (the runner pins its sha256 and refuses if it changes). Where the
two disagree, THIS file governs, and the disagreement is listed here in full.

## A1.1 The anchor rule was under-specified, and its literal reading points at imports

The pre-registration says the anchor is "the first changed line of the first fix hunk in that
file". Computed literally from the GitHub diffs, that line is an added `import` in six of the
twenty held-out and diagnostic files (held-out 02 `gateway/index.ts`, 04 all three, 06, 08
`errors.ts`; Arm A 04 `app-sync.ts`), because a fix that adds a helper imports it first. An
import is a meaningless sink for idor and a misleading "trigger line" for the other two lanes.

**Rule as run:** the anchor is the first added or removed line, over the file's hunks in diff
order, whose text is not blank, not comment-only, and not an import/require/re-export line
(`SKIP_LINE` in the script that produced `anchors-2026-09-28.tsv`). Parent-side line numbers
use the parent's numbering, fix-side the fix's. The rule is mechanical and was applied without
reading any file's contents; the resulting lines are in `anchors-2026-09-28.tsv` (40 rows: 15
held-out files and 5 diagnostic files, parent and fix). This is still a ceiling measurement: no
router has the fix diff.

## A1.2 Inputs frozen by this commit, all at $0

| file | what |
|---|---|
| `anchors-2026-09-28.tsv` | set, case, side, repository, commit, path, git blob sha, anchor line |
| `held-out-fix-side-manifest-2026-09-28.tsv` | the fix-side files of the held-out set, fetched 2026-09-28 with their blob shas (the 2026-09-27 manifest holds the parent side only) |
| `clean-draw-2026-09-28.tsv` | the 30 clean files: ascending `sha256("forced-routing-2026-09-28" + repo + path)` over supported files the shipped skip rule keeps, 10 route-shape for auth-bypass, the next 10 for admin-check, the first 10 with a shipped idor SINK hit for idor; anchor = first hit; files over the 200 KB whole-file cap skipped |
| `shipped-fingerprints-2026-09-28.json` | the three `SYSTEM_PROMPT_FINGERPRINT` values on `main` `05c5792`; the runner refuses on any difference |

Stated, not hidden: the draw's skip rule is a copy of the six detectors' regex, because
`route-def-pattern.ts` exports no such constant; the copy is byte-identical at this commit. The
draw is mechanical, so it keeps `novu:libs/testing/src/user.session.ts`, a test helper the
shipped rule does not drop; it counts as a clean file exactly as the rule says.

## A1.3 What the runner reads and what it refuses

It reads the case list and lane mapping from the committed admission table and the
pre-registration's own diagnostic sentence (both sha256-pinned), the anchors and draw from the
files above, and verifies every corpus file's git blob sha before the first call. It refuses to
start on: an ambient `ANTHROPIC_API_KEY` (the key comes from `--key-file` only), a missing key
file in live mode, a key file in mock mode, any fingerprint difference, any blob mismatch, a
ceiling above $18.00, or an output directory that already holds a run. The ceiling is enforced
before every SDK attempt, including production `callClaude`'s retries, from measured spend plus
a request-derived upper bound for the attempt, so the measured total cannot pass it.

## A1.4 Order of calls

Runs outer, files inner (all targets at n=1, then n=2, ...), so a stop leaves every file at the
same depth rather than some at n=5 and others untouched. The pre-registration did not say.

## A1.5 Where a run's output goes, and what of it may be committed

Every request file embeds the full third-party source file it was built from, and this
repository is public. The run directory therefore lives OUTSIDE the repository, beside the
corpora (`D:\RAGHAD JAD\Fixor-Final\forced-routing-run-<date>\`), exactly as Arm A's run directory
did. After the run, `results.json` (verdicts, costs, scores; no source) and `calls.jsonl` (usage
and cost per call; no source) are the files that may be copied into this directory. The
`calls/` request and response files stay outside. The key file is written by the owner's own
hand outside the repository and is never committed; the runner reads it and nothing else.

## A1.6 Not changed

Arms, cases, judged set, criteria, the per-file and per-case hit rules, n = 5, the projection
($14.21) and the hard ceiling ($18.00) are as pre-registered. Nothing has run.
