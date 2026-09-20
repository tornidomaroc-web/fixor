# Field trial on unfamiliar TS/JS SaaS code: pre-registration, 2026-09-19

Written before any paid call. Nothing below has been run against a model. The known-answer
admission (`known-answer-admission.md`, sha256 `1224650e3f3e9d14536cb62a5aff9f403c221bf7c73289e908a7a78acf3f9cb4`)
was frozen and hashed at 2026-09-19T16:56:49Z, before the trigger dry run touched any file. The
zero-spend trigger dry run (`trigger-dryrun-2026-09-19.json`) then ran, and every number in this
document that comes from it is labelled as measured.

**Ordering disclosed.** The known-answer trigger reach (below) was run BEFORE this document was
written, and no threshold on reach was registered before it ran. Reach is therefore reported as a
description, never as a test that passed or failed. The live draw ORDER was fixed before any clone;
the inclusion rule (a prefix of that order under the ceiling) was written after the six counts were
read, and it leaves no discretion.

## Question

On TypeScript and JavaScript SaaS code that nobody wrote for Fixor, (1) does Fixor flag real,
already-published access-control bugs, and (2) is a flag worth a human's triage time?

## Instrument

Paid runs use `npm run scan -- <dir> --yes` at the Fixor tree `84e08fdf955c77969c248d25f5512d89a30c79b5`,
model `claude-sonnet-4-6`, escalation off. The call counts below come from
`src/test/measure-trial-triggers.ts`, which runs the shipped `detect()` of every shipping detector
over scan.ts's own per-file loop, under the measure-stage3-calls spy shape (real key deleted, null
client asserted, canned responses, no delegation branch). Controls: a positive directory (one
positive fixture per model-calling detector at its ASSUMED-PATH) drew 12 calls on 5 files; a
negative directory drew 0; a `tests/` path drew 0 under Windows separators.

## Arm A: known answers (12 published advisories, frozen admission)

**Measured, zero spend.** On 7 of 12 cases no detector of the advisory's lane family reaches the
model on any target file: 02, 03, 06, 08, 11 and 12 draw no call at all, and 01 draws one
webhook-unverified call against an access-control bug. Reachable: 04, 05, 07, 09, 10. **The
end-to-end ceiling is therefore 5 of 12**, before the model reads a line.

**Hit rule.** A hit is a finding at HIGH or MEDIUM from a detector in the case's lane family
(access-control = auth-bypass, admin-check, idor; env-exposure alone for case 12), on a target file
at the vulnerable parent, whose reported line lies within 20 lines of an old-side hunk of the fix
diff. A family finding outside the window is recorded as a file-level hit and does not score.

| case | reaches the model | target hunks (old side) | predicted |
|---|---|---|---|
| 04 actual | auth-bypass, admin-check on `app-sync.ts` | 11 hunks, 19..426 | MISS: routes carry session validation; the bug is ownership, and idor does not reach |
| 05 FUXA | auth-bypass, admin-check on both files | `command/index.js` 78-84; `node-red/index.js` 152-163 | HIT |
| 07 lobe-chat | idor on `routers/lambda/file.ts`, `services/file/index.ts` | 64-78; 61-66 | HIT |
| 09 signalk | auth-bypass, admin-check on `tokensecurity.js` | 251-277 | MISS: central security module, not a route file |
| 10 apostrophe | auth-bypass, admin-check on `page/index.js` | 1651-1661 | MISS: permission logic inside a large module method |

**Point prediction: 2 hits of 12** (05 and 07). **FAIL at 1 or fewer. PASS at 3 or more. 2 is
inconclusive.** Calls predicted: exactly 13 (the dry-run count). Scored cases with no model call
are misses, not exclusions.

## Arm B: live repositories (runs only if Arm A is not FAIL)

Draw: organisation-owned, TypeScript or JavaScript primary, private vulnerability reporting
enabled, pushed within 30 days, GitHub size at most 1,000 MB, named nowhere in the tracked tree,
not in Arm A. Ordered by sha256(admission hash + owner/repo). Included: the longest prefix of that
order whose projected cost, with Arm A, stays at or under $40.00.

| order | repository | HEAD (pinned) | files | reaching model | calls (measured) | projected |
|---|---|---|---|---|---|---|
| 1 | medusajs/medusa | 48a8812735f6630bcc12b3997b6d1d1f559cd492 | 9,534 | 409 | 1,199 | $32.13 |
| 2 | novuhq/novu | 36c5c0cefa400e8edc6ec8b18ac4574288eabd03 | 8,655 | 81 | 113 | $3.03 |
| 3 | outline/outline | f9ae2dcd6d4eec191939d906f6b0d142789f7788 | 2,535 | 68 | 124 | $3.32 |
| 4 (out) | umami-software/umami | ec0ff50388c264ed8ce46f00967e92f7e71476ae | 1,386 | 152 | 454 | $12.17 |

Arm B: 1,436 calls. Projection rate $0.0268 per call, the mean of three cold real-code calls in the
tracker: uncorroborated, and a projection, never a measurement.

**Triage.** Flags (HIGH and MEDIUM) from the three repositories are pooled and ordered by
sha256(admission hash + repo + path + line + detector). The first 16 are triaged by hand, 45
minutes each, after a per-repository setup budget of 3 hours that is not counted in the 45. Each
ends as CONFIRMED (reproduced on a local instance at the pinned HEAD, and absent from the
repository's advisories and issues), FALSE, or UNRESOLVED. A repository that cannot be run inside
its setup budget contributes no CONFIRMED. Reports go through private vulnerability reporting and
carry no product mention.

**Why not 25 percent precision.** The only precision measured on real code is regex-only
secrets-exposure: 0 of 15 correct on 13 mature repositories, 3 of 5 on the ICP sample, 3 of 20
pooled. No precision exists for the five model detectors. A 25 percent bar sits above both
anchors and would mostly decide the verdict before the run. The bar below separates "about zero"
from "at least the pooled anchor": at a true precision of 15 percent, 0 CONFIRMED in 16 happens 7
percent of the time; at 0 percent, always.

**Point prediction: 1 CONFIRMED in the first 16 triaged. FAIL at 0. PASS at 2 or more. 1 is
inconclusive.** Also reported, not scored: CONFIRMED / (CONFIRMED + FALSE), human hours per
CONFIRMED, total flags per repository.

## Stop conditions

Each is a STOP and a report, never a repair inside the same execution.

1. A paid run's call count differs from its dry-run count (13 for Arm A; 1,199 / 113 / 124).
2. Any `llmCallsFailed` above 0, any file not analysed, or a scan exit code of 2.
3. Any model id other than `claude-sonnet-4-6`.
4. Any pinned HEAD reads differently before or after its run.
5. Measured spend, read from the Anthropic Console usage delta after each repository, exceeds the
   approved figure. The CLI has no cap of its own; the stage boundary is the cap.
6. Arm A reads FAIL: Arm B does not run.

**Disclosure rule.** This repository is public. No detail of an Arm B flag that is CONFIRMED or
UNRESOLVED (repository, path, line, shape) enters the tracked tree until the maintainer has
published an advisory or 90 days have passed since the report. Until then the tracked record
carries counts only.

## What this can settle and what it cannot

It can settle whether Fixor flags known access-control bugs in unfamiliar TS/JS apps at a useful
rate, whether a human hour spent on its flags returns a real finding, and which shapes it cannot
reach. It cannot settle a detection rate with an interval (n is 12 and 16), customer demand or
willingness to pay, F-004, anything about Python, or MEDIUM calibration in general. A CONFIRMED
finding is a security result, not a sales lead.
