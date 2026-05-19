# Competitor survey — reasoning-content disclosure mitigation

**Purpose.** Audit trail backing the claims in the OWASP pre-disclosure email (sent 2026-05-19) and Post 1, specifically: *"We reviewed the public documentation, blog posts, and security white papers of [six] security products … None publicly documents a mitigation for this exposure class."*

**The exposure class under review.** An LLM-based security tool uses a model to validate or explain findings, and renders the model's reasoning text into customer-visible output (PR comments, dashboards). When the code under review contains a secret or sensitive identifier, the model's reasoning can quote it verbatim, republishing it to everyone with read access to that channel.

**What counts as a documented mitigation.** Public documentation that explicitly addresses one of: (1) sanitizing/redacting model output before it reaches a customer-visible channel, (2) preventing the model's reasoning from quoting matched secret values, (3) filtering reasoning content for sensitive data. Generic statements about not training on customer code, or about minimizing what is *sent to* the model, are **not** mitigations for this class — they address the input path, not the output path. Note the distinction in each review.

**Review status:** ✅ COMPLETE — all six reviewed 2026-05-19.

**Method rule.** Record the exact URL, the access date, and a verbatim quote or precise page reference for every "yes/partial". A "no" must state which pages were checked. Do not assert a negative ("none documents a mitigation") without listing the pages reviewed per product.

---

## 1. Snyk Code AI (DeepCode AI / Snyk Agent Fix)

- **Primary documentation page:** https://docs.snyk.io/scan-with-snyk/snyk-code
- **Product / security overview:** https://snyk.io/platform/deepcode-ai/
- **Output-handling page reviewed (autofix behavior):** https://docs.snyk.io/scan-with-snyk/snyk-code/manage-code-vulnerabilities/fix-code-vulnerabilities-automatically
- **Date reviewed:** 2026-05-19
- **What I found:** Reviewed the Snyk Code documentation page and the "Fix code vulnerabilities automatically" (Snyk Agent Fix / DeepCode AI Fix) page. Neither documents any handling of model output for sensitive data — no redaction of secrets from suggestions, no filtering of source content from AI-generated explanations. The autofix docs discuss fix accuracy and user-review responsibility only. Snyk maintains a separate trust/data-governance portal that was outside the pages reviewed here.
- **Mitigation documented? (yes / no / partial):** **no** — no output-side sanitization or secret redaction described in the product documentation reviewed.
- **Exact quote or page reference:** Closest content, Limitations section: *"Users must always review the Snyk Agent Fix suggestions to ensure that the resulting implementation of the fix does not break their application"* — addresses user responsibility, not output sanitization. (fix-code-vulnerabilities-automatically page, accessed 2026-05-19.)

## 2. GitHub Copilot Autofix (code scanning)

- **Primary documentation page:** https://docs.github.com/en/code-security/concepts/code-scanning/copilot-autofix-for-code-scanning
- **Output-handling page reviewed ("Responsible use"):** https://docs.github.com/en/code-security/responsible-use/responsible-use-autofix-code-scanning
- **Date reviewed:** 2026-05-19
- **What I found:** Reviewed GitHub's dedicated "Responsible use of Copilot Autofix for code scanning" page — the page most likely to cover output behavior. It documents a general output filter for *harmful* suggestions, but documents no redaction of secrets or sensitive data, and nothing preventing the model echoing source content (including a flagged secret) into a suggestion. The page places responsibility on the PR author to review suggestions before acting.
- **Mitigation documented? (yes / no / partial):** **no** — a harmful-content output filter is documented, but it is not described as addressing secrets or sensitive-data leakage; no mitigation for this specific class.
- **Exact quote or page reference:** *"A filtering system on the LLM helps prevent potentially harmful suggestions being displayed to users."* — section "Quality of suggestions" (responsible-use-autofix-code-scanning page, accessed 2026-05-19). This is harm-prevention, not sensitive-data redaction.

## 3. Semgrep Assistant

