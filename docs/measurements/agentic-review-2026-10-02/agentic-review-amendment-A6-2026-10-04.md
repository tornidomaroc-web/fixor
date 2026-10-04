# Agentic change review, amendment A6, 2026-10-04. Committed before any case run.

Amends A1 section 3.5 (the tool set) by reference; the pre-registration and A1 to A5 are left
byte-identical. Found by the recorder check on merged `main` `aaa895e`, which reaches no model,
before the series was started. No judge run was made.

## 1. What the recorder check showed

The harness passed `--tools Read,Glob,Grep,LS,Task,Bash`, the set A1 3.5 names. The request the
pinned CLI (2.1.284, sha256 `0416631e…da7d`) built carried the tools **Agent, Bash, Glob, Grep,
Read**. Everything else on the wire was as pinned: the harness prompt, equal to the CLI's own
`/security-review` expansion; `claude-opus-5-5`; `max_tokens` 32000; adaptive thinking; effort
high; OAuth bearer; no `x-api-key`.

So in this CLI the sub-agent tool A1 calls `Task` is named `Agent`, and there is no `LS` tool. The
harness's audit enforced A1's names, and the harness recorded the wire's list without comparing it
with the audited one. The first `Agent` call, which the built-in's own text invites, would have
voided the series, and a void is final.

## 2. The rule that binds

- The tool set offered and audited is **Read, Glob, Grep, Agent, Bash**, with Bash limited to the
  same five git reads as before. `Agent` is A1's `Task` under the CLI's name; dropping `LS` removes
  nothing the CLI offers. No network or write tool is added.
- The harness refuses to start when the tool list recorded by the recorder check is not exactly
  the audited set. A call to any tool outside the set, including one named `Task`, still voids the
  series.
- A1 3.5's visibility limit is unchanged: whether tool calls made inside a sub-agent reach the
  parent's stream is established only by the first real run.

Implemented in `80dc350`; the rehearsal (100 checks) shows the refusal of the pre-A6 list, an
`Agent` call completing, and a `Task` call voiding. The recorder check on the implementing build
recorded Agent, Bash, Glob, Grep, Read, equal to the audited set.

## 3. Nothing else changes
