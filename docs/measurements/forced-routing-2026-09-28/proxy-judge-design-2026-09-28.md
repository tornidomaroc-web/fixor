# Forced routing, PROXY judge on the owner's subscription: design, 2026-09-28. BUILT AND REHEARSED AT $0 (see the tracker's forced-routing entry for the PR). RUN 2026-09-29: PROXY-FAIL, held-out 1 of 10; results in `proxy-run-2026-09-29/`, reading in the tracker.

**Status line, added when the judge was built (2026-09-28):** `src/test/proxy-judge.ts` implements
this design; `test:proxy-judge-rehearsal` in `test:ci` rehearses it with a stub executable. Two
things the build settled that this design left open: the process is also started with
`--strict-mcp-config` (no MCP server from any configuration) and `--setting-sources ""` (no user,
project or local settings if an empty value is honoured; whether it also keeps the user
CLAUDE.md out is unverified without a model call); no `--max-turns` is passed, as below;
and the run refuses to start on any API credential (`ANTHROPIC_*`, `AWS_*`, `CLAUDE_CODE_USE_*`, a
`sk-ant-` shaped value, `apiKeyHelper` or a credential under `env` in the user settings), not only
on `ANTHROPIC_API_KEY`. Everything below is otherwise as written before the build.

## The owner's ruling, recorded so no session asks again

2026-09-28: the owner is on a Claude Max subscription and refuses any paid Anthropic API run.
The pre-registered $18.00 forced-routing run will not be approved. No later session may request
it, propose a smaller paid run, or load `FIXOR_PARKED_KEY`. The runner in `src/test/` keeps its
live mode, which cannot start without an explicit key file; it is now reachable in practice only
through mock mode, which this design reuses to produce the requests.

## The question, unchanged

Handed the defect's file by the lane that owns it, with the shipped prompt, does a Claude model
flag the defect? The paid run would have answered it on the shipped instrument. This design
answers it on a PROXY instrument at no API cost, and the difference is stated below, not hidden.

## Why not this session, and why not Agent-tool subagents

- **This session cannot judge.** It runs as Claude Opus 5.5 (`claude-opus-5-5`), not the shipped
  `claude-sonnet-4-6`, and it is not blind: it has read the advisories, the fix diffs, the
  anchors, the Arm A verdict read, and it knows which 30 files are the clean ones.
- **Agent-tool subagents cannot be made blind or shipped-model.** They run under Claude Code's
  agent system prompt with filesystem and web tools, so they can open this repository, the
  anchors file or the advisory. The `sonnet` alias resolves to the latest Sonnet, not 4.6. A
  forked subagent inherits this session's whole context.

## The instrument: one headless Claude Code process per request

For each request file the runner's MOCK mode writes (`calls/NNNN-request.json`), a script, not a
session, starts one fresh process:

```
claude -p --model claude-sonnet-4-6 --tools "" --no-session-persistence \
  --system-prompt <the request's body.system text, joined> \
  --json-schema <the request's body.tools[0].input_schema> \
  --output-format json          # the user message body.messages[0].content goes on stdin
```

run with its working directory set to an EMPTY temporary directory outside the repository, and
with `ANTHROPIC_API_KEY` absent from its environment (the script refuses to start otherwise,
because with a key present `claude -p` bills the API, which is exactly what the owner refused).
**Never `--bare`**: bare mode reads only `ANTHROPIC_API_KEY` and never the subscription login.
**Never `--fallback-model`**: a silent model swap would change the instrument.

What the judge sees: the shipped system prompt, the shipped user message (file path, language,
imports, the whole file, the trigger line), and the shipped tool's input schema as the required
output shape. Nothing else.

What is withheld, mechanically: the request file's `context` block (set, case, side, lane, repo,
commit, blob sha, anchor line) is never passed; no labels, advisories, fix diffs or clean-file
marks exist in the process's working directory; no tools exist to fetch them. The script writes
each raw result to disk; the pre-registered scorer reads them. This session does not read any
verdict before the scorer has run, and there is no selective re-prompting.

## Deviations from the shipped instrument, all known before the run

| | shipped (pre-registered run) | proxy |
|---|---|---|
| model | `claude-sonnet-4-6` | `claude-sonnet-4-6` if the subscription serves it; the script reads the model from each result's JSON and STOPS on any other |
| temperature | 0 | not settable in Claude Code headless; the harness default |
| output | forced `tool_use` of the lane's tool | structured output validated against the same input schema |
| system | the shipped prompt only | the shipped prompt via `--system-prompt`; the user-level `~/.claude/CLAUDE.md` may still be attached as context (it holds machine notes, nothing about Fixor cases) |
| billing | per-token API | the owner's subscription; the owner must confirm extra usage / usage credits are OFF before the run, because the script cannot see that setting |
| training exposure | public advisories may be memorised | the same, and it inflates recall in both |

## Repeats

Five, as pre-registered. Because the proxy's temperature is not 0, repeats carry sampling
information, and the pre-registered ≥4-of-5 and ≤1-of-5 rules apply unchanged. One pass would
make the pre-registered criteria inapplicable, so one pass is not a result. The run is staged:
pass 1 over all 70 requests first, which also proves the model identity and the parser; passes
2 to 5 follow, resumable.

## Failure rules, fixed now

- A process that fails for infrastructure reasons (rate limit, network, crash, non-zero exit
  without a result) writes NO response file; the script stops, and a later invocation resumes
  exactly those requests.
- A result whose content fails the schema is a final null verdict for that request and pass.
- Any result reporting a model other than `claude-sonnet-4-6` stops the run; the owner decides
  whether a different-model proxy is still wanted, and it would be labelled as such.

## Volume

Measured from the 70 real-corpus requests of the 2026-09-28 mock dry run: 2,162,901 characters,
about 618,000 input tokens per pass, about 3.1 million over five passes, plus about 300 output
tokens per call. That is several Max usage windows, not one; the resumable design is for that.

## How the result may be read and labelled

The pre-registered criteria are applied unchanged and reported as **PROXY-PASS**,
**PROXY-FAIL** or **PROXY-INCONCLUSIVE**, with the noise result beside it. In the tracker it is
labelled "PROXY, Claude Code headless on the owner's subscription, temperature uncontrolled;
NOT the pre-registered forced-routing measurement". It is evidence for the next build decision
only, never for F-004, a stage-3 green, or any public claim.

Asymmetric reading, stated in advance: a PROXY-FAIL (the model misses defects it is handed, in
their own file, by their own lane) is strong evidence that routing work alone will not raise
detection. A PROXY-PASS is weaker: it is an upper bound (the trigger line is a hint no router
has) and may be inflated by memorised advisories.

## To build before any run, at $0, in its own PR

`src/test/proxy-judge.ts`: reads a mock run's request files, drives one `claude -p` process per
request and pass as above, writes `proxy/NNNN-pP.json` per result, resumes, stops on the rules
above, and hands the verdicts to the existing `score()`. Its rehearsal in `test:ci` replaces
`claude` with a stub executable (no model, no network) and proves: the `context` block never
reaches the process, a present `ANTHROPIC_API_KEY` refuses the run, a wrong model stops it, an
infrastructure failure leaves no file and resumes, and 70 × 5 results score through `score()`.
