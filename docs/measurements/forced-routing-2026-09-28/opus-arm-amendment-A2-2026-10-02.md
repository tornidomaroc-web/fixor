# Opus arm, amendment A2, 2026-10-02. Filed after ONE case request reached Opus and before any further one.

Amends `opus-arm-prereg-2026-09-29.md` and `opus-arm-amendment-A1-2026-09-30.md` by reference;
both files are left byte-identical. Approved by the owner on 2026-10-02. Under the
pre-registration's own rule a change made after the first case request is an amendment that
binds only calls made after it is committed. **A2 therefore binds every call of the Opus arm
except the one described in section 1, and that one produced no verdict.**

## 1. What happened on 2026-10-02: the run stopped on its first call

The first attempt started at 09:03:25Z with the pre-registered command, one path excepted
(section 3). The checks before it: the manifest hash over the 70 request files equalled the pin
(`86f972a7…ef41`); no API credential in the process, user or machine environment; the `.env`
key parked; `claude auth status` on the pinned build reported the claude.ai login, plan `max`,
provider firstParty.

Call n=1 of pass 1 was sent and answered by `claude-opus-5-5`. The judge then stopped, at
09:03:30.906Z, with its own line:

```
STOP instrument mismatch: call n=1 pass 1 reported maxOutputTokens 128000, pinned 32000; no file written, run stopped
```

**What exists of that call:** the stop line, and "answered by claude-opus-5-5 on 1". Nothing
else. The judge writes no file on that stop, so the model's structured answer was held in
memory by a process that exited: it was never written, printed, scored or read by anyone. Its
token usage was discarded with it and is not known. The output directory holds `arm.json` and
an empty `proxy/`; the attempt's `judge.log`, `judge-run.json` and its `results.json` (zero
verdicts) are copied to `stopped-2026-10-02/` beside them.

**Request 0001 will be judged again as part of pass 1.** The discarded answer was never
observed and the stop fired on a field that is constant for the model (section 2), so the stop
could not have depended on what the model answered: asking again selects nothing. The retained
pass-1 verdict for that request is, all the same, the model's second answer to it, and this
sentence is the record of that.

## 2. Cause: the guard read a field that never carries the cap

The pre-registration required every result to REPORT `maxOutputTokens` 32,000. Read from the
CLI's own code (build 2.1.284, minified):

- the result's `modelUsage[model].maxOutputTokens` is filled from the model's built-in default
  (`maxOutputTokens: _Y(model).default`), 128,000 for `claude-opus-5-5`;
- the cap in force is computed separately, where the request is built
  (`est(model)`, which applies `CLAUDE_CODE_MAX_OUTPUT_TOKENS` to the default).

So the field cannot show 32,000 for Opus under any setting, and the guard would have stopped
every call. The cap itself was in force as far as anything recorded shows: A1's recorder saw
`max_tokens: 32000` in the request body, and so does every check in section 6.

