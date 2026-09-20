# Field trial, amendment A1: cost correction before any paid call, 2026-09-19

Changes only the dollar figure attached to amendment A1 (sha256
`3317a1ae98ded2782709cf1f6e5fd87397d4f0e994fc3a1fe268cb090476f6cb`). The hit rule, thresholds, call
counts (13 at the parents, 14 at the fixes) and the point prediction (2 HITs, cases 05 and 07) are
unchanged. No paid call has been made.

## Why the $0.72 figure was wrong

It priced every call at one flat rate, $0.0268, the mean of three cold calls on small real files.
That is the defect this trial's own pre-registration names in the scan's estimator. The detectors
send the whole target file for a route-definition trigger, so a call's cost scales with the file.

Measured at zero spend: the exact paid command was run against a local mock that records each
request's size (`arm-a-payload-sizes-2026-09-19.jsonl`, sha256
`1d9bc1cde3d057614309a284c16fc6ae36e1906da6eefb3729fc0eb2413f44c7`). 27 requests, matching the
dry-run counts case by case. Case 10's four calls each carry 137,360 to 139,115 characters of
message; every other call carries 1,861 to 36,506.

## Projection from the measured payloads

Priced with the repository's own table (`claude-sonnet-4-6`: $3 in, $15 out per million tokens;
cache write 1.25x, cache read 0.1x). Token counts are estimated from characters; they are not
measured, because counting them exactly needs the API.

| assumption | total | case 10 alone |
|---|---|---|
| central: 3.5 characters per token, 700 output tokens, cache reads after the first write per detector | $1.14 | $0.52 |
| upper: 3.0 characters per token, 1,500 output tokens, no cache reads | $1.97 | $0.72 |
| the flat rate the $0.72 approval used | $0.72 | n/a |

Under the central projection, cumulative spend crosses $0.72 at call 23 of 27, the first call of
case 10 at the parent. A pass run under the $0.72 approval would stop there with case 10 unpaired
and case 11 unrun, and Arm A would have no verdict.

## Requested approval

**$2.00**, which covers the upper projection. The stop rule is unchanged in kind: if the observer's
token-priced figure exceeds the approved amount, the pass stops at that boundary and reports.
