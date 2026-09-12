# Landing page audit against what main can prove, 2026-09-12

Scope: `landing/index.html` line by line (visible copy, head metadata, structured data), plus
the claim-bearing lines of `landing/security.html` and the blog post. Pricing tiers out of
scope by the owner's instruction. Design, layout and CSS untouched. This is the audit; no
rewrite is in this commit.

Where the page lives: `landing/` is INSIDE this repository, eight tracked files
(`index.html`, `security.html`, `privacy.html`, `terms.html`, the blog post, `CNAME`,
`.nojekyll`, `.well-known/security.txt`), served from GitHub Pages. Every edit to it goes
through the same branch, pull request, gitleaks whole-tree scan, build checks and
three-condition merge gate as a detector change. That is the right shape: the page is a
claims surface and `docs/detector-capabilities.md` already says public surfaces may not
claim beyond it.

What main can prove, in one place (all measured 2026-09-12 unless dated otherwise):
- secrets-exposure: the licensed sentence in `docs/measurements/fix-pairs-2026-09-11/HANDOFF.md`
  (shape coverage 5 of 208 gitleaks default rules outright and 2 in part, 7 Fixor-only
  shapes; false alarms 15 of 15 wrong on 65,566 mature files and 2 of 5 wrong with 3 real
  keys on 4,772 ICP files; fixture catch 16 of 16 positives, 0 of 19 negatives; the skip-path
  miss class). No catch number on real code beyond the three ICP keys found.
- the other five detectors: fixture baselines only (`docs/detector-capabilities.md`), no
  false-alarm number and no catch number on real code; fix-pair records: admin-check 2
  commits, idor 3, auth-bypass 3, webhook 3 (case list), env-exposure 0.
- which detectors reach the model (`registry.ts`, the six detector files): auth-bypass, idor,
  env-exposure and webhook-unverified send every surviving candidate to Claude; admin-check
  sends every candidate except its three literal-tier patterns (`default_admin_email`,
  `default_admin_id`, `role_fallback_admin`), which emit without a model call;
  secrets-exposure never calls a model on its shipped path.
- the PR comment format (`src/integrations/github/comment-builder.ts`): the "Detection
  confidence" line prints each finding's `confidence` field; on the secrets bypass and on
  admin-check's literal tier that field is the constant `"high"`, not a judgment.
- features that exist: the PDF report (`src/services/pdf-report.service.ts`), the risk
  explainer (`src/services/risk-explainer.ts`), the GitHub App installation path.

## index.html, line by line

