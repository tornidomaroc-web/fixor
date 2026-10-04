# Agentic change review: build record, 2026-10-03. No model call, no case run.

What was built under the pre-registration (`agentic-review-prereg-2026-10-02.md`) and amendments
A1, A2, A3, what the rehearsal and the revert-one-guard loop show, what the preparation of the real
cases found, and what blocks the real run. Identifiers and counts only; no third-party source.

## Tooling

| file | role |
|---|---|
| `src/test/agentic-prepare.ts` | blame rule, defect windows, neutral repositories outside the repo, fix side by `git apply --3way`, clean rule A1 3.2; resumable (`--resume`), manifest marked partial until complete |
| `src/test/agentic-review.ts` | harness: pinned CLI 2.1.284 by sha256, built-in prompt pinned by sha256, recorder wire check (`--recorder-check`), tool list required (`--expect-tools`), tool-call audit with A3 containment, resume with VOID and model-mismatch refusals, refuses a partial manifest |
| `src/test/lib/agentic-review.ts` | scorer (hit rule, 4 of 5, at most 1 of 5 fix side, A1 3.1), Gate A, stream parser, audit, neutral check |
| `src/test/lib/agentic-review-stub.ts` | stub CLI for the rehearsal: no model, no network |
| `src/test/test-agentic-review-rehearsal.ts` | keyless rehearsal in `test:ci`: 84 checks |

## Rehearsal and the revert-one-guard loop

The rehearsal passes 84 of 84 at `1113182`. Each guard was reverted, one at a time, in the compiled
output, and the rehearsal rerun; a guard is shown when the rehearsal fails with it reverted.

- **Loop v2, complete, 44 guards, at `1914585` (rehearsal of 69 checks):** 36 failed the
  rehearsal as required; 8 did not: the 4-of-5 vulnerable bar; the neutral check's commit count,
  author, message and origin; the harness's neutral check before a run; the blame acceptance; the
  A3 network guard on `git apply`. The restored control passed 69 of 69.
- **Tests added for the survivors (`91df1b0`):** a 3-of-5 boundary; one negative per neutral
  property; a prepared state that gains a commit is refused before it is run; a case whose blamed
  commit adds the line under another path is rejected.
- **Loop v4, final code (`1113182`, 47 guards incl. three for resume):** stopped by Claude Code
  for low system memory after 17 of 47. All 17 failed the rehearsal, including the five former
  survivors among them (4-of-5 bar, four neutral properties). **Not re-run on the final code:** the
  other 30, which are 27 guards from v2 and the three resume guards. In v2, 24 of the 27 failed the
  rehearsal; of the other three, the harness's pre-run neutral check and the blame acceptance have
  tests since v2 but no loop result, and the third is the `git apply` guard below. The three resume
  guards have never been looped.
- **Not exercisable:** the A3 guard on `git apply` reading a network failure as "no fix side". The
  `git diff` and `git worktree add` before it fetch every blob the apply reads, so the path is not
  reached; it is kept as a defensive guard and claimed as nothing.

## Preparation of the real cases

