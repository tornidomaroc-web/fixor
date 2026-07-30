# Detector test rules

Central home for the rules that govern how Fixor detectors are validated. Rules accumulate from calibration sessions; each one is here because we got it wrong once and don't want to get it wrong again. Read this before authoring a new fixture set, refactoring a harness, or proposing a prompt edit.

Last reviewed: 2026-06-12 (post-audit doc cleanup; previous review 2026-05-14, post Mass-Assignment + IDOR audit sessions).

Numbering note (2026-06-12): two rule-number collisions were resolved. "Lane discipline" (formerly a second R5) is now **R10**, and "No prompt iteration on FAIL" (formerly a second R6) is now **R11**. R5 (regex false-negative on positives) and R6 (fixture misclassification surfaced by LLM disagreement) keep their numbers — every external reference (session-close docs, META.md files, baseline reports) uses those meanings. A stray duplicate R8 heading was also removed; R8 is defined once, below.

---

## Fixture authoring

### F1. No model-context comments in fixtures

Fixture files contain code, not explanations of safety. If a comment says *"this is intentionally unauthenticated"* or *"the RLS policy enforces ownership"* or *"server-only — never reaches the browser,"* it is telling the LLM the answer. Strip it.

The LLM should reach a verdict from the code shape alone, the same way it would on a real PR. Comments that describe **what the code does** are acceptable when a human reader would write them anyway. Comments that **assert a safety property** are leakage.

Test phrase: would the LLM reach the same verdict if this comment were deleted? If yes, the comment is decorative — keep or strip as taste dictates. If no, the comment is doing load-bearing work the code should be doing — strip it and reshape the code or use a sidecar (F4).

**Strip-by-default for confirmed-mild leakers.** When a fixture's comments cross the line into safety/intent assertion (vs. pure code-explanation), strip without verifying the LLM's signal-use first. Two reasons:

1. *Catching unknown LLM signal-use*: the LLM uses cues we do not predict. "Verify by reading" assumes our judgment of what the LLM uses is more reliable than an empirical strip. The Mass-Assignment session proved that assumption wrong repeatedly.
2. *Surfacing pre-filter scope mismatches*: comment-stripped fixtures that newly classify as R4 (pre-filter SKIP, no LLM engagement) were testing the regex layer all along, regardless of whether the comments looked load-bearing. The audit value of strip-by-default extends beyond LLM signal-use into exposing pre-existing pre-filter behavior that fixture authorship can mask.

If a stripped fixture flips verdict on the next stability run, that is a finding to document, not a regression to undo.

**Strip-by-default audit value is variable per fixture.** Sometimes the strip catches load-bearing LLM signal-use (the LLM was using the comment as input, the strip flips verdict, real finding). Sometimes it surfaces a pre-existing R4 case that was already regex-scope (the comment was decorative for both layers, the strip changes nothing operationally but reveals the fixture was never engaging the LLM). Both outcomes are valid audit findings. The rule applies regardless of expected audit value per fixture, because the cost of stripping is zero and we cannot know which case applies without doing it. Expectation: ~50-70% of strips will produce audit value (load-bearing catch or new R4 surface); the rest confirm decorative leakage that was already not load-bearing. The rule is correct on average, not per-fixture.

### F2. Safety in config vs safety in code — classifier

Before authoring a fixture, name *where* the safety mechanism lives:

- **Safety in code**: HMAC verification call present, hardcoded secret literal, Zod schema applied, literal field map in a Prisma `data:` argument. The code IS the evidence. Single-file fixture works.
- **Safety in config**: RLS policy in a migration file, `requireAdmin` middleware defined elsewhere, Prisma `@id` schema annotation, env-var naming convention (`NEXT_PUBLIC_*`). The evidence lives in adjacent files the harness cannot see by default. Single-file fixture cannot honestly encode this.

Detectors whose safety lives in config need sidecar harness support (F4) before claiming accuracy. Otherwise the fixture author smuggles in the config via comments (F1 violation), and the accuracy claim is hollow.

### F3. Encoding non-load-bearing signals — the recurring trap

The recurring mistake across Mass-Assignment rounds 1-3: encoding semantic safety via a syntactic signal that doesn't carry the semantic guarantee at runtime.

