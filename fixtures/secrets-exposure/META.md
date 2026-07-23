# secrets-exposure fixtures

## F-004 sub-step 2b.5 - this corpus is now a CI gate (2026-07-21)

**All 20 fixtures here are pinned by `src/test/test-secrets-exposure-prefilter.ts`, wired into `test:ci`.** Read this before editing, renaming, or deleting any of them: the gate asserts exact manifest coverage, so a rename fails loud rather than silently shrinking coverage. That is deliberate.

**What the pins are, and what they are NOT.** Each positive pins the `ruleId` (`secrets-exposure-<patternId>`) the Option G regex bypass must emit, plus `critical`/`high` and exactly one finding. Each negative pins the exact `preFilterReason` of its pre-model drop. These are **wiring samples, not verdict endorsements**. The gate proves the bypass emits the finding it claims to emit; it says nothing about whether that finding is correct. Detection quality is stage 3.

**Measured split (by executing the detector keylessly, not by reading these descriptions):** 10 bypass positives, 10 pre-model drops (4 `server-only marker`, 5 `no regex match`, 1 `path filter`). Zero fixtures reach the model, because `registry.ts` constructs the detector with `llmValidation` false. Recording cost: $0, since there is no `callClaude` request to record.

**Pattern coverage is partial: 10 of the 15 `PREFILTER_PATTERNS` are exercised.** (SUPERSEDED by the 2026-07-23 note below: all 15 are now exercised. The split recorded here is the measured 2b.5 state, kept as history.) Five are guarded by nothing, in two measured ways:
- **SHADOWED** (matched, but never the earliest surviving trigger, so an added assertion cannot reach them; they need NEW fixtures whose earliest match is the intended pattern): `aws_secret_literal` (loses to `aws_access_key` in `positive/06-aws-keys-hardcoded.js`), `postgres_url_password` (loses to `password_literal` in `positive/08-postgres-password-client.ts`). Note both are shadowed inside the very fixture named for them.
- **ABSENT** (matched by no fixture at all): `google_api_key`, `stripe_live_publishable`, `private_key_literal`.

**No fixture here is redaction-shaped.** The Day 13 exemption below was validated against 21 ad-hoc cases that were never committed as fixtures, so neither the full-exemption drop nor the partial `redactionSkipCount` path is exercised by anything in this directory. The gate pins that ABSENCE as an invariant rather than asserting over an empty manifest. If you add a redaction-shaped fixture, that invariant fails on purpose: give it a manifest entry and update the gate header.

**F-010 note.** F-010 (secrets-exposure false-positives on an obvious self-identifying placeholder) is OPEN. As measured, no fixture in this corpus exhibits that shape; the values here are realistic high-entropy strings. If a future F-010 fix flips a pinned expectation, update the pin and record why. Never conclude the gate was wrong. There is nothing to re-record: this sub-step has no requests, no responses, and no recordings.

## Day 13 — redaction-shape exemption (2026-05-15, post Step 4)

**Pre-filter matches where the matched value is a redaction artifact are now exempt from finding emission.** See `docs/detector-test-rules.md` D8a for the full shape inventory and rationale. First-instance trigger: Step 4 §7 Twenty `url.password = '********'` FP — detector was flagging the very utility that redacts passwords. Implementation: `REDACTION_VALUE_PATTERNS` in `secrets-exposure.detector.ts`, applied before LLM call (so exemption holds in both regex-only and LLM modes). Verified against 21 cases (11 real Step 4 source-path snippets + 5 synthetic redactions + 3 ambiguous defaults + 2 theoretical TPs): only the one true redaction line flips to skip; all other source-path FPs and theoretical TPs unchanged.

## Day 7 — default behavior flipped (2026-05-15)

**Production-default secrets-exposure runs in regex-only mode (LLM validation disabled by default).** The earlier default (LLM validation on) quoted secret values verbatim into PR comment output, re-exposing the very secrets the finding was flagging. See D8 in `docs/detector-test-rules.md`.

- Each `PREFILTER_PATTERN` ships with a hand-authored `explanation` (identify class + attack surface + remediation). These become the finding's `message` and `explanation` fields when the bypass path runs — which is now the default path.
- LLM mode is preserved as opt-in via `FIXOR_SECRETS_LLM_OPT_IN=true` env var or `{ llmValidation: true }` constructor option. Opting in re-introduces the secret-quoting risk; use only when LLM-specific reasoning shape is required for a deployment.
- The Day 7 pilot validated regex-only mode produces identical fixture verdicts to LLM mode across n=5 (100% RUBBER-STAMP on this detector). The default flip is verdict-preserving and leak-eliminating.