Three preparations were made, on 2026-10-03, into neutral roots on `D:\`. The first stopped on a
network error (the gap A3 closes). The second outlasted one background process's two-hour limit.
The third, resumable, prepared all 14 cases; its resume of the clean rows was stopped by Claude
Code for low system memory. **The manifest is partial: 14 cases, 0 of 10 clean rows. The harness
refuses it.**

| set | case | blame rule | fix side | note |
|---|---|---|---|---|
| held-out | 01 | accepted | yes | |
| held-out | 02 | accepted | **no** | patch conflicts at I in 2 of 3 defect files (reproduced by hand) |
| held-out | 03 | accepted | yes | |
| held-out | 04 | accepted | yes | |
| held-out | 05 | accepted | **no** | patch conflicts at I |
| held-out | 06 | accepted | **no** | patch conflicts at I |
| held-out | 07 | **rejected** | | INTRODUCTION-AMBIGUOUS: the anchor's file is absent at the blamed commit |
| held-out | 08 | accepted | **no** | one defect file absent at I |
| held-out | 09 | accepted | yes | |
| held-out | 10 | accepted | yes | |
| post-cutoff | 01 | **rejected** | | INTRODUCTION-AMBIGUOUS |
| post-cutoff | 02 | accepted | yes | |
| post-cutoff | 03 | **rejected** | | INTRODUCTION-AMBIGUOUS |
| post-cutoff | 04 | accepted | **no** | patch conflicts at I |

**What this means for Gate A, read from A1 alone.** 9 of 10 held-out cases are accepted, so the
precondition (at least 8) holds. Four accepted cases have no fix side and count as misses (A1
3.1). Five cases can score: 01, 03, 04, 09, 10. Gate A continues only with 4 hits, so it needs 4
of those 5.

## Token volume per run, measured from the inputs the CLI would receive

The prompt is the built-in's body (10,590 chars, sha256 `a726e895…`) with its `!` git commands
expanded in each prepared state, computed with the harness's own functions; tokens are chars / 3.5,
the design's estimate, not a tokenizer. The agent's own reads come on top and are measured only by
a real run.

| set | case | state | prompt chars | ~tokens |
|---|---|---|---|---|
| held-out | 01 | vulnerable / fix | 237,552 / 237,606 | 67,872 / 67,887 |
| held-out | 02 | vulnerable | 29,777,026 | **8,507,722** |
| held-out | 03 | vulnerable / fix | 3,234,646 / 3,236,464 | **924,185 / 924,704** |
| held-out | 04 | vulnerable / fix | 36,766 / 45,005 | 10,505 / 12,859 |
| held-out | 05 | vulnerable | 18,598 | 5,314 |
| held-out | 06 | vulnerable | 19,796 | 5,656 |
| held-out | 08 | vulnerable | 1,157,759 | **330,788** |
| held-out | 09 | vulnerable / fix | 13,593 / 13,704 | 3,884 / 3,915 |
| held-out | 10 | vulnerable / fix | 11,126 / 11,182 | 3,179 / 3,195 |
| post-cutoff | 02 | vulnerable / fix | 115,697 / 115,919 | 33,056 / 33,120 |
| post-cutoff | 04 | vulnerable | 11,722 | 3,349 |

Median 12,859 tokens over the 17 states; the clean rows are not prepared and not measured.

## What blocks the real run (not resolved here)

1. **Oversize changes.** The built-in pastes the whole diff of the change into one prompt. Held-out
   02 (about 8.5 million tokens) cannot be sent; held-out 03 (about 0.92 million, one of the five
   scorable cases) and 08 (about 0.33 million) are at or beyond an input window. A run that the CLI
   refuses is an infrastructure stop, so as built the series stops at the first such state and
   Gate A reads AGENTIC-INCOMPLETE. The pre-registration and A1 to A3 say nothing on this; the rule
   has to be decided and committed before any run.
2. **The clean rows are unprepared.** The preparation resumes with the same command plus
   `--resume`; it was stopped by memory pressure, not by a fault in it.

## Addendum 2026-10-04: A4, the clean rows, the loop on the final code. No model call, no case run.

The sections above are left as written on 2026-10-03.

**Blocker 1 resolved by amendment A4** (`agentic-review-amendment-A4-2026-10-04.md`, docs commit
`3c37c44`; code `626de79`). A state whose prompt exceeds 300,000 characters is unreviewable and
never sent; a run the API refuses for its size is unreviewable and the series continues; any
other error stops it. Over the limit: held-out 02, 03 (both sides), 08. Held-out 03 becomes a
miss, so Gate A's 4 hits must come from 01, 04, 09 and 10.

**Blocker 2 resolved: the manifest is complete** (prepared 2026-10-04T01:31:44Z, sha256
`c08461563ade…a9c254`, kept outside the repository). The resume ran as the only process. The cause
of the earlier memory kill was found: the mirrors are blob:none clones, a checkout fetches one
blob per round trip, each fetch writes a pack, and git's auto-gc then repacks the whole clone.
Auto-gc was turned off in the mirrors' local config, and the clean commits' trees were fetched in
one batch per tree beforehand (the request git sends for a lazy blob, with every id at once).
Objects are content-addressed, so nothing the preparation computes changes. Free memory never
fell below 10.2 GB.

| clean | commit | route-shaped | prompt chars |
|---|---|---|---|
| 01 | `0a13f9970f64` | no (fallback) | 31,590 |
| 02 | `490a1b600912` | yes | 12,856 |
| 03 | rejected | | |
| 04 | `8a536fa828ce` | no (fallback) | 14,457 |
| 05 | `54775f537d3a` | no (fallback) | 16,371 |
| 06 | rejected | | |
| 07 | rejected | | |
| 08 | `46aea4abe260` | no (fallback) | 13,327 |
| 09 | `00baa2bd6d0e` | yes | 29,479 |
| 10 | rejected | | |

Rejected rows: every non-merge commit before the cut-off that touches the drawn file changes more
than 10 non-test source files (A1 3.2), checked by hand per row (smallest counts: 03 16, 06 11,
07 24, 10 11). **6 clean changes, 2 of them route-shaped.** A1's bound "at most 3 of the 10 clean
changes flagged" was written for 10; it is not changed here.

**Revert-one-guard loop v5, complete, on `626de79` (rehearsal of 93 checks): 56 guards, the 47 of
loop v4 plus 9 for A4.** 55 failed the rehearsal as required. The one that did not is the A3 guard
on `git apply`, which this record already lists as not exercisable. Both restored controls passed
93 of 93. All three resume guards and every former survivor are now shown on the final code.
