# Agentic change review, held-out ten: design and pre-registration, 2026-10-02. NOT RUN, NOT BUILT.

Committed before any tooling for it exists and before any agentic review of any case. Nothing
here may change after the first case run starts; a change after that is a dated amendment that
binds only later runs.

## The owner's hypothesis, and what already bears on it

**Hypothesis.** Fixor's single-file lanes miss real access-control defects because the evidence
spans several files. A reviewer that reads the change inside its whole repository would find
them.

**What the record already says, before any agentic run.**
- 7 of 10 fix commits change a single non-test source file, the one the lanes were given: the
  forced-routing proxy handed the model that file whole. Read from the fix commits on GitHub on
  2026-10-02: cases 01, 03, 09 and 10 change exactly one file; 05, 06 and 07 change one source
  file and one test file; 02 changes three source files; 04 changes four source files, of which
  the corpus kept three, plus one test file; 08 changes two source files and a translation file
  plus two test files. (Corrected 2026-10-02 before any run: this line
  first read "7 of the 10 held-out fixes change a single file", counted from the corpus manifest,
  which is literally false for 05, 06 and 07.) On the shipped model the
  proxy flagged 1 of 10 (`proxy-run-2026-09-29/`). For those seven, the defect was correctable
  inside the file the model already had. That does not prove the evidence for SEEING the defect
  was local: whether a route needs a guard can depend on middleware or roles declared
  elsewhere. But it means "the model never saw the relevant file" is not the explanation for at
  least seven misses.
- So the test below asks a narrower question than the hypothesis: does a reviewer with
  repository access and an agent loop flag these defects where the single-file lanes did not?
  If it does, cross-file evidence is one possible reason among several (more context, a
  different prompt, an agent loop, a different input: the change instead of the file).

## What the two Anthropic tools actually do (read from source on 2026-10-02)

Source: `anthropics/claude-code-security-review`, commit
`0c6a49f1fa56a1d472575da86a94dbc1edb78eda`, licence **MIT** (copyright 2025 Anthropic).

**The GitHub Action** (`claudecode/github_action_audit.py`, `claudecode/prompts.py`):
- Runs `claude --output-format json --model <model> --disallowed-tools "Bash(ps:*)"` with the
  prompt on stdin and the PR's checkout as the working directory. That is its only tool flag;
  which tools a headless run may then use depends on the CLI's permission defaults, which were
  not established here. Default model `claude-opus-4-1-20250805`; timeout 20 minutes; three
  attempts in total (`range(3)`).
- The prompt carries the PR number, title, author, the repository's full name, the changed
  files and the unified diff, and says: "focus ONLY on security implications newly added by
  this PR. Do not comment on existing security concerns."
- Findings then pass a filter: deterministic hard-exclusion rules, then a second Claude call
  through the Anthropic API.
