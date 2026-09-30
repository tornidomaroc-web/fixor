# Forced routing, PROXY judge, OPUS ARM: pre-registration, 2026-09-29. NOT RUN.

Written and committed before any Opus verdict on any case exists. The only call to an Opus model
made while preparing it was one trivial probe with no case content (below). Nothing in this file
may be changed after the first case request is sent; a change after that is an amendment, dated,
filed beside this file, and it binds only calls made after it is committed.

## The owner's question and decision

The shipped-model proxy run (`proxy-run-2026-09-29/`, tracker entry "PROXY RUN, 2026-09-29") is
PROXY-FAIL: held-out 1 of 10 on `claude-sonnet-4-6`, noise 2 of 30. The owner decided, before
any prompt revision, to put the same 70 requests to an Opus model as the judge, to learn whether
a stronger current model recognises these defects when handed the file. The design's failure
rules already said a different-model proxy is the owner's decision and must be labelled as such
(`proxy-judge-design-2026-09-28.md`, "Failure rules"); this is that decision, and this is that
label.

## The instrument: the Sonnet arm's, with three differences, all pinned

| | Sonnet arm (ran 2026-09-29) | Opus arm (this file) |
|---|---|---|
| requests | the 70 files in `forced-routing-mock-2026-09-29/calls/` | the same 70 files; sha256 over the sorted `sha256  name` lines of the 70 `*-request.json` files: `86f972a7eab005697edc5962666848ad80c9b50e7027f9ad6b29b86c70c7ef41`; newest file mtime 2026-09-29T00:14:31Z, before the Sonnet run started |
| CLI | Claude Code 2.1.284 (tracker) | 2.1.284, pinned by path `%USERPROFILE%\.local\share\claude\versions\2.1.284`, sha256 `0416631e846f743110da5282409776fa1313e65f33a588aae066eaf8db0fda7d`. The Sonnet run's hash was not committed; the pre-update copy the updater left beside `claude.exe` has the same sha256. The CLI on PATH is now 2.1.285 and is NOT used |
| judge model | the request's `claude-sonnet-4-6` | `claude-opus-5-5` via `--judge-model`; any other answering model stops the run with a mismatch file, never substituted |
| effort | not passed; the recorded request showed adaptive thinking at effort high | `--effort high`, passed explicitly, because the CLI's default effort can differ by model and the recorder check was not run for Opus (below) |
| output cap | not set; the recorded request carried 32,000 | `--max-output-tokens 32000` (sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS`); the probe reported 128,000 for Opus by default. Every result must report `maxOutputTokens` 32,000 or the run stops and writes no file |
| everything else | `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--no-session-persistence`, `--output-format json`, `--system-prompt`, `--json-schema`, whitelisted environment, neutral work root `C:/Users/RAGHAD~1/AppData/Local/Temp/w`, no API credential, five passes, passes outer and requests inner | identical; the shipped-arm argv produced by the judge after this change is byte-identical to the Sonnet run's recorded `argvTemplate` (checked) |

The judge change that adds the three flags, and its $0 rehearsal (section F of
`test:proxy-judge-rehearsal`, each new guard shown to fail with its fix reverted in the compiled
output), land in the same PR as this file.

**The probe, 2026-09-29, the only Opus call.** Same binary, same whitelisted environment, same
work root, `--model claude-opus-5-5 --effort high`, flags as above, with `--output-format
stream-json --verbose` so the init message is visible, a one-line arithmetic system prompt and
the question "What is two plus two?". Init: `model claude-opus-5-5`, `apiKeySource none`,
`claude_code_version 2.1.284`, tools `StructuredOutput` only, no MCP server. Result: success,
structured output `{"answer":"4"}`, `modelUsage` names `claude-opus-5-5` only, provider
firstParty, `maxOutputTokens` 128000, thinking tokens 0. `claude auth status` in the same
environment: logged in through claude.ai, subscription `max`. The CLI's cost field on that call
is its estimate at API list prices, not a charge.

**Not verified, stated before the run.** (1) The local-recorder check the Sonnet run had (one
process pointed at a local server that answered 400, to read the request on the wire) was not
run for Opus in this session. So the effective thinking configuration on the wire, and whether
`CLAUDE_CODE_MAX_OUTPUT_TOKENS` sets the wire `max_tokens` as well as the reported field, are
unverified; the reported field is checked on every call. If the owner approves that check, it
runs before pass 1 and its reading is filed as a dated note, not an amendment, provided it
changes nothing above. (2) The script cannot see whether extra usage is enabled; the owner
confirms usage credits OFF at claude.ai before pass 1. Opus draws down the subscription's limits
faster than Sonnet; a window that runs out stops the run and the same command resumes.

## Criteria: unchanged, and applied to this arm alone

`score()` in `src/test/lib/forced-routing.ts`, as for the Sonnet arm. A file hits when the
parent side emits (vulnerable at high or medium confidence) on at least 4 of 5 passes and the
fix side on at most 1 of 5; a case hits when any of its files hits. Held-out recall: PASS at 4
or more of 10, FAIL at 1 or fewer, INCONCLUSIVE at 2 or 3. Noise: TOO NOISY above 3 of 30 clean
flags. Fix-side flags and the Arm A diagnostic set are reported and count for nothing. No label
below five passes. Labels print as `PROXY-PASS | PROXY-FAIL | PROXY-INCONCLUSIVE [judge
claude-opus-5-5, not the shipped claude-sonnet-4-6]`.

**Never merged with the Sonnet figures.** Its own output directory (the judge refuses a
directory holding the other arm's verdicts), its own committed results directory
`proxy-run-opus-arm/`, its own tracker entry. A side-by-side per-case table may show both arms
as separately labelled columns. No pooled recall, no "either model" hit, no average across arms.
Each arm's clean-flags are read blind separately; the Sonnet arm's two are still owed.

## Reusing the held-out ten: sound for one question, not for the other

**Sound as a paired model comparison.** No prompt, schema, lane, request or scorer has changed
since the Sonnet run, and no Sonnet verdict was used to choose or tune anything. The ten are
therefore as unseen by any tuning as they were before. Using the same ten, byte for byte, holds
the items fixed so that only the model differs; a fresh set would confound the model with the
difficulty of a different ten cases at n = 10.

**Not sound as protection against memorisation, and this bears on a PASS only.** Every case's
defect is public: a fix commit, then a GitHub advisory. Claude Code states a June 2026 knowledge
cutoff for `claude-opus-5-5`; the Sonnet 4.6 cutoff is not established here and is not assumed.
Dates read from GitHub on 2026-09-29:

| case | fix commit | advisory published | public before the end of June 2026? |
|---|---|---|---|
| 01 | 2026-06-29 | 2026-09-22 | fix only, two days before; boundary |
| 02 | 2024-02-15 | 2025-06-10 | yes |
| 03 | 2026-03-05 | 2026-03-12 | yes |
| 04 | 2025-12-06 | 2025-12-15 | yes |
| 05 | 2026-02-19 | 2026-02-25 | yes |
| 06 | 2026-03-30 | 2026-04-01 | yes |
| 07 | 2026-07-06 | 2026-09-22 | no |
| 08 | 2026-06-26 | 2026-09-17 | fix only, four days before; boundary |
| 09 | 2026-03-01 | 2026-08-20 | fix yes, advisory no |
| 10 | 2024-08-01 | 2024-08-02 | yes |

Seven cases had both the fix and the advisory public before the cutoff; one (09) only the fix;
two (01, 08) only a fix days before it; one (07) nothing. A cutoff is not proof of exposure, and
the model is handed the vulnerable parent file, not the fix. But an Opus hit on an old case
cannot be told apart from recall of a public record.

**Reading rule, fixed now.** The per-case table reports each case's date class beside its
result.
- **Opus PROXY-FAIL is decisive in the direction it points.** Memorisation, the trigger-line
  hint and effort-high thinking all push toward flagging. If Opus still misses, no swap to the
  strongest model the owner can run at $0 rescues these detectors in their current form.
  (`claude-fable-5-1` is outside this: on this plan, past a usage threshold, `-p` mode bills
  usage credits without a prompt, so Fable is never run headless.)
- **Opus PROXY-PASS is an upper bound, never a basis for switching the production model on its
  own.** It becomes one only if it is reproduced on a held-out set drawn with both fix and
  advisory dated after 2026-06-30, frozen and committed before any Opus verdict on it. The third
  held-out set already owed before any prompt revision can be drawn under that date rule, so one
  frozen set serves both purposes. Hits concentrated in the pre-cutoff classes are reported as
  such.
- **Opus PROXY-INCONCLUSIVE:** reported as a count. No decision follows.

**What even a confirmed PASS does not settle.** The shipped detector sends temperature 0, 8,192
output tokens and no thinking; this proxy sends adaptive thinking at effort high. A production
Opus without thinking is not measured here, and measuring it is a paid API run, which the owner
has refused. The cost figure this arm can give is the CLI's list-price estimate summed over the
same 350 calls, thinking included, beside the Sonnet arm's $20.68 on the same basis: a ratio for
this proxy configuration, not a production cost model and not a charge.

**Author and judge share a model.** This file, the judge change and the probe were written by a
session running `claude-opus-5-5`, which has read the advisories and the Sonnet results. The
judge processes are blind by construction (rehearsal section E: argv, stdin, working directory
and environment carry nothing but the shipped prompt, schema and user message). A reader should
still know the two are the same model.

## The command

After this file is committed and pushed, the owner confirms usage credits OFF at claude.ai, then,
from the repository root in PowerShell with no API credential in the environment:

```
npm run build
node dist/test/proxy-judge.js --requests "D:\RAGHAD JAD\Fixor-Final\forced-routing-mock-2026-09-29" --out "D:\RAGHAD JAD\Fixor-Final\proxy-judge-opus-arm" --passes 1 --claude "$env:USERPROFILE\.local\share\claude\versions\2.1.284" --work-root "C:/Users/RAGHAD~1/AppData/Local/Temp/w" --judge-model claude-opus-5-5 --effort high --max-output-tokens 32000
```

Pass 1 alone, as in the Sonnet arm, proves the identity, the cap and the parser on real
requests; it prints PROXY-PRELIMINARY and applies no label. Then the same command with
`--passes 5` resumes to 350 calls. Exit 2 is a stop: an infrastructure stop resumes with the same
command; a model or cap mismatch does not, and goes to the owner. Before pass 1, recheck the
binary's sha256 and the request manifest hash above; a difference means this file no longer
describes the run.
