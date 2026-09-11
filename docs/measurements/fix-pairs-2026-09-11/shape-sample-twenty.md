# Shape sample on twenty: pre-registration, 2026-09-11

Written and committed BEFORE the sample is drawn. Purpose: put a number on the one named,
unmeasured bias of the fix-pair selector (README.md, "Known, NAMED bias"): a message-and-path
selector finds only fixes whose authors described them.

## Repository and population

- Repository: twentyhq/twenty, the blobless clone at `../fix-pairs-corpus/twenty`, HEAD
  `2badd5da7db126e9b8e41c90bfa9617486205866`. Chosen because it is the largest in-scope
  TypeScript repository of the twelve, has the most keyword candidates outside grafana's
  `rbac` mass (75), and its server code sits under one path.
- Population: every non-merge commit reachable from HEAD whose diff touches at least one
  file under `packages/twenty-server/src/` with an accepted extension, outside the
  `SKIP_PATH_RE` segments. Selected by PATH ALONE; the message is not consulted. Size:
  5,688 commits, of which 53 are keyword candidates of some class (twenty has 75 in all; the other 22 touch no server file).
- Sample: 500 commits drawn uniformly without replacement from the population, seeded with
  the integer value of the first 8 hex of HEAD (0x2badd5da), so the draw is reproducible
  from this file. The 500 identifiers are written to `shape-sample-twenty.sample.txt` in
  this directory in the same commit as the result, in draw order.

## What is read, and by whom

For each sampled commit, the unified diff restricted to the population files
(`git show --format= -- <files>`), which fetches only those blobs. The diff text is
pre-screened mechanically by the regexes below, applied to ADDED or REMOVED lines only.
Diffs over 600 changed lines in the population files are labelled TOO-LARGE and not read.

Pre-screen shapes, fixed now, written from the six class definitions and NOT from
`PREFILTER_PATTERNS` (each is deliberately broader than any detector pattern, since the
purpose is to find fixes the vocabulary missed, not fixes the detector would catch):

| class | pre-screen: a changed line matching (case-insensitive) |
|---|---|
| auth-bypass | added line containing `guard`, `authenticat`, `isAuthenticated`, `currentUser`, `req.user`, `session.user`, `unauthorized`, `401`, or `AuthGuard` |
| admin-check | added line containing `admin`, `role`, `permission`, `forbidden`, `403`, or `superuser` |
| idor | added line containing `workspaceId`, `userId`, `ownerId`, `memberId`, `belongsTo`, `canAccess`, or a `where` clause gaining an id field |
| env-exposure | removed line containing `process.env`, `os.environ`, or `os.Environ` inside a response, log, or serialize call (`res.`, `json(`, `log`, `stringify`) |
| secrets-exposure | removed line containing a string literal of 16 or more characters assigned to a name containing `key`, `secret`, `token`, or `password` |
| webhook-unverified | added line containing `signature`, `hmac`, `timingSafeEqual`, `verify`, or `constructEvent` |

Every pre-screen positive is then read by the fresh second reader of the protocol (a
subagent that has never seen the detector source), given the diff and the six class
definitions, returning a class or "none" with one sentence. The pre-screen is a filter on
what gets read; the reader's verdict is the label. A pre-screen negative is labelled NONE
without reading; that is a stated limit of this sample, not a finding.

## Quantities recorded

- S = 500, the sample.
- L = sampled commits labelled TOO-LARGE.
- K = sampled commits that are keyword candidates (any class) under the committed list.
- P = sampled commits the reader labels as a fix of one of the six classes.
- M = P among commits that are NOT keyword candidates: fixes the selector missed.
- E = M / (S - L) x 5,688: the implied count of undescribed fixes in the population,
  a scaling of one sample in one repository, reported as a count and not as a rate.

## Thresholds, written before the result exists

The comparison is E against 53, the keyword candidates inside this same population, so
both nets are measured on the same water. With S = 500 and L = 0, each unit of M is about
11 undescribed fixes in the population.

- MISSES A LOT: M >= 5. Then E >= 57, at least as many undescribed fixes as described ones,
  and the vocabulary is the smaller of the two nets.
- MISSES LITTLE: M <= 2 AND P >= 1. At least one class fix exists in the sample, and the
  implied undescribed count is at most 23, under half the keyword count.
- UNINFORMATIVE: M = 3 or 4, OR P = 0 (no class fix found at all, so the sample cannot
  separate "the selector is good" from "the pre-screen is blind"), OR L >= 100 (a fifth of
  the sample unread). If L > 0 the E arithmetic uses S - L and the thresholds on M stand.

Note on power, stated in advance: 500 of 5,688 is under a tenth of the population, and M is
a count of single digits. The band M = 3 or 4 is refused rather than argued.

## What each outcome commits us to, decided now

- MISSES A LOT: a second selector, `selector B`, is committed: the pre-screen shapes above,
  run by path over all twelve repositories, with its own candidate counts and its own
  rejection records, and every pair record names which selector found it. The corpus source
  does not change. The keyword list stays byte-identical.
- MISSES LITTLE: env-exposure's count of two candidates in 277,000 commits is read as a
  statement about the defect class in mature open-source code, bounded by this sample's
  size and by being one repository, and it goes in front of the owner as such rather than
  as a failure of the search. env-exposure lists its cases and prints no count line.
- UNINFORMATIVE: the bias stays named and unmeasured; no selector is added; a larger draw
  or a second repository is the owner's call and is pre-registered again if taken.

## Cost and key

Network only: blob fetches for at most 500 commits' population files. No API key is present
in the environment; the reader runs on the measuring session's own runtime, not the
repository's key. No model call through this repository's code; no recording.