| # | what it says | what we can prove | the gap and the remedy shape |
|---|---|---|---|
| 1 | `<title>` "Automated security analysis for GitHub PRs" | The app analyses PRs automatically. | None. Keep. |
| 2 | meta / og / twitter description: "Detects 6 business-logic vulnerability classes in Node/TypeScript: auth bypass, missing admin gates, IDOR, environment-variable exposure, hardcoded secrets, and unverified webhooks." (appears four times, plus the structured-data description and hero subhead) | Six detectors ship. Each has a fixture baseline. Only secrets has real-code numbers; "hardcoded secrets" is measured as sixteen shapes, not the class. | NARROWING. "Detects" asserts a capability on real code that five rows cannot back and the sixth backs only for named shapes. Say what it does: "Checks every pull request for six classes of business-logic vulnerability in Node/TypeScript ...". Same edit in all six places. |
| 3 | og:title / twitter:title "Security analysis for every GitHub PR" | The app runs on every PR it is installed on, within plan limits. | None material. Keep. |
| 4 | Hero: "Catch security bugs before they ship." | No catch number exists for any detector on real code. The only real catches on the record are three API keys in one ICP repository, found by the secrets check, with no miss denominator. | DELETION of the promise. Replace with what is measured or with a scope statement ("Six business-logic checks on every pull request"). A catch claim needs the fix-pair numbers, which do not exist yet. |
| 5 | Hero subhead (same text as #2) | as #2 | as #2 |
| 6 | "Free tier covers 5 scans / month on public repos · no card required" | Pricing. | Out of scope. |
| 7 | "How it works. Three steps from push to an actionable security review, right in the thread your team already uses." | Three steps is the mechanism. "Actionable" is an adjective. | Narrow "actionable security review" to "security report". Minor. |
| 8 | Step 02 "Fixor detects" + the six-class sentence | as #2 | as #2 ("Fixor checks"). |
| 9 | Step 03 "A professional report lands on the PR: findings, remediation steps, risk assessment, and a downloadable PDF for compliance." | Findings, remediation text, the risk explainer and the PDF exist. "Professional" is an adjective; "for compliance" asserts fitness for a purpose nobody measured or reviewed. | NARROWING. "A report lands on the PR: findings, remediation steps, a risk summary, and a downloadable PDF." Drop "professional" and "for compliance". |
| 10 | "What lands on your PR. A clean, structured security report ... Every finding comes with a precise explanation and remediation steps, so you can act on it fast." | Every finding carries an explanation and remediation text (hand-authored for secrets and admin-check's literal tier; model-written elsewhere). "Precise" and "clean" are adjectives. | Narrow "precise explanation" to "an explanation". Minor. |
| 11 | "A high-signal second reviewer, not a replacement for human review." | "High-signal" is an accuracy claim with no number behind it. The measured number that exists contradicts it for the mature corpus (15 of 15 secrets flags wrong) and supports it for the ICP corpus (3 real of 5). | NUMBER BESIDE IT, or deletion. Replace the adjective with the measured sentence in the numbers section (#19) and keep "not a replacement for human review", which is true and is the sentence's honest half. |
| 12 | Sample PR comment: "Findings 5 / Detection confidence high: 5" | The format is real (comment-builder prints `confidence`). The sample is illustrative: five findings, five detectors, fixture-shaped paths, all "high". For SECRETS_EXPOSURE the field is a constant, never a judgment; for ADMIN_CHECK it is a constant on three patterns. | NARROWING with a number beside it. Either drop the "Detection confidence" row from the sample, or keep it and mark the secrets row "pattern match, no model judgment" as the product should. The sample must not show a measured-looking confidence for a path that has none. |
| 13 | Sample rows 1 to 5 (`AUTH_BYPASS`, `IDOR`, `ADMIN_CHECK`, `ENV_EXPOSURE`, `SECRETS_EXPOSURE`, all **high**) | Five detector ids exist; a sample is allowed to be a sample. Four of five findings would be model-judged; the fifth is a regex hit shown as if judged. | As #12. Also label the block "illustrative sample" so it is not read as a real scan. |
| 14 | "_Professional report suitable for sharing with your team or compliance review._" | Appears verbatim in the comment builder, so the product says it too. Fitness for compliance review is unmeasured. | NARROWING in the product and on the page together: "Report suitable for sharing with your team." The compliance clause has nothing behind it. |
| 15 | "🔒 Analyzed by Fixor · 2026-04-19T00:03:31Z" | Timestamp of a sample. | Mark as sample (with #13). |
| 16 | "Built for production teams. More than a scanner, Fixor ships everything your team needs to act fast." | "Everything your team needs" is unbounded. | Narrow to what ships: report, PDF, GitHub App. Minor. |
| 17 | "Claude-powered analysis. Backed by Claude: context-aware analysis, not just regex pattern-matching. Five of the six detectors judge each candidate with Claude reading the diff the way a reviewer would; the hardcoded-secrets detector runs on high-precision patterns." | Four detectors judge every candidate with Claude. Admin-check judges every candidate except three literal-tier patterns, which emit on the regex alone. Secrets never calls a model. "High-precision patterns" is contradicted on the mature corpus (15 flags, 15 wrong) and is at best "2 wrong of 5" on customer-shaped code. | CORRECTION of the owner's reading: the sentence is the nearest-true on the page but not true as written; admin-check's literal tier is the exception. Rewrite: "Four of the six detectors send every candidate to Claude; the admin-check detector does the same except for three literal patterns; the hardcoded-secrets detector runs on sixteen fixed patterns and never calls a model." NUMBER BESIDE IT: replace "high-precision" with the measured sentence's false-alarm clause or delete the adjective. |
| 18 | "Downloadable PDF report. Every PR ships with a branded PDF summarizing findings and remediation steps, handy for stakeholder reviews or attaching to tickets." | The PDF service exists. | None material. Keep. |
| 19 | "Native GitHub App. Install once per org. No tokens to rotate, no webhooks to configure. Secure by default." | GitHub App install path exists; the App model means no user token and no customer-side webhook. "Secure by default" is an unsupported posture claim; the security page is where posture is stated. | NARROWING: delete "Secure by default" or link it to security.html's specific statements. |
| 20 | Structured data (schema.org) description, same six-class "Detects" sentence | as #2 | as #2. |
| 21 | Pricing cards ("All 6 detectors", plan limits) | Out of scope by instruction; "All 6 detectors" is true. | Out of scope. |

## security.html and the blog post

| page | what it says | what we can prove | gap |
|---|---|---|---|
| security.html, subprocessor table | "Anthropic: Diff analysis (Claude API)" | True for five detectors; the secrets check sends nothing to Anthropic on its shipped path. | Optional precision, not a contradiction. Leave in this pass. |
| blog post (2026-05-19) | "We then ran both detectors ... across fourteen open-source repositories. The corpus was 71,611 files ... The run found zero true positives ... We have dropped any false-positive-rate claim that depended on that run. A separate experiment ... is what will produce an honest precision number." | The May run happened as described. The post's own discipline (counts, no rate, the flaw named) matches today's. Superseded in one respect: the "separate experiment" now exists as the 2026-09-12 readings, and it found real credentials on customer-shaped code (3 of 5 flags), so "mature open-source projects do not commit real secrets" stays true of the mature corpus and is not true of the ICP sample. | A dated ADDENDUM at the end of the post pointing at the measured sentence; no rewrite of a dated post. |

## The remedy shape, ruled

Deletions (nothing measured can stand behind them): the hero's catch promise (#4); "for
compliance" (#9, #14, page and product); "Secure by default" (#19); "high-precision" (#17).

Narrowings (true after a word changes): "Detects" to "Checks for" in all six places (#2, #5,
#8, #20); the sample's confidence row (#12, #13) marked as illustrative with the secrets row
shown as a pattern match; the adjectives "professional", "precise", "actionable", "everything
your team needs" (#7, #9, #10, #16).

Numbers beside them: "high-signal second reviewer" (#11) and the secrets clause of #17, both
replaced by or pointed at the measured sentence.

Correction of the owner's reading: #17 is the nearest-true sentence but is false as written,
because admin-check's three literal-tier patterns emit without a model call. The corrected
sentence is in the table.

## Whether the page should carry a numbers section: yes

Ruled yes, not premature. A page with no figure reads as marketing to the engineer this page
is for, and the figure that exists is stronger than any adjective on the page. The section
carries the secrets licensed sentence verbatim, names it as the one row measured on real
code, and says in one line that the other five detectors are measured on authored fixtures
only, with real-code numbers to follow. One measured row stated with its scope is more
credible than six rows stated with none, and the sentence already carries the two miss
classes and the two corpora, so it cannot be read as more than it is. It also gives the page
a place to grow: each row that closes replaces one "fixtures only" line with a sentence.

## Ruling on the remedy order

Deletions first, then the numbers section, then the narrowings, in one content pull request
after this audit is approved. The deletions go first because each is a claim the measured
sentence contradicts or cannot support, and publishing the sentence beside them is the
credibility loss the owner named. The numbers section goes second because it is what
replaces the deleted promises with something an engineer can check. The narrowings go last
because they are wording, not truth: the page is not false for saying "professional", it is
merely unmeasured. The blog addendum rides with the same pull request. Product copy that the
page quotes (#14) changes in the same PR so the page and the comment builder do not diverge.
