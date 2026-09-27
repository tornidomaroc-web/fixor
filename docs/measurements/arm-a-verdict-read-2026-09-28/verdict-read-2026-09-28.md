# Arm A: why the model said no, read from the recorded answers, 2026-09-28

Zero spend. No model call. Source: `docs/measurements/field-trial-2026-09-19/arm-a-observer-2026-09-19.jsonl`
(27 responses, every `toolInput` verbatim), mapped to case and side by timestamp against
`arm-a-run-log-2026-09-19.jsonl`. The corpus files are the ones hashed in
`arm-a-corpus-manifest-2026-09-19.tsv`; the fix diffs are the GitHub commits it names.

## What was stored and what was not

- **Stored:** every response. 27 calls, 35 verdict objects: 17 on the vulnerable parents, 18 on
  the fixes. 0 of 35 have `isVulnerable: true`.
- **Not stored:** the request payloads. The observer logged `usage` and the tool input, not the
  message body. Whether a given line was inside what the model saw is therefore INFERRED, from
  two things: the shipped payload rule (a route-declaration trigger sends the whole file up to
  200 KB; idor sends the whole file up to 200 KB) and the recorded input token counts, which
  match whole-file payloads (case 10: 132,720 bytes, 41,319 input tokens; case 04: 10,726 bytes,
  8,876 tokens; a per-lane linear fit on bytes reproduces the large-file calls within 1%).
- **Recoverable at $0, not done here:** the exact request bytes, by rebuilding each request at the
  run's tree `84e08fdf` through the canned-client spy. That needs a checkout of that tree, which
  this session did not make.

## Classification of the 17 parent-side verdicts

The fix-side 18 are all "no", as they should be, and carry no information about misses.

| case | lane that was asked | verdicts | was the defect in the payload? | class |
|---|---|---|---|---|
| 04 actualbudget (IDOR) | auth-bypass, admin-check | 2 | yes, whole file | **wrong lane asked.** Both answered their own question correctly: authentication is present (`validateSessionMiddleware`), `/sync` is not an admin action. Neither prompt asks object ownership; idor, the owning lane, never called (no source/sink pair). |
| 10 apostrophe (authorization logic) | auth-bypass, admin-check | 2 | yes, whole file (132 KB, under the cap) | **wrong lane asked.** Both judged the wildcard `app.get('*')` page route, correctly public. The defect is an inverted guard in the move-permission check about 1,250 lines away, which neither question covers; auth-bypass's scope contract already records "authorization correctness under present authentication: NOT judged". |
| 07 lobe-chat (IDOR) | idor | 6 | **no.** `knowledgeBase.ts`, the file with the commented-out ownership filter, was never sent | **vulnerable code not in context.** The six verdicts are on other files (and belong to a different advisory, corrections doc item 1). Secondary: each "no" rests on an unseen cross-file assumption, that `FileModel` built with `ctx.userId` scopes its queries. |
| 05 FUXA (unauthenticated disclosure) | auth-bypass, admin-check | 4 | **no.** The root cause, `server/runtime/scripts/index.js` (`isAuthorisedByScriptName` returns `true` for an unknown script), was excluded from the corpus | **vulnerable code not in context** (3 verdicts), plus **one candidate misjudgment on seen code**: auth-bypass saw `allowDashboard` pass any URL for which `url.includes('/dashboard')` is true straight to `RED.httpAdmin` (node-red `index.js` line 160) and called it "intentionally public". A substring test on the URL gates the admin editor; the fix replaced it with `req.baseUrl`. One reader's judgment. |
| 09 SignalK (missing auth on three routes) | auth-bypass, admin-check | 2 | the file, yes; the defect's evidence, no | **missing cross-file context.** The fix adds `/availablePaths`, `/hasAnalyzer` and `/serialports` to the lists of protected prefixes. The defect is their ABSENCE from those lists, which is visible only to a reader who knows the routes exist, and they are declared in another file. |
| 01 n8n (admin-check advisory) | webhook-unverified | 1 | n/a | wrong lane asked; the admin-check lane never called |

Counts over the 17 parent verdicts:

| class | verdicts |
|---|---|
| defect in the payload, but the lane asked could not express it; owning lane never called | 5 (04, 10, 01) |
| vulnerable code not in the context the model saw | 9 (07 all six, 05 three) |
| missing cross-file context | 2 (09) |
| candidate misjudgment of code seen in full | 1 (05, node-red `allowDashboard`) |
| prompt framing that biases toward no | 0 identified |
| a confidence or emit threshold | 0 (every verdict is `false`; there was nothing for a threshold to drop) |

## Reading

Sixteen of seventeen parent-side "no" answers are explained without the model misjudging
anything: the defect was not in front of it, or the lane that saw it was asked a different
question and answered that question correctly. One verdict is a plausible genuine miss on code
the model saw. So the field trial did NOT measure the model's judgment of access-control
defects; it measured routing and context. **This corrects the closing sentence of L-025 as first
written in #257** ("the binding constraint is the model stage"): the binding constraint is which
lane sees which file, with what around it. A prompt revision tuned against these cases would be
tuning against answers that were right for the question asked.

Limits: n = 5 cases, one reader, request bytes inferred rather than read.