- **Requires an API key** (`claude-api-key`, "needs to be enabled for both the Claude API and
  Claude Code usage"). Its README states it "is not hardened against prompt injection attacks
  and should only be used to review trusted PRs".

**The `/security-review` command** (`.claude/commands/security-review.md` in the repository;
a version is built into Claude Code). The published file is described below. The built-in in
the pinned CLI 2.1.284 differs from it in two ways, read from the binary on 2026-10-02: 117 of
the published file's 119 lines of 25 or more characters occur in the binary verbatim; the
other two are (1) the diff expansion, which the built-in runs as `git diff origin/HEAD...`
(committed changes since the merge base) instead of `git diff --merge-base origin/HEAD`
(which also includes uncommitted changes), and (2) the `allowed-tools` line, which the built-in
fills from a variable at run time, so its list cannot be read from the binary. In the prepared
repositories below everything is committed, so the two diff commands give the same diff.
- Allowed tools: `Bash(git diff:*)`, `Bash(git status:*)`, `Bash(git log:*)`, `Bash(git show:*)`,
  `Bash(git remote show:*)`, `Read`, `Glob`, `Grep`, `LS`, `Task`.
- Expands `git status`, `git diff --name-only origin/HEAD...`, `git log --no-decorate
  origin/HEAD...` and `git diff --merge-base origin/HEAD` into the prompt; same objective and
  "newly added" restriction as the Action; three phases (repository context, comparison,
  assessment); then one sub-task finds, one sub-task per finding filters false positives, and
  findings below confidence 8 are dropped. Output: markdown, one `# Vuln N: <category>:
  \`file:line\`` block per finding.
- Runs on the subscription login. **This is the only one of the two that can be tested at $0.**

**The consequence for the design.** Both tools review a CHANGE and are told to ignore what was
already there. Handing them the parent of the fix, which is what the single-file lanes got, is
not how either is used, and its prompt would tell it to report nothing pre-existing. The
faithful input is the change that INTRODUCED the defect, reviewed as a pull request in its
repository. That also matches Fixor's own product, which reviews pull requests.

## The instrument

The `/security-review` command, run headless on the pinned CLI, the owner's subscription, no
API credential anywhere (the proxy judge's `credentialGate`, `settingsGate` and `scrubbedEnv`,
reused).

- **Executable:** CLI 2.1.284 by sha256 `0416631e846f743110da5282409776fa1313e65f33a588aae066eaf8db0fda7d`
  at the stable path of amendment A2.
- **Prompt:** the BUILT-IN command's text, as the pinned CLI holds it, not the published
  file's. Its `!` git commands are expanded by the harness in the prepared repository (below)
  and the result is sent on stdin. Before any case run, a recorder check (A2's mechanism, no
  model reached) must show that this prompt reaches the wire byte-identical to what the CLI
  sends for `/security-review` typed in the same repository. If it does not, the harness sends
  `/security-review` itself and this line is amended before any case run.
- **Tool list:** the built-in's allowed-tools list, as the same recorder check shows it on the
  wire, is recorded and committed before any run, and the harness passes exactly that list. No
  case run starts until it is recorded.
- **Flags:** `-p --model claude-opus-5-5 --effort high --output-format stream-json --verbose
  --allowedTools <the built-in's list, as recorded> --disallowedTools "WebFetch,WebSearch,Write,Edit,NotebookEdit"
  --strict-mcp-config --setting-sources "" --no-session-persistence`.
- **Environment:** the scrubbed whitelist, plus `CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-5-5`
  (so the sub-tasks run on the pinned model) and `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`.
- **Wire check** before the first run of every repository state and of every resume, as in A2,
  with the same stated limits: it sees only a process's first request, and an agent run makes
  many.
- **Model:** `claude-opus-5-5`. Not the shipped `claude-sonnet-4-6`: the question is whether the
  approach works with the strongest model the owner can run at $0. `claude-fable-5-1` is
  excluded, as in the Opus arm (it bills usage credits in `-p` mode past a threshold).

**Deliberate deviations from both tools, each stated:** no PR title, author or repository name
(the Action sends them; the command does not); commit messages, authors and dates neutralised
(the command shows `git log`); no second-stage API filter (the Action's is paid; the command's
own sub-task filter stays). Each removes information or a filter. Removing information can only
lower recall; removing the Action's filter can only raise both hits and false positives.

## The cases, frozen before any run

Starting set: the held-out ten (`held-out-corpus-2026-09-27`, manifests in
`docs/measurements/forced-routing-2026-09-28/`). For each defect file, from the fix commit's
parent `P` and the anchor line `a` already committed for forced routing:

1. **Introducing commit `I`:** the commit `git blame -w -M -C --porcelain -L a,a P -- <path>`
   attributes the anchor line to.
2. **Accepted** only if `I`'s own diff adds the anchor line. Otherwise the case is
   INTRODUCTION-AMBIGUOUS: excluded from the denominator and reported by name. No hand search
   for a better commit.
3. **Defect window:** the line range of the function or handler enclosing the anchor line in
   `I`'s tree, computed by a parser and committed as numbers.
4. **Gate:** if fewer than 8 of the 10 cases are accepted, the held-out-ten run does not happen.

**Repository states,** built outside the repository by a script committed with this design:
- **Vulnerable:** a fresh repository with no history from the project. Commit 1 is `I^`'s tree,
  commit 2 is `I`'s tree, both with the message "change", author `contributor
  <contributor@example.invalid>`, date 2000-01-01T00:00:00Z. `origin` is a local bare
  repository at a neutral path, `origin/HEAD` points at commit 1, and the work branch is at
  commit 2. The working directory is a random neutral name under the A2 work root.
- **Fix-side control:** the same, with commit 2's tree replaced by `I`'s tree plus the fix
  commit's patch for the defect files (`git apply --3way`). If the patch does not apply
  cleanly, that case has no fix-side control and is reported so.
- **Clean controls:** 10 changes, one per repository of the clean draw's first ten auth-bypass
  rows (`clean-draw-2026-09-28.tsv`, order as drawn). Each is the newest commit before
  2026-09-28 that touches the drawn file. They are built the same way and have no known
  advisory. A flag on them is unverified, never a confirmed false positive.

The manifest (case, `I`, `I^`, fix patch hash, window, tree hashes of every state) is
committed before the first run. No third-party source is committed.

## Blindness

**What cannot be hidden.** The project's identity. Package names, imports, the README and
version numbers are in the code; removing them changes the code under review. A model that
knows the project, its versions and its advisories can recognise the code. That is
memorisation (below), not a leak to fix.

**What is withheld:** the case label, the advisory, the fix, the anchor, the existence of a fix,
the real history, commit messages, authors and dates, the real remote, and the fact that the
change is known to be vulnerable. The fix-side and clean states look identical in form.

**How the withholding is enforced:**
- no history beyond `I^` exists in the prepared repository;
- network tools are not allowed. Any tool call outside the allowed list, in the main agent or
  any sub-task, read from the stream-json transcript, voids the run and stops the series;
- the working directory and the bare origin carry neutral names; the harness refuses a path
  matching the proxy judge's `WORK_ROOT_FORBIDDEN`;
- transcripts are kept outside the repository. The scorer is mechanical, and nobody reads a
  finding before every run of the series is complete.

## Scoring

A run's findings are the `# Vuln N` blocks in its final markdown, parsed mechanically.

- **Run hit:** at least one finding whose path equals the defect file, whose line falls inside
  the defect window, and whose category or description matches
  `/auth|authori[sz]|access.?control|permission|privilege|idor|insecure direct|ownership|tenant|bypass/i`.
- **Case hit:** a run hit on at least 4 of 5 vulnerable-state runs, and on at most 1 of 5
  fix-side runs where a fix-side state exists. A case with no fix-side state counts on the
  vulnerable side alone and is marked.
- **Label** over the accepted cases: AGENTIC-PASS at 4 or more case hits, AGENTIC-FAIL at 1 or
  fewer, AGENTIC-INCONCLUSIVE at 2 or 3. No label below five runs per state.
- **Noise:** a clean change flagged with any finding on at least 4 of 5 runs is a clean flag.
  TOO NOISY above 3 of 10. All findings per run are also reported by category, so noise outside
  access control is visible.
- **Reported, counting for nothing:** findings in the defect file outside the window, and the
  per-run finding count.

**Comparison with the single-file arms:** a per-case table beside the Sonnet arm and the Opus
arm, each column labelled separately. The inputs differ (the introducing change in its
repository against the fix's parent file), so a difference is read as approach, input, prompt
and model together, never as cross-file evidence alone.

## Repeats and stop conditions

Five runs per repository state, with states outer and runs inner, as in the proxy judge.

Stop conditions:
- a model other than `claude-opus-5-5` in any result's `modelUsage`, sub-tasks included;
- a failed wire check or binary hash;
- any credential in the environment;
- any tool call outside the allowed list (the run is void and the series stops);
- output above the cap.

A rate limit, a hang (a 30-minute wall-clock guard) or an infrastructure failure stops the run,
and the same command resumes. No run is re-prompted after its findings exist.

## Memorisation, and which set the result must come from

`claude-opus-5-5` states a June 2026 cutoff. Six of the held-out ten had fix and advisory both
public before it (A1's count). An agent sees more than the single-file lanes did: package
versions, changelogs, the surrounding project. So it has more cues for recalling a published
advisory.

- **On the held-out ten, an AGENTIC-PASS is an upper bound and cannot support adopting the
  approach.** Hits are reported by date class.
- **An AGENTIC-FAIL on the held-out ten is decisive in its direction:** recall, context and
  effort-high thinking all push toward flagging, and they would not have been enough.
- **For a pass to count, the result must come from the third held-out set,** with fix and
  advisory both dated after 2026-06-30, frozen and committed before any run on it. **That set
  should be built first.** It is already owed before any prompt revision, and one frozen set
  can serve the agentic test, the Opus arm's reproduction and the stage-2 prompt test. Running
  the held-out ten first buys only the FAIL direction.
- Even post-cutoff cases can sit on code that was public before the cutoff. A late advisory
  protects against recall of the finding, not of the code.

## What is needed before any run

1. The owner approves this design.
2. The case-preparation script, the harness and the scorer are built and rehearsed at $0 with a
   stub (no model): blindness of what the process receives, the tool-call voiding, the scorer
   on hand-built transcripts, and each guard shown to fail when reverted.
3. The recorder checks: the prompt-equivalence check above, the built-in's tool list recorded
   from it and committed, and the wire check.
4. The case manifest is frozen and committed.
5. Preferably, the third held-out set is drawn and frozen first.

Subscription only, no API call, no key.
