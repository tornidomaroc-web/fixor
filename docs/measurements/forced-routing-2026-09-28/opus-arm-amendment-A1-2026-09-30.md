# Opus arm, amendment A1, 2026-09-30. Filed before any case request reached any model.

Amends `opus-arm-prereg-2026-09-29.md` by reference; that file is left byte-identical. Approved
by the owner on 2026-09-30. It binds the whole Opus arm, because no case request has been sent.

## Source: the local-recorder check, 2026-09-30

Two judge processes were started with the judge's own compiled `judgeArgv` and `scrubbedEnv`,
the pinned CLI 2.1.284 and the neutral work root, for request `0001`. The only addition was
`ANTHROPIC_BASE_URL`, pointed at a local server that recorded the request and answered 400, so
no model was reached. One process used the Opus arm's settings
(`--judge-model claude-opus-5-5 --effort high --max-output-tokens 32000`); the other used the
Sonnet arm's settings (no arm flags), as a control captured the same day with the same binary.
The Authorization value was never written, only its scheme and whether it had the OAuth access
token prefix. Each process also sent one unauthenticated `HEAD /api/hello` before the messages
request.

## 1. Where the non-case context sits differs by model. It is a confound declared in advance.

Both requests carry the same non-case context apart from each model's own identity line (model
name, id and self-stated knowledge cutoff). It is the working-directory environment, the
identity line, a token budget, the account's email reminder and the date. The CLI places it
differently:

- **Sonnet arm:** one user message holding six blocks. Five `<system-reminder>` blocks (the
  environment, the identity line, the token budget, the email reminder, the date) come first,
  then the case.
- **Opus arm:** a user message holding two blocks, the email reminder and then the case,
  followed by a second message with role `system`. That message carries the environment, the
  identity line, the token budget and the date as one block, without `<system-reminder>`
  wrappers. So the email reminder still comes before the case; the other four come after it.
  The email block differs from the Sonnet arm's by one trailing newline, and the 1-hour cache
  marker sits on the trailing system message rather than on the case block.

The date is each run's own date. The Sonnet arm's five passes saw 2026-09-29; both captures above
show 2026-09-30.

No flag of CLI 2.1.284 controls this placement. The one candidate,
`--exclude-dynamic-system-prompt-sections`, is ignored with `--system-prompt`. Making the shape
equal would need the raw API, which the owner has refused. **Any difference between the arms is
therefore read as model plus message shape, never as model alone.** The block carries no case
label, advisory or path, so its effect is expected to be small, but it is not measured.

**Three request beta flags are sent for Opus and not for Sonnet:**
`mid-conversation-system-2026-04-07`, `per-turn-control-2026-07-01` and
`mid-conversation-tool-changes-2026-07-01`. The Sonnet arm sends no flag that Opus lacks.

## 2. What the capture confirmed, closing the pre-registration's "Not verified" item

For both arms:
- **Output cap and sampling:** `max_tokens` is 32000 in the request body itself, and no
  temperature is sent.
- **Thinking and effort:** `thinking` is `{"type":"adaptive","display":"omitted"}` and
  `output_config` is `{"effort":"high"}`.
- **Tools:** `StructuredOutput` is the only tool.
- **Authorisation:** a Bearer token with the OAuth access-token prefix, and no `x-api-key`
  header.
- **Nothing extra attached:** none of `CLAUDE.md`, `papercuts`, `cloudflared`, `skill`, `MCP`,
  `mcp__`, `settings.json`, `Fixor`, `.claude` or the user-profile path occurs in either body.
- **Case content:** the shipped system prompt, the user message and the tool's input schema are
  byte-identical to the request file, and identical between the two arms.

The cap check in the pre-registration was reported-field only. It is now also confirmed on the
wire, and the per-call reported-cap stop stays in force.

## 3. Cutoffs: a Sonnet column, and a count corrected

The Sonnet capture's identity line gives a self-stated knowledge cutoff of **August 2025** for
`claude-sonnet-4-6`. Applied to the pre-registration's date table:

| case | fix commit | advisory | fully public before Sonnet's cutoff (end of Aug 2025) | fully public before Opus's cutoff (end of Jun 2026) |
|---|---|---|---|---|
| 01 | 2026-06-29 | 2026-09-22 | no | no (fix only, boundary) |
| 02 | 2024-02-15 | 2025-06-10 | **yes** | **yes** |
| 03 | 2026-03-05 | 2026-03-12 | no | **yes** |
| 04 | 2025-12-06 | 2025-12-15 | no | **yes** |
| 05 | 2026-02-19 | 2026-02-25 | no | **yes** |
| 06 | 2026-03-30 | 2026-04-01 | no | **yes** |
| 07 | 2026-07-06 | 2026-09-22 | no | no |
| 08 | 2026-06-26 | 2026-09-17 | no | no (fix only, boundary) |
| 09 | 2026-03-01 | 2026-08-20 | no | no (fix only) |
| 10 | 2024-08-01 | 2024-08-02 | **yes** | **yes** |

**2 of 10 cases fully public for Sonnet, against 6 of 10 for Opus.** The pre-registration and
the tracker entry filed with it say "seven". That is a counting error: the pre-registration's
own table has six rows where both dates fall before the end of June 2026. Its prose breakdown
("seven ... one ... two ... one") sums to eleven for ten cases. The table's dates
are unchanged, and the pre-registration is not edited; this count supersedes "seven" wherever
it appears. The reading rule is unchanged: an Opus PASS is an upper bound, and hits are
reported by date class.

## 4. Unchanged

The criteria, the labels, the separation from the Sonnet arm, the pins (CLI sha256, request
manifest hash, judge model, effort, cap), and the command in the pre-registration all stand
as written.