## Positive (real vulnerabilities)
- 01-supabase-service-role-client.tsx: SERVICE_ROLE_KEY referenced in a "use client" component
- 02-next-public-openai.ts: NEXT_PUBLIC_OPENAI_API_KEY bundled into client JS
- 03-firebase-admin-in-component.tsx: firebase-admin private key embedded in a component
- 04-stripe-secret-hardcoded.ts: sk_live_ Stripe key inline in source
- 05-anthropic-key-fallback.ts: hardcoded sk-ant-api03 fallback when env var missing
- 06-aws-keys-hardcoded.js: AWS access + secret key strings in module scope
- 07-config-route-leaks-service-role.ts: /api/config returns SUPABASE_SERVICE_ROLE_KEY
- 08-postgres-password-client.ts: production DB password in client-imported lib
- 09-slack-webhook-hardcoded.py: full Slack incoming webhook URL in source
- 10-jwt-secret-const.go: JWT signing key as a Go const
- 11-google-api-key-hardcoded.ts: AIza... Google API key inline in a client Maps loader (guards `google_api_key`)
- 12-stripe-publishable-live.ts: pk_live_ Stripe publishable key inline in a client-bundled module (guards `stripe_live_publishable`)
- 13-private-key-hardcoded.ts: `privateKey = "..."` signing material inline (guards `private_key_literal`)
- 14-aws-secret-literal.ts: `AWS_SECRET_ACCESS_KEY = "..."` with NO AKIA id present, so `aws_secret_literal` wins instead of being shadowed by `aws_access_key` (guards `aws_secret_literal`)
- 15-postgres-url-password.ts: `postgres://user:pass@host` URL with NO `password: "..."` field before it, so `postgres_url_password` wins instead of being shadowed by `password_literal` (guards `postgres_url_password`)

## Negative (looks similar, actually safe)
- 01-supabase-service-role-server-only.ts: SERVICE_ROLE_KEY behind "server-only" import (Category B — context)
- 02-public-config-vars.ts: NEXT_PUBLIC_ values that are legitimately public (anon key, site URL) (Category B — context)
- 03-firebase-admin-server-lib.ts: firebase-admin in src/lib/server with env-loaded creds (Category B — context)
- 04-stripe-in-getserverside.tsx: STRIPE_SECRET_KEY only in getServerSideProps (Category B — context)
- 05-stripe-test-keys-fixtures.ts: pk_test_/sk_test_ keys in a *.test.ts fixture (Category A — location)
- 06-aws-keys-from-env.js: AWS creds read from process.env at boot, fail-fast if missing (Category B — context)
- 07-anthropic-server-only.ts: Anthropic client initialized in a "server-only" module (Category B — context)
- 08-secrets-decrypted-from-kms.ts: secrets read encrypted at rest, decrypted via KMS at boot (Category B — context)
- 09-slack-webhook-from-env.py: SLACK_OPS_WEBHOOK loaded from os.environ (Category B — context)
- 10-jwt-secret-from-env.go: JWT signing key initialized from env in init() (Category B — context)

## PR B - prefilter pattern coverage completed (2026-07-23)

**All 15 `PREFILTER_PATTERNS` are now exercised by a fixture (was 10 of 15 at 2b.5).** Five positives were added (`positive/11-google-api-key-hardcoded.ts`, `positive/12-stripe-publishable-live.ts`, `positive/13-private-key-hardcoded.ts`, `positive/14-aws-secret-literal.ts`, `positive/15-postgres-url-password.ts`), each pinned in `src/test/test-secrets-exposure-prefilter.ts`. The corpus is now 25 fixtures: 15 Option G bypass positives, 10 pre-model drops.

**Measured, not read.** Each new fixture was run through the shipped-default detector keylessly (no key, `FIXOR_REPLAY=1` against an empty root). Every one produced exactly one hit whose earliest surviving trigger is the intended pattern, emitting `secrets-exposure-<patternId>` at critical/high with zero `callClaude` attempts:

| fixture | measured patternId | measured preFilterReason |
|---|---|---|
| positive/11-google-api-key-hardcoded.ts | `google_api_key` | `llm-bypass` |
| positive/12-stripe-publishable-live.ts | `stripe_live_publishable` | `llm-bypass` |
| positive/13-private-key-hardcoded.ts | `private_key_literal` | `llm-bypass` |
| positive/14-aws-secret-literal.ts | `aws_secret_literal` | `llm-bypass` |
| positive/15-postgres-url-password.ts | `postgres_url_password` | `llm-bypass` |

**How the two formerly SHADOWED patterns were reached.** `aws_secret_literal` and `postgres_url_password` each lost to an earlier-line pattern inside the very fixture named for them (`positive/06`, `positive/08`), which still stand. The new fixtures isolate them by removing the shadowing pattern from the file entirely, not by reordering: `positive/14` carries no AKIA access-key id, so `aws_access_key` never fires; `positive/15` carries no `password: "..."` field before the connection string, so `password_literal` never fires. Fixtures `06` and `08` are unchanged and still emit under their earlier-winning patterns.

**Unchanged invariants.** No new fixture is redaction-shaped, none sets `redactionSkipCount`, and none carries an unknown `patternId`; the three corpus-absence invariants still pass. Detection quality is still out of scope here (stage 3). Values are synthetic and live under `fixtures/`, which both the gitleaks allowlist and `scripts/secrets_scan.py` skip.