Examples we've actually shipped and had to fix:
- TypeScript type declaration claiming "clean model" (TS types don't validate at runtime)
- `where: { id: session.user.id }` claiming "this prevents mass assignment" (authz on `where` doesn't constrain WHICH fields are written)
- Prisma `@id` on a userId field claiming "this isn't in the writable surface" (the addendum we wrote treated all schema fields as writable surface)

Before writing a fixture: ask *"what is the semantic guarantee, and what carries it at runtime?"* If the answer is "the type annotation" or "the where clause" or "the comment," reshape the fixture so the actual guarantee — runtime validation, allowlist, schema constraint — is visible.

### F4. Sidecar channels for cross-file safety signals

When safety lives in config (F2), use a sidecar file next to the fixture:

- `<fixture>.schema.prisma` — Prisma model definitions (implemented for MA Phase 1a)
- `<fixture>.policy.sql` — RLS policy bodies (implemented for IDOR Day 3 audit)
- `<fixture>.middleware.ts` — middleware definitions like `$extends` (implemented for IDOR Day 3 audit)
- `<fixture>.config.ts` — env-var convention helpers (future, if needed)

The harness loader detects sidecars and injects them via `DetectorContext.sidecarsByPath` keyed by sidecar kind. Canonical kind constants live in `src/analysis-engine/sidecar-kinds.ts` — detectors and the harness must import `SIDECAR_KINDS` from there; never inline the kind string as a literal (rule guards against drift across detector + harness + addendum text).

Adding a new sidecar kind is a **capability extension** (R7), not a calibration iteration. The change touches five places: the constants file, the extension mapping, the detector's read site, the SYSTEM_PROMPT addendum paragraph, and the user-message render. Co-locate all five in one commit.

#### F4a. Marker syntax for fixtures with sidecars

Fixtures that carry sidecars MUST declare them at the top of the file with a per-line `// SIDECAR:` marker, one line per sidecar file. Format:

```ts
// ASSUMED-PATH: src/routes/notes.ts
// SIDECAR: 03-postgres-rls.policy.sql
```

For fixtures with multiple sidecars:

```ts
// ASSUMED-PATH: src/routes/contacts.ts
// SIDECAR: 07-rls-via-prisma-extension.middleware.ts
// SIDECAR: 07-rls-via-prisma-extension.policy.sql
```

Reasons for the per-line shape: grep-friendly (`grep "SIDECAR:" fixtures/`), forward-compatible to multi-sidecar fixtures without syntax change, leaks only file existence (which the SYSTEM_PROMPT addendum already discloses). Do NOT include the sidecar's kind name in the marker (`// SIDECAR: rls-policy (...)` is too informative — leaks the mechanism category).

Markers are required ONLY for fixtures rebuilt with sidecars. Comment-only strips (where a leaky comment was removed and no sidecar was added) get zero markers — the stripped code is its own audit trail.

**The harness strips `// SIDECAR:` markers before LLM exposure**, parallel to ASSUMED-PATH. This is not an arbitrary harness choice: it mirrors production deployment, where the GitHub App reads sidecars from filesystem paths (`schema.prisma`, `migrations/*.sql`, middleware module imports), not from inline annotations in route files. Keeping the marker in the human-facing fixture but stripping it from the LLM context preserves both audit navigation AND the parity claim.

#### F4c. Fixture iterator conventions

The stability harness iterates files in `<fixtures>/positive/` and `<fixtures>/negative/`. The iterator excludes:

- `.md` (META.md and similar documentation)
- `.schema.prisma`, `.policy.sql`, `.middleware.ts`, `.config.ts` (sidecar kinds)
- `.disabled` suffix (temporarily exclude a fixture or sidecar without deletion; restore by renaming)

Use `.disabled` to gate a fixture out for one-off falsifier runs or interim debugging without losing the file. Always restore after the test. Example: the Day 5 sidecar falsifier renamed `<fixture>.policy.sql` to `<fixture>.policy.sql.disabled` to run IDOR without sidecars, then renamed back.

#### F4b. Addendum paragraph template for new sidecar kinds

When adding a new sidecar kind to a detector's SYSTEM_PROMPT, follow this shape:

> CONTEXT BLOCKS — Verified \<X\>: when a block titled "Verified \<X\> for this file (ground truth):" appears in the user message, \[the body\] is the authoritative \<Y\> for this file. \[Apply detector-specific exception or interpretation rule.\] When no such block is present, \[default to current behavior, unchanged\].

The pattern is reusable; the content is detector-specific by design. Each detector integrates the sidecar into its own existing exception model (MA: "model fields are the writable surface"; IDOR: "policy is the authoritative authorization layer"; future detectors: their own). The structural promise — labeled ground-truth block, fallback to current behavior — stays constant.

---

## Harness and measurement

### R1. Single-pass accuracy is not real accuracy. n=K required.

Stability harness runs each fixture N times (default 5). Pass thresholds:
- Positives: >= 4/5 flagged
- Negatives: 5/5 correctly-skipped (zero FP tolerance)

A "PASS" with n=1 means nothing. Single-pass results are useful only for "did the plumbing work" sanity, not for accuracy claims. Any accuracy claim in a commit message, README, or marketing copy must trace back to an n>=5 measurement.

### R2. Reasoning logs are printed for every calibration run, not just verdicts.

The harness prints the LLM's `reasoning` field for every iteration of every fixture. Without this, we can't tell *why* the LLM produced its verdict, which means we can't distinguish:
- A correct verdict for the wrong reason (e.g., LLM read a leaked comment instead of reasoning from code)
- A correct verdict for the right reason (LLM reasoned from code shape)

Both look like "PASS" in a binary harness. Only reasoning logs let us audit the cognitive path.

### R3. n=5 resolution caveat must be stated explicitly in every accuracy report.

n=5 catches outright stochasticity. It does **not** detect low-rate FP. Zero FP at n=5 means "no FP at 20% resolution," not "calibrated." A 5-10% FP rate would be invisible at this sample size.

Every accuracy report must state the sample size and the implied resolution. Five clean runs is the floor for proceeding to G3, not the ceiling of confidence.

### R4. Pre-filter SKIP is not a cognitive pass.

If a fixture short-circuits via the regex pre-filter (no source/sink co-occurrence, path filter, language filter), the LLM never engaged. The result is "harness skipped this," not "the detector correctly judged this safe."

A "negative passes 5/5" via pre-filter SKIP is testing the regex, not the detector. Negatives that always SKIP via pre-filter should either be moved out of the fixture set, have their handler restructured so the LLM actually runs on them, OR be reclassified per R4a below.

### R4a. Split-counting requirement for accuracy reports.

Detector accuracy reports MUST split the negatives breakdown into two buckets:

- **Cognitive negatives** (LLM-assessed): negatives where the pre-filter engaged and the LLM judged the case. These are the load-bearing accuracy denominator.
- **Regex-scope negatives** (pre-filter SKIP only): negatives where the pre-filter correctly excluded the case (path filter, no source/sink co-occurrence, language filter, server-only marker, etc.) and the LLM was never invoked.

A negative that pre-filter-SKIPs is *useful* — it confirms the regex correctly classifies the case as out-of-scope — but it is NOT evidence of LLM accuracy. Report shape:

```
Cognitive negatives: N1/M1 at fingerprint <f>   ← this is the accuracy claim
Regex-scope negatives: N2/M2                    ← regex correctness, reported separately
```

Total "negatives passing" is `N1 + N2`, but the accuracy denominator is `M1`, not `M1 + M2`. Never inflate the LLM accuracy claim by including regex-scope cases.

The classification "regex-scope negative" applies regardless of how clean the code shape is. If the pre-filter never invoked the LLM, the case did not test cognition. Apply this split to every detector's Day 4+ stability report.

**High R4 rate in a detector's negatives is a product signal, not just a fixture-authoring signal.** Detectors where >20% of negatives are regex-scope may not need LLM cognition on the negative path at all — the regex layer is already doing the work, and the LLM is either rubber-stamping or producing inconsistent verdicts on cases it never sees. Observed Day 3: secrets-exposure 30%, auth-bypass 20%, vs. IDOR 0%. Detectors relying on infrastructure markers (`server-only`, `NEXT_PUBLIC_*`, script paths) cluster at the high end; detectors relying on code-shape patterns (source/sink, middleware calls) cluster at the low end. If Day 4 stability confirms the high-R4-rate detectors are getting their accuracy primarily from regex on negatives, the product question for Day 5 is whether LLM cognition belongs on the negative path of those detectors at all.

### R10. Lane discipline — detectors flag only within their assigned scope.

Cross-detector signal is FP-shaped even if the underlying observation is real. Examples:
- Mass-Assignment detector flagging an IDOR pattern (body-controlled `where`) — even though the IDOR is real, this is scope creep. We have an IDOR detector.
- IDOR detector flagging a mass-assignment pattern — same.

The remedy when this happens is to tighten the lane in the detector's system prompt, not to celebrate "two-for-one" findings. Cross-detector noise hurts the customer more than a missed adjacent-class signal helps (we have other detectors for that).

---

## Iteration discipline

### R11. No prompt iteration on FAIL during validation runs.

When a stability run produces an unexpected verdict (positive that didn't flag, negative that flagged), the response is **stop and report**. Do not propose-and-fix in the same execution. Do not edit the prompt to make the verdict come out right.

The reason: corrective edits compound silently. If every FAIL triggers a prompt edit, the prompt drifts toward fitting the fixture set rather than fitting reality. The fixture set IS the prompt's training corpus at that point.

Decisions on how to respond to a FAIL belong to the operator running the calibration, made between runs. Never inside the same run.

### R7. "Capability extension" vs "calibration iteration" — fingerprint bumps need this distinction.

The SYSTEM_PROMPT fingerprint changes any time the prompt changes. Not every change is the same kind of work:

- **Calibration iteration**: tuning the prompt to suppress observed flag patterns. *"benign_03 flagged for reason X; add 'do not treat X as flag-worthy' to the prompt."* This is what the "no prompt tuning in Phase 1a" rule guards against — overfitting to observed FPs.
- **Capability extension**: adding a new context channel the prompt must know how to consume. *"production injects schema files; the prompt needs language for handling them."* Triggered by a structural change in what the prompt is asked to do, not by an observed FP.

Bumps from capability extensions are acceptable during Phase 1a. Bumps from calibration iteration are not. Every bump is documented in `META.md` with the classification and rationale.

### R5. Regex false-negative on positives.

A fixture whose POSITIVE shape is not caught by any `PREFILTER_PATTERN`, causing the LLM to never assess it. Result: a real bug missed by the pipeline. The harness reports "0/5 flagged" for a confirmed-positive fixture, which looks identical to "LLM said safe" in the aggregate but is a fundamentally different failure mode.

**Action required**: file the regex gap as a detector improvement task. Add the missing pattern(s), re-run stability. R5 cases are technical debt on the regex layer, not detector failures.

**Distinct from R4** (negatives that pre-filter SKIPs — harmless, regex working as designed). R5 is a real miss.

**Reporting**: track R5 separately from cognitive accuracy. R5 cases cannot be evaluated by the LLM in the current pipeline. Every R5 must surface: the missed positive's filename, the bug shape, and the regex gap that caused the miss (so the fix path is concrete).

Concrete instances surfaced Day 4:
- `auth-bypass/positive/05-missing-middleware.js` — bug is *absence* of `requireAuth` middleware on a `/cancel` route. No `PREFILTER_PATTERN` covers "missing auth middleware" because absence is hard to express as a positive regex.
- `auth-bypass/positive/08-jwt-verify-false.py` — bug is `options={"verify_signature": False}` in Python dict syntax. The `jwt_verify_false` regex `verify_signature\s*[:=]\s*False/i` matches the bare-identifier form (`verify_signature = False`) but not the quoted-key dict form (`"verify_signature":`).

### R5-syntax vs R5-structural — sub-shape distinction.

R5 instances divide into two sub-shapes with asymmetric fix profiles. The split is a D4 unbundling — same tag, different effort, different risk.

**R5-syntax**: regex doesn't cover an idiomatic variant of an otherwise-recognized pattern. The detector "knows" the bug class; the regex just misses the language-specific or formatting-specific form. **Fix path**: tactical regex extension (~5 min, low risk). Examples:
- `auth-bypass/positive/08-jwt-verify-false.py` (closed Day 5) — Python dict-quoted-key form `"verify_signature": False` not covered by bare-identifier regex.
- `secrets-exposure/positive/09-slack-webhook-hardcoded.py` (closed Day 5+) — Python multi-line implicit string concatenation breaks slack URL regex across line boundary.

**R5-structural**: regex cannot express the pattern at all. The bug shape is structural, semantic, or about absence — beyond what regex naturally captures. **Fix path**: new detector concept, AST analysis, or different detection mechanism. Examples:
- `auth-bypass/positive/05-missing-middleware.js` (parked) — absence of `requireAuth` middleware on a `/cancel` route. Regex cannot express "no middleware applied."

The action-implication asymmetry is the load-bearing reason for the split. Bundling them under "R5 fixes" hides the cost asymmetry — a 5-min tweak ≠ architectural work, and treating them as one priority bucket masks the decision.

### R6. Fixture misclassification surfaced by LLM disagreement.

A case where the LLM cognitively disagrees with a fixture's intended classification, with a defensible argument that the fixture is mislabeled rather than the detector wrong. Distinct from R5 (regex misses a real bug; pipeline produces wrong verdict) and R4 (regex correctly out-scopes; harmless). R6 is the LLM doing the auditor's job — surfacing that a fixture-as-authored doesn't match the detector's actual semantics.

**Action when an R6 case surfaces — three responses:**
1. **Reclassify the fixture** (LLM is right): rename, move directory, re-run stability, update META.md to note the reclassification + Day-N attribution.
2. **Document as borderline** (real-world readers would split): introduce a third bucket if multiple R6 cases of this shape accumulate.
3. **Keep as-is with documented justification** (LLM wrong): record why the LLM's reasoning is wrong; the LLM's reasoning becomes training data for prompt refinement.

R6 cases are audit value, not noise. They mean the fixture set is being stress-tested by the detector it's meant to validate — which is exactly the discipline the audit philosophy calls for.

**First instance (Day 5)**: `env-exposure/negative/07-redacted-diagnostics.js`. LLM consistently flagged at MEDIUM confidence (5/5 runs) arguing the redaction regex `KEY|SECRET|TOKEN|PASSWORD|DSN` misses common sensitive vars (`DATABASE_URL`, `MONGO_URI`, `REDIS_URL`, etc.). Reclassified to positive per Option 1; medium-confidence ceiling is a logger-config sidecar candidate (P0.5).

### R8. Stop-and-report on unexpected outcomes, even when the recovery is obvious.

Even if the right next move feels obvious (e.g., the addendum wording has a known ambiguity), the operator decides what to do next, not the executor. Surface the failure with reasoning excerpts; propose recommendations as "for next turn"; do not write the fix in the same execution.

This rule exists because previous-session-Claude compounded corrective edits silently and produced false confidence. The discipline is annoying when the fix is one line; it matters when the fix is wrong.

### R8a. Incremental commit when a failure mode would swallow batched work.

When the work-shape ahead is sequential and a single failure point can invalidate everything downstream (e.g., a typo in a shared harness lift breaks 6 refactored test files, or a misclassified pre-filter behavior taints 10 stripped fixtures), commit the stable upstream piece before continuing. The split point is wherever the work transitions from "edit one thing in isolation" to "edit N things that depend on a shared assumption."

Failure mode this guards against: batching all of Day N into one commit, hitting a contamination problem on fixture 9 of 10, and finding the only way back is to undo 1-3 days of work. Granular commits cap blast radius.

Concrete signal that a split point has arrived: when the next operation would copy a pattern you just built (refactor, addendum, sidecar shape) into 3+ more places. Pause first. Inspect the pattern. Then continue.

### Cognitive case classification (post Day-5+ analysis).

For Option G analysis, post-strip stability reports, and any future architecture-decision input, classify each LLM-engaged case as:

**RUBBER-STAMP** — LLM confirms a verdict the regex already proved via literal pattern match. Zero discriminative work. The LLM looked at the code and saw what the regex saw. Example: secrets-exposure positives where the regex matched `sk_live_*` or `AKIA[A-Z0-9]{16}`; LLM reads code, confirms literal is a real key, flags. The literal IS the evidence.

**JUDGMENT-AGREE** — LLM evaluated competing interpretations and landed on the correct verdict. Discriminative work that happened to match expected intent. Example: admin-check cognitive negatives where LLM recognizes role is fetched from `user_roles` DB table via parameterized query (safe RBAC) vs hardcoded email comparison (positive). The LLM did real classification work; the verdict aligning with intent is the outcome of judgment, not pattern confirmation.

**DISAGREE** — LLM rendered opposite verdict at HIGH confidence (any case). Real signal regardless of fixture intent — either LLM caught what regex missed, or fixture is mislabeled (see R6).

**AMBIGUOUS** — MEDIUM-confidence verdict, suppressed by detector's confidence ladder. LLM cognitively engaged but couldn't reach HIGH confidence. Often signals cross-file context gap (sidecar candidate) or partial-signal case (logger-config opacity, incomplete redaction regex).

**Why this matters**: agreement rate alone tells us "LLM is accurate." The RUBBER-STAMP / JUDGMENT-AGREE split tells us "is LLM redundant or load-bearing." Same outcome, different action implication. The split is required input for any architecture decision (Option G, hybrid detector design, LLM-on-ambiguity refactor). Without it, "high agreement = remove LLM" is the wrong inference.

**Reasoning quality for literal-pattern detectors**: for detectors where pre-filter shapes ARE the evidence (the regex match is the bug), hand-authored per-pattern explanations often beat LLM-generated reasoning. The LLM tends toward generic *"this pattern indicates X"* prose; hand-authored text can include specific remediation guidance (rotate the secret, move to env var, AND restart services). Static explanations are not a degradation — they may be an upgrade when the pattern is literal-token-shaped. Apply when designing reasoning paths for any hybrid detector. Watch for: context-dependent patterns where the explanation needs to reference surrounding code (e.g., "is this private key SSH or JWT?") — those patterns may need to retain LLM reasoning even when verdict bypasses LLM (Option 5 hybrid shape).

**Empirical correlation surfaced Day 5-6**: higher R4 rate correlates with higher rubber-stamp rate. Detectors that pre-filter heavily on negatives (secrets-exposure 100% R4, auth-bypass 70% R4) tend to also pre-filter heavily on positives via literal-pattern matches, leaving the LLM with little to discriminate. Detectors with low R4 (IDOR 0%) have LLM doing substantive JUDGMENT-AGREE work on most engaged cases. This is the data input for the per-detector Option G assessment.

### R9. Classification frameworks should remain open.

When a classification framework (e.g. the (a)/(b)/(c) pre-filter post-strip framework, or any future taxonomy) encounters a real case that does not fit, **name a new category** rather than stretching an existing one. The framework is a tool, not a straitjacket.

The cost of forcing a case into the wrong bucket is two-fold: it hides the actual phenomenon (the case becomes invisible in the count), and it dilutes the meaning of the bucket it was forced into (now "(a) clean" includes cases that are not actually clean in the original sense).

Concrete instance: the (a)/(b)/(c) pre-filter framework was built before R4 cases were common. When R4 cases started appearing as a distinct shape — "pre-filter SKIPs but the strip is otherwise clean" — the response was to name it as R4, not to expand (a) to include it. The (a)/(b)/(c)/R4 split keeps each bucket meaningful.

Operating procedure: if you encounter a real case that does not fit, **surface and wait** rather than unilaterally extending the framework. The framework's owner decides on the new category.

**Status of the (a)/(b)/(c)/R4 framework as of audit Day 3:** approximately 30 stripped fixtures touched across 5 detectors. Observed cases all fall into (a) clean post-strip OR R4 (pre-filter SKIP for path filter, server-only marker, or no-pattern-match). Categories (b) "real signal lost from strip, rebuild or drop" and (c) "pre-filter regex matched comment text" have produced **no observed cases through Day 3**. Both are retained for future shapes (new detectors with looser regex patterns, central LLM analyzer migration). Revisit retention decision at Day 5 retrospective.

### Stopping criteria are applied per-detector mid-run.

Judgment on whether an anomaly is a failure-mode or an explained-finding is the operator's to make. STOP is reserved for the four specific criteria (LLM cites stripped/marker text; cognitive positives or negatives drop below 70%; verdict regression vs surgery expectations; anything not predicted and not explainable). Everything else is documented and continued.

The discipline matters because the alternative — stop on every anomaly — would have aborted Day 4 at env-exposure's medium-confidence /03 case or auth-bypass's R5 positives. Both turned out to be valuable findings worth the per-detector report, not failures worth aborting the audit. Conversely, secrets-exposure's 24 LLM errors WERE a stop trigger (explicit harness FAIL, unexplained, contaminated downstream data). The protocol correctly continued through three explainable anomalies and stopped on the one unexplainable one.

### Canonical wedge sentence (Day 5 lock)

Until per-detector pattern documentation ships publicly, the canonical Fixor wedge positioning is:

> "Detects 6 vulnerability classes in Node/TypeScript codebases: route-level auth bypass (sentinel and missing-middleware), missing admin gates (hardcoded-admin and missing-admin-gate), IDOR, environment-variable exposure, hardcoded secrets, and unverified webhook handlers. Express-family routers covered for the route-based detectors; Fastify/Koa/Hono/NestJS not yet. The webhook detector additionally recognizes Flask and Go HTTP handlers, and covers Stripe / GitHub / Twilio / Slack / Lemon Squeezy / custom-HMAC signing; Shopify / Discord / AWS SNS / GCP Pub/Sub / Mailgun and other provider-specific schemes not yet."

(2026-06-12 correction: "Rails" was removed from the wedge's webhook clause. A Rails route-shape prefilter pattern exists (`rails_post_webhook`) and such routes reach the LLM stage, but there is no Rails fixture, so the claim is not baseline-anchored — per detector-capabilities.md rule 1, regex reach without a fixture is not a public claim. Flask and Go both have positive + negative webhook fixtures and stay.)

This is the load-bearing positioning across outreach drafts, README, mintlify FAQ, launch post 1, and any other public copy. Two sentences, no em-dashes, no specific cadence commitment. Honest about scope (the six pattern families it names) and method (stability harness + published numbers + miss documentation).

**Upgrade path**: when per-detector pattern documentation ships publicly (P1 task), the wedge upgrades to include a third clause covering "document the patterns each detector recognizes." The edit was held in Day 5 because shipping the claim before the docs reproduces the "PERFECT 20/20" pattern in a different shape — a load-bearing claim must follow the substance, not lead it.

### Audit philosophy: measured honesty beats unmeasured perfection.

Pre-audit Fixor: "9 detectors with PERFECT 20/20 accuracy" — unmeasured, unverifiable, soft. Did not survive contact with a customer who asks "how do you know."

Post-audit Fixor: "Layered detection with measured per-detector cognitive accuracy at n=5 under stripped fixtures, with documented calibration ceilings, documented regex gaps (R5), and documented architectural questions (high-R4 detectors as Day 5 product review item)." Survives the same question.

The wedge becomes "we know what we don't know," which is defensible. Unmeasured "PERFECT" claims do not survive any probing customer. **The audit produced a stronger marketing position, not a weaker one** — the post-audit numbers ARE the wedge for Option B (honesty launch post), not damage to walk back. This frame should inform any future calibration session: measured-and-honest > unmeasured-and-optimistic, every time.

### The compounding-layers property of audits.

Audits do not arrive at a final number on first pass. Each resolved layer of measurement gap exposes the next. Day 4-5 of this audit traversed six:

1. **"PERFECT 20/20" claims unmeasured** — git-log assertions had no stability data behind them.
2. **Fixture leakage hiding LLM cognition** — comments told the LLM the answer; the LLM "passing" was rubber-stamping comments, not judging code.
3. **Single-pass hiding stability variance** — n=1 results don't distinguish lucky correct verdicts from stable ones.
4. **Strip surgery hiding regex-scope cases (R4)** — pre-filter SKIPs were silently boosting the "negatives passing" count without engaging the LLM at all.
5. **R4 distribution hiding architecture question (Option G)** — when 30-70% of negatives never invoke the LLM, the LLM's role in the detector pipeline is itself a product question.
6. **Fixture clean-cut hiding fuzzy-middle reality** — agreement rates on unambiguous fixtures cannot probe the LLM's value-add on real-world fuzzy cases.

Each layer was invisible until the prior was resolved. This is epistemic depth, not incompetence. The honest claim is not "we measure accurately" but "we measure, discover what we don't know, document, iterate."

**Tension with D2** (measurement before commitment): if there's always a next layer, are D2's measurement requirements ever sufficient? Answer: D2 is necessary but never finally sufficient. Each application of D2 reveals what wasn't measured. The discipline is not "measure once perfectly" but "measure at each layer of awareness; when a new layer surfaces, treat it as a Day-N audit problem." D2 holds; it just doesn't terminate.

**Anti-inflation note**: new layers earn their slot only when they reveal something invisible from prior layers. Reject layer inflation — concrete instance: R5-syntax instances (Day 5-6 slack-webhook multi-line, jwt-verify dict form) are empirical evidence of layer 6 (fixture clean-cut hiding fuzzy-middle reality), NOT a distinct layer 7. Layer 6 already says "the fuzzy middle includes language idioms." Each R5-syntax case is a manifestation, not a new shape of unknown.

This frame belongs in any honest description of Fixor's engineering culture — and is the right Pattern 10 sentence for launch post 1: *the audit's value compounds, each layer earned the right to see the next*.

---

## Decision discipline

### D1. Blast radius first, fix second.

When a discovery has portfolio implications (a failure mode that applies beyond the immediate detector or fixture), the immediate response is to **scope the blast radius**, not to plan the per-item fix. Ask: "where else does this apply? what's at risk right now? what's the smallest action that contains the risk?"

Concrete instance: the discovery that xss/cmdi/path-traversal had no fixture-based accuracy harness was found mid-audit. The correct immediate move was to suppress those finding types from customer-facing output (30-min change), not to schedule a Day 5 triage. The triage decides the **product** answer; the suppression contains the **exposure** while triage happens.

### D2. Detector accuracy claims must trace to leakage-free fixtures + n=K + reasoning audit.

Any claim of the form *"detector X is 20/20"* or *"production-grade"* requires:
1. Fixture set audited for F1 leakage
2. n=K stability run (K >= 5) on stripped fixtures
3. Reasoning logs reviewed for "right answer, wrong reason" patterns
4. Fingerprint of the prompt at measurement time recorded

If any of the four is missing, the claim is single-pass-on-unaudited-fixtures and should be marked as such (or not made at all). Commit messages and README headers count; "PERFECT 20/20" in a commit message is the same epistemic shape as a public marketing claim.

### D4. Unbundling decisions.

When two work items appear in the same priority bucket because they share a tag (e.g., "R5 fixes," "sidecar work," "Phase 5 cleanup"), check whether their effort profiles, risk profiles, and dependencies match. If not, split into separate items. Bundling masks asymmetric decisions: a 5-minute regex tweak and an architecturally-hard new-detector concept should not share priority just because both are labeled "R5."

The tag is a categorization; the priority is a separate dimension. Concrete instance: Day 5 R5 fixes split into P0.4 (verify_signature regex, ~5 min) and a deferred new-detector concept (missing-middleware heuristic, requires architectural design). Bundling would have produced "P0.4: R5 fixes" with one priority and either over-delivered on the easy half or under-delivered on the hard half.

### D5. Measurement before commitment.

Any non-trivial product or engineering decision (new detector, new feature, re-architecture, marketing claim) must define its accuracy/success metric upfront. Plan the measurement methodology (n=K, fixture leakage policy, falsifier) before committing engineering effort, including what specific outcome would invalidate the decision. **The falsifier is part of the measurement plan, not retrospective rationalization.** Retroactive "did it work?" measurements are too easy to fit to the conclusion.

The audit's value came from converting "9 detectors PERFECT 20/20" (speculative) into "59/60 cognitive cases at n=5 on stripped fixtures, with R4/R5 documented per detector" (measured). The same discipline applies to Option G refactor, new harness builds, public post claims, and any future feature. If a proposal cannot answer "what specific outcome would prove this wrong," the proposal isn't ready to ship.

**Estimate validation: before greenlighting a spend, run the cost math independently.** Surface deltas before execution, not retroactively. Retroactive cost surprises are measurement failures, not budgeting failures. Concrete instance: the Day 5 sidecar falsifier was estimated at $0.05; the actual math (16 fixtures × 5 runs × $0.004 = $0.32) was 6x larger. Catching the delta pre-spend converted a "cheap test" rationale into "decision-bearing test, cost justified by value" rationale, which is structurally honest. (Note 2026-06-12: the $0.004/call figure used that day was itself wrong — it was a Haiku-class assumption, but detection runs Sonnet 4.6 at ~$0.010/call measured. The rule's lesson compounds: even the independent cost math needs the right per-call constant. The harness default has been corrected.) Apply to every dollar-attached decision: independent cost math before the greenlight, not after the invoice.

**Second instance (F-004 stage-3 step 2, 2026-07-22): separate the two factors, and measure the one you can measure for free.** A spend estimate is a PRODUCT, `calls × price-per-call`, and the two factors have very different evidence available. Before greenlighting the stage-3 paid run, the call factor was taken as "144 model-reaching fixtures per sample". That figure was not independent: it was the SIZE of the replay recording set, and the replay gate asserts recordings cover exactly the manifest, so replaying can only ever return 144 or fail loud. It restates the estimate; it cannot check it. `measure:stage3-calls` (`src/test/measure-stage3-calls.ts`) counted instead by execution, at zero spend, by patching the SDK boundary and returning a canned response: enumerate the fixture directories, count real calls, assert `enumerated - pre-filtered == calls`. Result 168 enumerated, 24 pre-filtered, **144 measured**, which CONFIRMED the estimate and, separately, corrected the tracker's claim that six entry points reach the full set (they reach 142; the seventh corpus lives outside the harness). Two lessons. **(1) A number that can only reproduce itself is not a check.** Ask what result would have falsified it; if the answer is "none", the instrument is the wrong one. **(2) A zero-spend measurement of the call factor is almost always available, and it halves the uncertainty in the product.** What it CANNOT do is price: a canned response carries zero token usage, so the price factor stays an estimate, and the residual risk concentrates in whichever call shape the flat constant fits worst (here IDOR, which is whole-file and batched and inherits the harness default). Name that residual explicitly rather than letting a measured call count launder the whole product into sounding measured.

> **SUPERSEDED IN MECHANISM, NOT IN LESSON — annotated 2026-07-30, closing the surface sweep opened by PR #137; the 2026-07-22 wording above is left exactly as entered.**
>
> Both numbered lessons stand, and so does the instruction to name the residual. What no longer exists is the pricing mechanism the last two sentences describe. PR #120 dropped the flat per-call constant in favour of MEASURED cost read from the call ledger, so there is no "flat constant" left to fit some call shape worst, and no "harness default" for IDOR to inherit. IDOR's two stability entry points supply no `costPerLlmCallUsd`, so today they emit `no projection (no rate supplied)` rather than falling back to a default rate.
>
> The residual itself is still real: a canned response carries zero token usage, so a zero-spend run still cannot price. What changed is who names it. The harness now reports its own measured cost at run time instead of letting a constant stand in for a price, which is the passage's own instruction implemented in code rather than left to the reader.

### D6. Audit customer-experienced reality, not harness reality.

Audits must scope around what customers actually experience, not what our internal test rigs prove. The Day 4 audit measured fixture accuracy with sidecars present in the harness. The customer-facing deployment runs without sidecars (no production sidecar reader exists yet). The "16/16 cognitive at n=5" claim is true under harness conditions; the customer-experienced number may differ.

Every audit and accuracy claim must specify whether the conditions match production. If they don't, surface the delta and either:
1. Fix the gap (build the production capability so harness conditions = production conditions), or
2. Qualify the claim ("16/16 cognitive with sidecars deployed; production accuracy pending sidecar reader ship").

The harness-vs-production gap is where dishonest numbers live. Future audits should scope around customer-experienced reality first, harness convenience second. Concrete instance: P0.0 (production sidecar reader) was surfaced by this rule applied retroactively to the Day 4 audit — the audit's stated scope was "are our fixture-based numbers honest?", but the load-bearing question for the launch post is "are our customer-experienced numbers honest?"

**Production sidecar reader priority is not static.** It depends on the cumulative safety-mechanism locations of all shipped detectors. The Day 5 falsifier (IDOR without sidecars held at 16/16 cognitive) supported demoting the production reader to P1 because IDOR's SYSTEM_PROMPT already enumerates the handler-visible RLS signals the customer-facing prompt needs. Re-evaluate at every new detector addition: if a new detector's safety mechanism lives in config that the prompt cannot enumerate exhaustively (MA's schema problem, env-exposure logger-config), the production reader re-promotes to P0 because the harness-vs-production gap opens for that detector.

### D8. Reasoning content security — LLM reasoning can re-expose what the finding is flagging.

LLM reasoning that quotes source verbatim can re-expose secrets, credentials, or sensitive identifiers that the finding itself is detecting. PR comments are visible to anyone with repo read access. A finding that flags `JWT_SECRET = "PROD-jwt-acme-..."` and then quotes the actual secret value in the reasoning text effectively republishes the leak through Fixor's own output channel.

This is not an audit observation. It is an active security property of the product surface. Any LLM-based security tool that includes LLM reasoning in customer-visible output has this exposure unless explicitly mitigated.

**Mitigation options (in order of robustness)**:

1. **Hand-authored explanations** (no source quoting by construction). Template text names the pattern class and remediation without echoing matched content. Used by the Option G secrets-exposure pilot (Day 7). Strongest mitigation because the structural property "no source quote" is enforced at authoring time, not at output time.

2. **Post-LLM redaction layer** (regex-redact known secret shapes before emit). Apply the detector's own PREFILTER_PATTERNS to the LLM reasoning text; replace matches with `[REDACTED]`. Defense in depth — catches LLM-quoted secrets that match patterns the detector already recognizes. Does not catch novel secret shapes the LLM might quote.

3. **System prompt instruction** ("do not quote secret values in your reasoning"). Weakest — relies on LLM compliance, which is probabilistic. Pair with #2 as belt-and-suspenders.

**Hybrid detectors keeping LLM reasoning should use option 2 as defense in depth.** Hand-authored per-pattern detectors (Option G shape) get option 1 for free.

**First instance**: Day 7 secrets-exposure pilot surfaced LLM reasoning verbatim-quoting JWT secrets (`"PROD-jwt-acme-9d8f7a6c5b4e3d2f1a0b9c8d7e6f5a4b"`) and Stripe key prefixes into PR comment output. The pilot's hand-authored explanations don't quote source — the bypass mode is structurally safer than the baseline LLM mode it replaces. **The secrets-exposure default was flipped Day 7 to regex-only (hand-authored explanations); LLM mode is now opt-in via `FIXOR_SECRETS_LLM_OPT_IN=true`. This closes the production leak path.**

**Day 7 cross-detector audit also surfaced MEDIUM-risk reasoning leakage in admin-check** (quotes hardcoded internal emails, user IDs, domain suffixes). admin-check Option G work landed Day 8 with per-pattern tier classification (see "Detector ≠ pattern set" below) rather than the wholesale bypass shape that worked for secrets-exposure. LOW-risk detectors (IDOR, auth-bypass, env-exposure) do not quote secrets or sensitive identifiers and need no immediate mitigation.

### Detector ≠ pattern set (Day 8).

When applying Option G or reasoning-content security mitigation to a detector, **inventory patterns first and classify each as literal-tier or judgment-tier** before deciding the mitigation shape.

- **Literal-tier** (RUBBER-STAMP): regex match IS the bug. No context can make the match safe. Examples: `sk_live_*` (always a Stripe live secret), `AKIA[A-Z0-9]{16}` (always an AWS access key), `DEFAULT_ADMIN_ID` (always a hardcoded admin fallback). Wholesale bypass is safe — the LLM was rubber-stamping the regex; removing the LLM produces identical verdicts.

- **Judgment-tier**: regex matches a shape that requires context to disambiguate. Same syntactic form appears in both bug cases and safe cases. Example: `role === "admin"` (admin-check `role_string_compare`) — could be a hardcoded admin grant (bug) OR a comparison against a DB-backed role (safe). The LLM does real discrimination by reading data flow. Bypassing LLM on judgment-tier patterns flags the safe cases too, producing FPs.

**Wholesale bypass is safe only for detectors where every pattern is literal-tier.** Mixed-tier detectors (most real detectors) require per-pattern bypass classification. Add a `tier: "literal" | "judgment"` field to each pattern definition. Default unspecified = "judgment" (conservative — when in doubt, keep LLM in the loop).

**First instance**: admin-check Day 8. Pattern inventory revealed 11 literal-tier + 1 judgment-tier. Wholesale bypass (Day 7 shape) would have produced 6 new FPs on the 6 cognitive negatives that all match the single judgment-tier pattern (`role_string_compare`). Per-pattern classification preserves verdict parity: literal-tier patterns bypass LLM (hand-authored explanations replace LLM reasoning), judgment-tier patterns stay on the LLM path.

**Residual production risk note**: 5 of admin-check's 11 literal-tier patterns (email comparison shapes, body.role access) have plausible non-admin production uses (ban lists, domain filters, request logging) that the fixture set doesn't probe. Classified as literal because every fixture appearance was an admin-grant bug, but flagged for reclassification if production surfaces non-admin uses.

### D8a. Redaction-shape exemption — the detector must not flag its own anti-leak code.

When a secrets-exposure pre-filter pattern matches a line whose right-hand value is itself a redaction artifact, the line is the **redactor**, not the leak. Emitting a finding there flags the anti-leak code as the bug — the worst customer experience this detector can produce.

**Exempted value shapes** (each runs as a regex against the matched line; any match → skip emit, increment `redactionSkipCount` for diagnostics):

1. Asterisks-only quoted value: `password = '********'`, `password: "***"`. Pattern: `[:=]\s*['"\`]\*{2,}['"\`]`.
2. Asterisk concat: `password = '*' + count`. Pattern: `[:=]\s*['"\`]\*['"\`]\s*\+`.
3. Bracket sentinels: `'[REDACTED]'`, `'[FILTERED]'`, `'[HIDDEN]'`, `'[MASKED]'`, `'[PROTECTED]'`, `'[SCRUBBED]'`.
4. Angle-bracket sentinels: `'<hidden>'`, `'<redacted>'`, `'<filtered>'`, `'<masked>'`, `'<scrubbed>'`.
5. Word sentinel: `'redacted'` / `'REDACTED'`.
6. Mask function call: `= mask(...)`, `= redact*(...)`, `= sanitize*(...)`, `= obfuscate*(...)`, `= scrub*(...)`, `= hide*(...)`.

**Out-of-scope (err toward emit)**: empty string defaults `''`, placeholder labels `'xxx'`/`'changeme'`, template placeholders `'<your-password>'`. These may be defaults a customer should change before deploy — emitting is the safer error.

**First instance**: Day 13 — Twenty `url.password = '********'` in `config-variable-mask-sensitive-data.util.ts:21`. Step 4 §7 named this the single worst FP class in the production corpus. The exemption regex was verified against 11 Step 4 source-path FP snippets + 5 synthetic redaction shapes + 3 ambiguous-defaults + 2 theoretical TPs (21/21 expected behavior).

**Generalization to admin-check (Day 14+ scope)**: an analogous "audit-shape exemption" may apply — admin-check patterns matching email-comparison lines whose surrounding context is logging/audit rather than authorization (`logger.info({ adminEmail: req.user.email })`). Not landed; named here for future Day-14 work.

Long-term reasoning-content security may want a cross-cutting redaction layer at the customer-facing emit boundary (webhook handler + CLI emit). Would apply post-LLM regex redaction across all detectors uniformly, closing reasoning-content leak risk without per-detector bypass work.

**Not scheduled until Option G investigation completes on remaining detectors (IDOR, auth-bypass, env-exposure).** After all five detectors have tier-classified patterns, the comparison becomes: is per-detector bypass (Option A applied individually) sufficient, or does central redaction add enough coverage to justify the workstream? Decision gate: post-Step 4 production validation, when we have real-codebase leak data, not just fixture-shape evidence.

**Generalizable property**: this risk is not Fixor-specific. Any LLM-based security tool (Snyk's AI features, GitHub Advanced Security, CodeQL with LLM annotations, future entrants) faces it unless explicitly mitigated. Worth surfacing as part of the public methodology narrative — "we found this in our own product during the audit" is a credibility wedge as well as a fix.

### D7. Pilot scope discipline — don't over-claim mechanism validation as hypothesis validation.

When a pilot tests a mechanism's implementation, do not over-claim it as validating the hypothesis the mechanism was built to test. **Implementation pilots prove the code works.** Hypothesis validation requires the data the mechanism was meant to enable measurement of — which lives downstream of pilot success. Conflate these and a green pilot becomes false confidence about the architecture.

Concrete instance (Day 6+): the secrets-exposure Option G pilot tests whether the regex-only mechanism produces identical fixture verdicts to regex+LLM. A green pilot proves the mechanism is implemented correctly. It does NOT prove "LLM is redundant on secrets-exposure in production" — that hypothesis was already supported by Day 5/6 RUBBER-STAMP analysis, and tested by Step 4 production-shape validation (and Step 3.5 adversarial fixtures), not by the pilot itself.

The pilot is the bridge between analysis and validation. Treating it as either the analysis OR the validation is the failure mode.

### D6a. Validation completeness check before any architecture decision.

Before committing to an architecture change (Option G refactor, new detector pipeline shape, removing a component, replacing a component), list what the fixture data CANNOT tell you. Clean-cut fixtures don't probe the fuzzy middle: partial safety signals, novel framework patterns, cross-framework variants, production-shape noise. The audit's agreement rate is necessary-but-not-sufficient evidence for any refactor commitment.

**Production-shape validation is required for any architecture decision, not optional.** Apply the same rigor that detector-test-rules.md applies to detector accuracy claims: measure under conditions that match production, surface the delta, qualify the claim if conditions don't match.

Concrete instance: Option G investigation produced 97% AGREE rate on the fixture set, which superficially supports refactor. The validation-completeness check surfaced the binding constraint — every fixture is unambiguous; the LLM's true value-add is on the fuzzy middle that real production code contains and the fixture set does not. Therefore Option G decision requires (a) auth-bypass code-experiment pilot, (b) production-shape validation on 20-30 real PRs across diverse stacks, before commitment.

### D3. Customer-facing emission is gated by D2.

Detectors whose accuracy is not yet measured per D2 are suppressed at the customer-facing boundary (`src/config/finding-suppressions.ts`). Suppression is the default; clearance through D2 is what removes a detector from the suppression set.

This is the inverse of the default before the audit. Pre-audit default: emit everything in the registry. Post-audit default: emit nothing the audit hasn't cleared. Add detectors back to the customer surface explicitly as they earn it.

---

## Adding to this document

When a calibration session produces a durable insight, add it here in the turn it emerges. Do not carry rules in turn-history; future-you (or another collaborator) will not have the context. Each rule should be self-contained: the **failure mode** it prevents, the **mechanism** it enforces, and an **example** of the prior mistake when one exists.

Cut rules that turn out to be wrong, obsolete, or merged into another rule. This document is a working surface, not a changelog.
