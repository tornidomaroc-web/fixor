# Agentic change review, amendment A1, 2026-10-03. Committed before any tooling and before any run.

Amends `agentic-review-prereg-2026-10-02.md` by reference; that file is left byte-identical. Approved
in outline by the owner on 2026-10-03 (the case set and Gate A); the additions under section 3 were
found while reading the pre-registration against the tooling it needs, and are fixed here before
the tooling exists. Nothing here may change after the first case run starts.

## 1. The case set, fixed

**Primary set: the held-out ten** (`detector-reach-2026-09-27/held-out-corpus-manifest-2026-09-27.tsv`;
anchor lines from `forced-routing-2026-09-28/anchors-2026-09-28.tsv`, parent side). Each case's
defect files, fix commit and vulnerable parent are as frozen there. Per the pre-registration: six of
the ten had fix and advisory public before the judge model's stated cutoff, so a pass on this set is
an upper bound, and the result is reported by date class (A1 of the Opus arm has the table).

**Post-cutoff column: the four sound cases of the third held-out set, batch 1**
(`held-out-3-2026-10-03/manifest-batch1-2026-10-03.tsv`): cases 01 AFFiNE, 02 immich, 03
Rocket.Chat, 04 spacebar server. They are reported as a separate column and never pooled with the
ten. **Cases 05 (icehrm) and 06 (clawhub) are excluded.** The reason was recorded in
`batch1-2026-10-03.md` before any run: the advisory's cited fix commit does not hold the advisory's
defect (05's defect is in a PHP file the advisory names; 06's cited commit is a different security
fix). They stay in the frozen batch; this measurement does not use them.

**Anchor lines for the batch-1 cases.** The forced-routing anchors do not cover them. For each
defect file, the anchor is the old-side start line of the fix diff's first hunk in that file
(`git diff <parent> <fix> -- <path>`, the `-a` of the first `@@ -a,b +c,d @@`). It is computed by the
preparation script and recorded in the prepared manifest before any run.

**Blame on multi-file cases.** The pre-registration finds one introducing commit per defect file.
A case has one prepared repository, so the case's introducing commit `I` is that of its FIRST defect
file in manifest order. Every defect file that exists in `I`'s tree, with an anchor line that blame
attributes to `I` or earlier, gets a defect window; a defect file absent at `I` is recorded and gets
none. A case is accepted when its first file's anchor line is added by `I`'s own diff, as the
pre-registration says; the other files' blame results are recorded for the reading.

## 2. Gate A, exactly

Gate A is read on the primary set only, after all five runs of every state are complete and nobody
has read a finding.

**Precondition:** at least 8 of the 10 held-out cases are accepted by the blame rule. Below 8 the
run does not happen and the reason is reported.

**Continue only if BOTH hold:**
- **4 or more case hits** (a case hit is as pre-registered: a run hit on at least 4 of 5
  vulnerable-state runs and on at most 1 of 5 fix-side runs), **and**
- **at most 3 of the 10 clean changes flagged** (a clean change is flagged when any finding appears
  on at least 4 of 5 runs).

**Anything else stops the agentic path, including 2 or 3 hits.** No re-prompting, no second
configuration, no "near miss". **Detection R&D on Fixor stops on the day Gate A fails.** The
post-cutoff column is reported beside the gate and does not move it in either direction.

## 3. Found while reading the pre-registration against the tooling; fixed before any run

**3.1 A case without a fix-side control cannot count toward Gate A.** The pre-registration lets a
case whose fix patch does not apply to `I`'s tree count on the vulnerable side alone. A reviewer that
flags every newly added handler as "missing authorization" would then score a hit on every such
case. Under this amendment, a case with no fix-side state is reported, marked, and **counts as a
miss for Gate A**. The fix-side control is what separates detection from flagging.

**3.2 The clean changes must be handler-shaped.** The pre-registration draws each clean change as
the newest commit touching the drawn file. Many such commits are refactors or documentation; a
reviewer that only ever flags route handlers would be silent on them and pass the noise test
without being tested. Under this amendment the clean change for each drawn file is the **newest
non-merge commit before 2026-09-28 that modifies the drawn file, touches 1 to 10 non-test JS/TS
files, and whose diff adds or changes at least one line in the drawn file matching the route-shape
pattern** `/\b(router|app|server|fastify|express)\.(get|post|put|patch|delete|all|use)\s*\(|@(Get|Post|Put|Patch|Delete|All)\s*\(|\b(publicProcedure|protectedProcedure|procedure)\b|export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/`.
If no commit in the file's history matches, the newest non-merge commit modifying the file is
taken and the row is marked "no route-shaped change found". The drawn files are the first ten
auth-bypass rows of `forced-routing-2026-09-28/clean-draw-2026-09-28.tsv`, in draw order.

**3.3 The defect window, concretely.** "The line range of the function or handler enclosing the
anchor line, computed by a parser" is implemented as a brace-depth scan over the file at `I`:
starting from the anchor line (its line number at `I`, as blame reports it), the nearest enclosing
`{ ... }` block whose opening line looks like a function, method, arrow function or route
registration, extended by 3 lines on each side. If no such block encloses the line (a top-level
statement), the window is the anchor line plus and minus 10 lines. The window's two numbers are in
the prepared manifest; a finding's line must fall inside them.

**3.4 The prompt is the built-in's text, and it differs from the published file in two places
only.** Extracted from the pinned binary (sha256 `0416631e…da7d`) and compared line by line with
`anthropics/claude-code-security-review` at `0c6a49f`: the built-in's diff expansion is
`git diff origin/HEAD...` where the published file has `git diff --merge-base origin/HEAD`, and
three lines differ by trailing whitespace. Nothing else. The harness sends the built-in's body
(after its frontmatter) with its four `!` commands expanded in the prepared repository. The text
is committed beside this file as `builtin-security-review-2.1.284.md` with its sha256 pinned in the
harness; it is Anthropic's, under the MIT licence of the published repository.

**3.5 What the tool-call audit can and cannot see.** The void rule applies to every `tool_use`
block in the process's stream-json output. Whether the CLI streams the tool calls made inside
sub-tasks (`Task`) through the parent's output is not established here and needs a model call to
establish; the first real run reports it. Until then the audit is known to cover the parent agent
and is not claimed to cover sub-tasks. The tool SET offered to every agent and sub-agent is
restricted at the CLI (`--tools`) to `Read, Glob, Grep, LS, Task, Bash`, with Bash permitted only for
`git diff`, `git status`, `git log`, `git show` and `git remote show`, as the built-in declares; no
network tool exists in the process, so a sub-task cannot reach the network whether or not its
calls are visible.

**3.6 Blindness is also checked on the repository, not only on the process.** Before any run, the
harness verifies for every prepared repository: exactly two commits reachable from the work branch
and one from `origin/HEAD`; every commit's author, committer, message and dates equal the neutral
values; no remote URL other than the local bare origin; the working tree clean. After every run it
verifies the tree is unchanged and no file was added.

**3.7 Blindness of the drawing session.** The person who prepared the cases knows every case's
advisory, anchor and fix. The judge processes carry none of that: the pre-registration's list, plus
the checks in 3.6. The prepared repositories are named by random tokens that reveal nothing; the
token-to-case map lives in the prepared manifest, which the judge process never receives.

## 4. What this amendment does not change

The hit rule's three conditions (file, window, access-control category), five runs per state with
states outer and runs inner, the stop conditions, the model and effort pins, the wire check, the
memorisation reading rule, the $0 instrument, and the rule that a pass counts toward adopting the
approach only from a post-cutoff set.
