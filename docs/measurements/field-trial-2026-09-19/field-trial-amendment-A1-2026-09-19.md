# Field trial, amendment A1: a negative control for Arm A, 2026-09-19

Written BEFORE any paid call. It does not edit `field-trial-prereg-2026-09-19.md`
(sha256 `3c9328572879c061b99a48af6db287d61b97f8296676ab977658faac9e2c9f4c`) and moves no threshold.
It changes what counts as a hit, because the registered rule was shown, at zero spend, to pass a
model that says "vulnerable" to everything.

## The finding that forces it

A dress rehearsal ran the exact paid command over all 12 cases against a local mock of the Messages
API that answers every call "vulnerable, HIGH" and names no route. Everything else was real: the
shipped scan, the shipped detectors, the registered scorer. Call counts matched the dry run on every
case (13), no call failed, every exit code was 0.

| model | registered rule | paired rule (below) |
|---|---|---|
| always "vulnerable", no route named | **3 of 12: PASS** (cases 04, 07, 09) | **0 of 12** |

Why the registered rule passes it: a finding's line is set by the detector, at the route the model
names or, failing that, at the trigger line; idor reports the sink of the pair the model picks. On
04 the ±20-line windows cover 397 of the file's 431 lines; on 09 and 07 the fallback line happens to
fall inside a window. The same mock on the FIXED version of the same files flags the same places, so
a control at the fix commit separates discrimination from indiscriminate flagging.

## Amended hit rule

A case is a HIT only when BOTH hold:

1. At the vulnerable parent: the registered rule (a lane-family finding on a target file within 20
   lines of an old-side hunk of the fix diff).
2. At the fix commit, on the same files: NO lane-family finding within 20 lines of a new-side hunk.

The registered rule's count is still computed and reported beside it, labelled as not
discriminating. Thresholds unchanged: **FAIL at 1 or fewer, PASS at 3 or more, 2 inconclusive.**
Scored cases with no model call are misses.

Every miss is reported as exactly one of:
- never reached: no lane-family detector called the model at the parent;
- read, nothing returned in the family at the parent;
- read, a family finding at the parent but outside the window (file-level hit);
- read and flagged in the window at the parent, but ALSO flagged in the window at the fix (not
  discriminating).

## Point predictions

| case | predicted | reason, stated before any result |
|---|---|---|
| 04 | miss, read, nothing returned | the routes carry session validation; the bug is ownership and idor does not reach |
| 05 | HIT | whole file is sent; the unauthenticated route is nameable, and the fix adds its guard |
| 07 | HIT | idor reaches the file router; the fix adds the ownership filter at that sink |
| 09 | miss, read, nothing returned | central security module; a missing path in an allow-list is not the route shape the prompt asks about |
| 10 | miss, read, nothing returned | the missing check is on a destination parent inside a method, not a route |
| 01 02 03 06 08 11 12 | miss, never reached | measured in the dry run |

**Point prediction: 2 HITs of 12 (05 and 07).** Registered-rule count predicted: 2 (the same two;
04 and 09 are predicted not flagged at all).

## Calls and cost

Exactly **27** calls, from the zero-spend dry runs: 13 at the parents (01:1, 04:2, 05:4, 07:2, 09:2,
10:2) and 14 at the fixes (01:1, 04:2, 05:4, 07:2, 09:2, 10:2, 11:1). Projected at the measured cold
rate of $0.0268 per call: **$0.72**. A projection, not a measurement.

## Instrument

After `npm run build` at tree `84e08fdf955c77969c248d25f5512d89a30c79b5`, per case and version:

`node --require <tools/trial-observer.cjs> --env-file=.env dist/cli/scan.js <dir> --yes --output=<report>`

with these set in the environment, which Node gives precedence over `.env` (verified with a probe):
`FIXOR_REPLAY= FIXOR_RECORD= FIXOR_REPLAY_ROOT= FIXOR_ESCALATE_MEDIUM=false
FIXOR_SECRETS_LLM_OPT_IN=false FIXOR_ADMIN_CHECK_LLM_OPT_IN=false FIXOR_DEBUG_IDOR_LLM=
FIXOR_HALT_USD= FIXOR_PILOT_ENABLED=false SENTRY_DSN= LOG_LEVEL=info
ANTHROPIC_BASE_URL=https://api.anthropic.com`. `.env` cannot be read in this session, so every
behaviour flag the code reads is pinned to its default rather than trusted.

`trial-observer.cjs` is a pass-through at the SDK boundary: it records the requested model, the
model the response reports, token usage and the raw verdict for every call, and alters nothing.
Measured cost is those tokens priced by the repository's `calculateCost`. The Anthropic Console
usage delta over the run's UTC window is the owner's reading and is reported beside it; a
divergence is reported as a divergence.

## Stop conditions

The six registered conditions, with these readings fixed before the run: condition 1 compares each
case and version against the counts above; condition 3 applies to the model id Fixor requests, and
the model id the response reports is recorded and stated as observed. Parent and fix runs happen in
one execution, case by case, parent first.