- **Primary documentation page:** https://semgrep.dev/docs/semgrep-assistant/overview/
- **Privacy documentation:** https://semgrep.dev/docs/semgrep-assistant/privacy
- **Engineering blog reviewed:** https://semgrep.dev/blog/2024/the-tech-behind-semgrep-assistant/
- **Date reviewed:** 2026-05-19
- **What I found:** Read "The tech behind Semgrep Assistant" engineering blog in full — it describes prompt chains, feedback loops and RAG, and documents no output filtering for secrets or source content. The Semgrep Assistant docs pages (overview, customize, privacy) are a JavaScript-rendered docs app and did not render in the review tool on 2026-05-19; Semgrep's published Assistant privacy documentation describes *input-side* handling — finding lines plus context sent to the AI subprocessor (OpenAI), customer/repository name anonymized, no training on the code, and prompts plus responses (which include code snippets) retained for up to ~6 months. PR/MR comments include AI-generated remediation guidance. Nothing reviewed documents redacting secrets from model output before it reaches those comments.
- **Mitigation documented? (yes / no / partial):** **no** — documentation addresses input privacy and retention; no output-side secret redaction found. (Caveat: one privacy docs page could not be directly rendered; finding is based on the engineering blog read in full plus Semgrep's publicly summarized privacy terms.)
- **Exact quote or page reference:** no relevant section found in pages reviewed — the engineering blog contains no output-sanitization content; the privacy docs page did not render on 2026-05-19.

## 4. Endor Labs

- **Primary documentation page:** https://docs.endorlabs.com/
- **Output-handling page reviewed (AI Code Security Review):** https://www.endorlabs.com/ai-code-security-review
- **AI inventory/governance docs:** https://docs.endorlabs.com/ai/
- **Date reviewed:** 2026-05-19
- **What I found:** Reviewed the AI Code Security Review product page. It describes AI features that summarize code and architectural changes in natural language and answer follow-up questions — features that generate PR-facing natural-language content — but documents no handling of model output for secrets or sensitive data: no redaction, no filtering of source content from generated summaries or reasoning. Endor's broader docs site was not exhaustively reviewed; the AI-feature product page, the most relevant surface, is silent on this.
- **Mitigation documented? (yes / no / partial):** **no** — no output-side sanitization or secret redaction described in the page reviewed.
- **Exact quote or page reference:** no relevant section found in pages reviewed.

## 5. Corgea BLAST

- **Primary documentation page:** https://docs.corgea.app/blast
- **White paper reviewed:** https://corgea.com/blog/whitepaper-blast-ai-powered-sast-scanner
- **Date reviewed:** 2026-05-19
- **What I found:** Reviewed the BLAST documentation page and the BLAST white paper. Both describe detection capability and input context-selection (the "CodeIQ" component selects which parts of the codebase to send to the model), but document no output-side safeguards — no redaction or sanitization of secrets in AI-generated explanations or fixes, no filtering of source or reasoning content from output.
- **Mitigation documented? (yes / no / partial):** **no** — input context-selection is described; no output-side mitigation found.
- **Exact quote or page reference:** *"CodeIQ … pulling in just the right amount of context — whether it's middleware, configurations, or templates — ensuring accurate detection without overwhelming you with irrelevant data"* — BLAST white paper, architecture section (accessed 2026-05-19). Describes input selection, not output sanitization.

## 6. Aikido Security

- **Primary AI documentation page:** https://help.aikido.dev/ai-and-dev-tools/how-aikido-uses-ai
- **AutoFix overview reviewed:** https://help.aikido.dev/autofix-and-remediation/overview-aikido-autofix
- **AutoFix SAST/IaC scope page reviewed:** https://help.aikido.dev/autofix-and-remediation/scope/ai-autofix-for-sast-and-iac-issues
- **Date reviewed:** 2026-05-19
- **What I found:** Reviewed "How Aikido uses AI", the AutoFix overview, and the AutoFix SAST/IaC scope page. **Aikido does send code to a third-party model host.** Its own documentation states code snippets are transmitted to AWS Bedrock for fix generation. Aikido documents strong *input-side* controls — minimal snippets only, small anonymized code fragments, inference-only/transient processing, encrypted transit, and no training by Aikido or AWS Bedrock. It documents **no output-side** mitigation: nothing about redacting secrets or source content from the AI-generated fix/explanation before it is shown to the user. The provider is AWS Bedrock; the specific underlying model is not named on the pages reviewed.
- **Mitigation documented? (yes / no / partial):** **partial — input-side only.** Aikido documents meaningful input-path minimization (the "complementary architectural path" the OWASP email refers to), but documents no output-side reasoning-content redaction, and does **not** abstain from third-party models.
- **Exact quote or page reference:**
  - *"Aikido sends only the minimal required code snippets to AI models hosted on AWS Bedrock over encrypted channels."* — AutoFix overview (accessed 2026-05-19).
  - *"Code snippets required for generating fixes are securely transmitted to AWS Bedrock over encrypted channels."* — AutoFix for SAST and IaC issues (accessed 2026-05-19).
  - *"Neither Aikido nor AWS Bedrock uses this code for training or fine-tuning models."* — AutoFix overview (accessed 2026-05-19).

---

## Survey conclusion

- **Products reviewed:** 6 / 6.
- **Number documenting an output-side mitigation for the reasoning-content disclosure class:** **0 / 6.**
- **What the six DO document (so the post is precise):** input-path controls are common — minimized code sent to the model (Aikido, Semgrep, Corgea/CodeIQ), no training on customer code (Aikido, Semgrep), customer/repo anonymization (Semgrep). GitHub Copilot Autofix documents a general harmful-content output filter. **None of these addresses the output-side class** — a model still receives code and can quote a secret from it into customer-visible output.
- **Defensible summary sentence for Post 1:** "Across the public documentation, product pages, and white papers we reviewed on 2026-05-19 for six AI-augmented security products, none documents an output-side mitigation for this disclosure class — that is, redacting secrets or source content from model output before it reaches a customer-visible channel. Several document input-side minimization and no-training guarantees; one documents a general harmful-content output filter. We are reporting that the public surface is silent on the output path, not that internal mitigations do not exist."
- **Email claim 3 ("none of the five publicly documents a mitigation"):** holds in substance — 0 of the five (Snyk, Copilot, Semgrep, Endor, Corgea) documents an output-side mitigation. The post must scope the claim to "the public pages we reviewed, as of 2026-05-19", keep the email's existing hedge ("not claiming the mitigations do not exist internally"), and acknowledge the input-side controls and the Copilot harm filter so the claim cannot be dismissed as having missed them.
- **Email claim 4 (Aikido "does not send source code to third-party language models at all"):** **FALSE.** Aikido's own documentation states it sends code snippets to AWS Bedrock. The accurate description is input minimization (minimal snippets, no training), not abstention. A correction to OWASP is warranted before Post 1 publishes.