**Why the rehearsal did not catch it.** The stub that stands in for the CLI in `test:ci`
reported `CLAUDE_CODE_MAX_OUTPUT_TOKENS` back in that field. The stub encoded the assumption it
was supposed to test. The pre-registration's probe had shown 128,000 for Opus "by default" and
no call was ever made with the variable set and the field read. The stub now reports what the
real CLI reports (the model's default, whatever the variable says), so the rehearsal runs the
condition that stopped the real run.

## 3. The binary: pruned by the updater, restored, and moved

On 2026-10-02 the pinned path `%USERPROFILE%\.local\share\claude\versions\2.1.284` did not
exist. The folder held 2.1.285, 2.1.286 and 2.1.287: the CLI's updater keeps three builds.

Restored from the publisher: `https://downloads.claude.ai/claude-code-releases/2.1.284/win32-x64/claude.exe`,
246,480,032 bytes. Three checks, all passed: its sha256 is
`0416631e846f743110da5282409776fa1313e65f33a588aae066eaf8db0fda7d`, equal to the
pre-registration's pin; the release's own `manifest.json` lists that checksum and that size for
`win32-x64`; its Authenticode signature is Valid, signer `Anthropic, PBC`.

- **Call 1 ran it from** `%LOCALAPPDATA%\Temp\cli-2.1.284\claude.exe`. That path differs from
  the pre-registered command; the file is the pinned one by hash. That copy no longer exists:
  the machine's Temp folder was emptied at about 10:00Z the same day by something outside the
  session, which is a second reason a pinned build does not live there.
- **Every later call runs it from** `%USERPROFILE%\.local\share\claude-pinned\2.1.284\claude.exe`,
  a copy with the same sha256, in a folder the updater does not manage. This is the stable path.

The path never reaches the model as far as the wire check can see: the check refuses a request
body that names the folder the CLI was started from (section 4).

## 4. What changes, binding from this commit

**4.1 The reported field is recorded and never compared.** `maxOutputTokensReported` stays in
each verdict file as information. The pre-registration's sentence "Every result must report
`maxOutputTokens` 32,000 or the run stops and writes no file" is withdrawn.

**4.2 A wire check replaces it, before the first call of every pass and of every resume.** One
process is started exactly as a judge call is: the same executable, argv, stdin, whitelisted
environment and a fresh empty working directory, for the request about to be judged. The single
addition is `ANTHROPIC_BASE_URL`, pointing at a recorder on 127.0.0.1 that answers 400 to
everything, so no model is reached. The recorded `POST /v1/messages` must show all of:

| checked | required |
|---|---|
| `model` | `claude-opus-5-5` |
| `max_tokens` | 32000 |
| `thinking.type` | `adaptive` |
| `output_config.effort` | `high` |
| `temperature` | absent |
| Authorization | a Bearer OAuth access token (the subscription login) |
| `x-api-key` | absent, on every request the process sent |
| tools | `StructuredOutput` only, its input schema equal to the request file's |
| system prompt, user message | a block equal to the request file's, byte for byte |
| requests | exactly one `POST /v1/messages` |
| paths | no string naming the repository, the requests directory or the CLI's folder |

The owner's approval named six of these: the model, `max_tokens`, adaptive thinking, the
effort, the OAuth bearer and the absent `x-api-key`. The others are additions made while
building it, each because the check could otherwise pass on a request that differs from the
pinned one.

**The request shape is held to a baseline.** The first passing check in an output directory
writes `wire-baseline.json`: model, cap, thinking, effort, the set of body keys, the tool
names, the beta flags, the API version, the login class, and the roles and block counts of the
messages. Every later check must equal it. A1 found that the CLI gives Opus a different message
shape than Sonnet; the baseline is what stops that shape from changing between passes unseen.

A failed check before any call of an invocation refuses the start or the resume (exit 3, no
judge process, no verdict). A failed check before a later pass stops the run with the earlier
passes on disk (exit 2). Either way the baseline file stays, so the same command is refused
again until the request is back to the baseline; anything else goes to the owner.

**4.3 Output above the cap stops the run.** A result reporting more than 32,000 output tokens
means the cap was not applied or the call took more than one request. No file is written. Each
verdict file also records the CLI's `num_turns`.

**4.4 The CLI is accepted by sha256 only.** `--claude <path> --claude-sha256 <64 hex>` are both
required; there is no lookup on PATH. A path under `claude/versions/` or `.local/bin/claude(.exe)`
is refused. The hash is recomputed before every wire check. The output directory records the
binary (`binary.json`) and refuses any other on resume, and a directory of verdicts judged by
an unpinned CLI refuses a pinned run.

**4.5 Unchanged.** The 70 requests and their manifest hash; the judge model, effort and cap;
five passes, passes outer and requests inner; `score()` and its thresholds; the labels; the
reading rule (an Opus FAIL is decisive, an Opus PASS is an upper bound that counts only if
reproduced on a held-out set dated after 2026-06-30); the separation from the Sonnet arm; A1's
confound and A1's count of six.

## 5. What the wire check cannot see

A pass of the check is evidence about the request that was recorded, and about nothing wider.

1. **The checked process is not the judged process.** It has `ANTHROPIC_BASE_URL` set and the
   judged one does not. A CLI that builds its request differently for the real endpoint would
   pass the check and differ on the real call. Closing this would need TLS interception of a
   real call, which is a model call. It is not closed.
2. **Only the first request of a process is seen.** The recorder answers 400, so anything the
   CLI sends after a real answer is never recorded: a second turn, or a retry. This build
   contains a function that rebuilds a request with a lower `max_tokens`; when the CLI uses it
   was not established. 4.3 and `num_turns` bound this from one side only: they catch output
   above the cap, never a cap that was silently lower.
3. **It samples.** One request per pass and per resume, at most a few per run of 350 calls. A
   change that appears and disappears between two checks is not seen.
4. **Not rehearsed:** the recomputation of the hash before each check (no rehearsal changes
   the binary between two checks of one invocation), the 180-second hang guard, and a process
   that fails to start. The code is there; nothing in `test:ci` shows it working.

Items 1 and 2 apply equally to A1's recorder check and to the Sonnet arm, which ran with no
wire check at all during its 350 calls.

## 6. Comparability with the Sonnet arm, as measured on 2026-10-02

Three captures against the recorder, no model reached, the pinned build from the stable path,
request `0001`:

| | Opus arm settings | Sonnet arm settings (control) |
|---|---|---|
| `model` | `claude-opus-5-5` | `claude-sonnet-4-6` |
| `max_tokens` | 32000 | 32000 |
| thinking, effort | adaptive, high | adaptive, high |
| temperature | absent | absent |
| login | OAuth bearer, no `x-api-key` | OAuth bearer, no `x-api-key` |
| body keys | identical ten | identical ten |
| system blocks | 3, the third the request's prompt | 3, the third the request's prompt |
| messages | user (2 blocks), then a system-role message (1 block) | user (6 blocks) |
| beta flags | 11 | 8, a subset of the 11 |
| other requests | `HEAD /api/hello`, unauthenticated | the same |

The third capture is the judge's own `--wire-check-only` run with the command of section 8 and
a scratch output directory outside the repository: passed, and the baseline it wrote equals the
first column. The real output directory was not touched; its baseline is written by the first
check of the run itself. The neutral work root sits under Temp and was emptied with it; the
judge recreates it.

**This is A1's finding again, unchanged, and A2 does not remove it.** The three extra Opus
flags are the ones A1 named. Any difference between the arms is still read as model plus
message shape, never as model alone.

**Differences A2 adds or leaves, stated so they are not found later:**
- The Opus arm is guarded during the run by checks the Sonnet arm never had. The instruments
  are the same as far as measured; the evidence that they stayed the same is stronger for one
  arm than for the other.
- The Sonnet run's binary hash was not committed at run time (the pre-registration says so).
  That the two arms ran the same build rests on the version string for Sonnet and on the hash
  for Opus.
- The date in the context block is the run's date: 2026-09-29 for every Sonnet pass, the day of
  each call for Opus. If a rate limit spreads the Opus passes over several days, they see
  different dates.

## 7. Rehearsal, and each guard shown to fail when reverted

`test:proxy-judge-rehearsal` (in `test:ci`, no model, no outbound network: the recorder listens
on 127.0.0.1 and the stub is its only client; nothing asserts on time) gains sections G and H
and a changed F. The table below is from a loop that reverted one guard at a time in the
compiled output, ran the whole rehearsal, and restored it.

Unmutated, the rehearsal prints 89 PASS lines and no FAIL. 24 guards were reverted, one at a
time; every reverted build failed the rehearsal (exit 1), and the control run after the last
restore passed again, 89 of 89.

| guard reverted in the compiled output | assertions that failed | which (first three) |
|---|---|---|
| wire: cap not compared | 5 | a wrong cap (128000); a wrong cap on the wire; the shipped-model arm under another cap than its recorded 32000; and 2 more |
| wire: model not compared | 2 | a wrong model; a wrong model on the wire |
| wire: x-api-key ignored | 3 | an x-api-key header; an x-api-key header on another request of the process; an x-api-key header on the wire |
| wire: login class ignored | 3 | a bearer that is not an OAuth access token; no authorization |
| wire: thinking ignored | 3 | thinking that is not adaptive; no thinking |
| wire: effort ignored | 2 | another effort; another effort on the wire |
| wire: temperature ignored | 1 | a temperature |
| wire: tool list ignored | 1 | a second tool |
| wire: schema ignored | 1 | a changed schema |
| wire: system prompt ignored | 1 | a changed system prompt |
| wire: user message ignored | 1 | a changed user message |
| wire: request count ignored | 3 | two messages requests; no messages request; a process that sends no request |
| wire: path leak ignored | 1 | the repository path in the body |
| pin: updater path accepted | 1 | a path under the updater's versions folder, right hash |
| pin: missing hash accepted | 1 | --claude without --claude-sha256 |
| pin: hash not compared | 6 | a hash that is not the file's; a truncated hash; a path under the updater's versions folder, right hash; and 3 more |
| judge: OLD reported-cap comparison restored | 1, then the rehearsal aborts | the second arm stops on its first call with no verdict: the 2026-10-02 stop, reproduced |
| judge: output above the cap accepted | 1 | output above the cap |
| judge: no wire check at start or resume | 13 | a wrong cap on the wire; a wrong model on the wire; an x-api-key header on the wire; and 10 more |
| judge: no wire check before later passes | 4 | wire checks around the cut-off; wire checks in the dry run; the checked process against the judge call; and 1 more |
| judge: baseline not compared | 1 | resume under a changed shape |
| judge: another binary accepted in the directory | 1 | second binary in the same directory |
| judge: unpinned verdicts accepted | 1 | pinned run into unpinned verdicts |
| judge: --claude not required | 1 | no --claude and no --stub (no PATH lookup) |

Read with these limits. Seven of the wire guards (temperature, tool list, schema, system prompt, user
message, path leak, and the second request of two) are held by the function-level assertions
only; no through-the-judge case bends them. With the cap comparison reverted, a resume under a
wrong cap and a wrong cap before pass 2 were still stopped, by the baseline, and those two
assertions failed only on the reason printed: the baseline is a second net for the pinned
values, not only for the shape.

## 8. The command, from this commit on

From the repository root in PowerShell, with no API credential in the environment and usage
credits confirmed OFF by the owner:

```
npm run build
node dist/test/proxy-judge.js --requests "D:\RAGHAD JAD\Fixor-Final\forced-routing-mock-2026-09-29" --out "D:\RAGHAD JAD\Fixor-Final\proxy-judge-opus-arm" --passes 1 --claude "$env:USERPROFILE\.local\share\claude-pinned\2.1.284\claude.exe" --claude-sha256 0416631e846f743110da5282409776fa1313e65f33a588aae066eaf8db0fda7d --work-root "C:/Users/RAGHAD~1/AppData/Local/Temp/w" --judge-model claude-opus-5-5 --effort high --max-output-tokens 32000
```

Then the same command with `--passes 5`. Adding `--wire-check-only` runs the gates and the wire
check and judges nothing. Before pass 1, recheck the manifest hash over the 70 request files;
the judge checks the binary's hash itself.
