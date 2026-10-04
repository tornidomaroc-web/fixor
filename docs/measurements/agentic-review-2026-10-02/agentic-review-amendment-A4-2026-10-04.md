# Agentic change review, amendment A4, 2026-10-04. Committed before any case run.

Amends the pre-registration's stop conditions and A1 section 2 (Gate A) by reference; the
pre-registration and A1 to A3 are left byte-identical. Agreed with the owner on 2026-10-04 in the
form "a request refused as too long is recorded as unreviewable, counted as not flagged, and the
series continues; any other error stops the series". Section 2 records what was found in the
pinned CLI before this file was written, which is why the agreed rule gets a size rule before
sending (3.1) beside the agreed rule (3.2).

## 1. The gap

The built-in pastes the whole diff of the change into one prompt. Measured on the prepared states
(`agentic-review-build-2026-10-03.md`, "Token volume per run"): held-out 02 is 29,777,026
characters, 03 is 3,234,646 (vulnerable) and 3,236,464 (fix), 08 is 1,157,759. As built, the
harness stops the series on the first request the CLI or the API refuses, so Gate A could only
read AGENTIC-INCOMPLETE.

## 2. Found in the pinned CLI (2.1.284, sha256 `0416631e…da7d`), by reading the binary, no model call

1. **The model's window is 1M tokens** (`claude-opus-5-5`: `context.window` 1e6), but **a request
   over 200K tokens on a subscription needs usage credits.** The CLI's own description of its typed
   API error `long_context_credits_required`: "a request over the 200K-token context boundary needs
   usage credits". With credits off, such a request is refused with that error, which the agreed
   rule as worded ("prompt-too-long") does not name, so the series would still stop. With credits
   on, it would bill, which the owner's standing rule forbids.
2. **The CLI tries to recover from "Prompt is too long" on its own.** Its changelog (2.1.281):
   "Improved 'Prompt is too long' recovery in sessions dominated by one very large first prompt:
   that prompt is now summarized on its own". The binary carries the reactive-compaction path that
   summarises the opening round and, as a last resort, truncates its head. A run that recovers this
   way ends with no error and a report on a summarised or truncated diff, which no rule reading the
   run's outcome can tell from a review of the change.
3. The CLI recognises the size refusal by two phrases, "prompt is too long" and "input is too long
   for requested model"; the harness uses the same two.

Point 2 means the agreed rule alone, applied to the outcome of a run, would let an oversize change
be scored on a summary. Point 1 means the size that matters is 200K tokens, not 1M.

## 3. The rules that bind

**3.1 Size rule, decided before sending.** A state whose expanded prompt (the built-in's body with
its four git commands expanded, exactly what is sent) is longer than **300,000 characters** is
unreviewable. None of its five runs is sent, no wire check is made for it, and each run is
recorded with `unreviewable` and `sentToModel: false`. 300,000 characters is about 86,000 tokens
at the design's 3.5 characters a token and 120,000 at a pessimistic 2.5, which leaves the system
prompt, the tools and the 32,000-token output cap under the 200K boundary. The limit sits in a
measured gap: the largest prepared state under it is held-out 01's fix side, 237,606 characters;
the smallest over it is held-out 08, 1,157,759. The six prepared clean changes are all under it.

**3.2 The agreed rule, at run time.** A run that ends in an error the API returned for the
request's size (the typed `long_context_credits_required`, or either phrase in 2.3, on a message
the CLI marks as an API error or on the error result) is recorded unreviewable and the series
continues. Its tool calls are still audited; a call that voids under A3 or the tool set still
voids the series. **Any other error stops the series, as before.** The model's own prose naming a
long prompt is not a refusal.

**3.3 Counting.** An unreviewable run has no finding: on a vulnerable side it is not a hit, on a
fix side it is not a hit, on a clean change it is not a flag. The thresholds, the five runs per
state and Gate A's two numbers are unchanged.

**3.4 Disclosure, never gated.** Gate A's line and `results.json` carry the number of unreviewable
runs and the number of clean changes that would be flagged if every unreviewable run counted as a
flag. 3.3 makes an unreviewable clean change pass the noise bound for free; this number shows how
much of the clean result rests on that. It does not move the verdict.

**3.5 Compaction.** A run during which the CLI compacts (a `compact_boundary` event) is recorded
with the count and scored as made. With 3.1 in force the first prompt never triggers it; a long
run can.

**3.6 Precondition for the run.** Usage credits are OFF on the account, confirmed at claude.ai
before the series starts. The harness cannot see this setting. With credits off, a request over
200K tokens is refused (3.2); with credits on, it would bill.

## 4. What this does to Gate A, read now

Over the limit: held-out 02 (vulnerable), 03 (vulnerable and fix), 08 (vulnerable). 02 and 08 have
no fix side and already count as misses (A1 3.1). **03 is one of the five scorable cases, and
becomes a miss.** Gate A's 4 hits must now come from 01, 04, 09 and 10: **all four**. The
post-cutoff column is unaffected (02: 115,697 and 115,919; 04: 11,722). The clean changes were
prepared on 2026-10-04: 6 of the 10 drawn rows have a clean change under A1 3.2 (01, 02, 04, 05,
08, 09; 03, 06, 07 and 10 are rejected because every commit touching the drawn file changes more
than 10 non-test source files). Their prompts are 12,856 to 31,590 characters, all under the
limit, so 3.1 removes no clean change and 3.4's number can move only through 3.2.

**Not decided here.** With 6 clean changes, A1's bound "at most 3 flagged" admits half the noise
set. Whether the bound scales or the set is refilled is the owner's decision, and this amendment
does not make it.

Implemented in `626de79` (harness, scorer, stub); the rehearsal exercises each rule, 93 checks.

## 5. Nothing else changes

The case set, the hit rule, the fix-side rule, the clean rule, the thresholds, the model and effort
pins, the wire check, the void rules of A1 and A3, and the memorisation reading rule.
