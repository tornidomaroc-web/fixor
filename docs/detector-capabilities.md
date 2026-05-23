# Fixor detector capabilities — scope contract

## What this file is

This document is the authoritative scope contract for what Fixor's detectors do and do not detect. **Any public surface — landing page, README, mintlify docs, marketplace listing, outreach copy, blog posts, sales conversations — must not claim capability beyond what is enumerated here.** When in doubt, this file wins.

The contract has three goals:

1. **Pin the wedge.** Six business-logic vulnerability classes in Node/TypeScript. Anything outside this list is "not yet," not "soon."
2. **Make negative claims first-class.** The "does not claim" rows protect us when a sophisticated reviewer asks "does Fixor handle X?" — the honest answer needs to be reachable, not buried.
3. **Tie claims to measured baselines.** Every CLAIMS row is backed by fixture pass counts saved in `test-output/`. If a baseline is missing, the claim is degraded to "shipping but unbaselined."

## How to read each detector entry

- **CLAIMS** — what the detector will catch today, enumerated concretely (specific patterns, libraries, frameworks, languages where applicable).
- **DOES NOT CLAIM** — what the detector will not catch, enumerated concretely. If a customer asks "does it catch X" and X isn't on either side, the honest answer is "we haven't validated that, so no."
- **Measured baseline** — fixture pass count + the on-disk log it came from. Format: `positives_passed / negatives_skipped (combined / threshold)`. "Inline post-PR-N" means a test run captured in conversation, not yet saved as a baseline log (re-baseline pending).

---

## Detectors

### 1. auth-bypass (`auth-bypass-multi`)

**CLAIMS:**
- **Sentinel-string bypasses** in TS/JS/Python/Go/Ruby: hardcoded `"anonymous"`/`"admin"`/`"public"` defaults, `|| true`, `|| "admin"`, `?? "admin"`, JWT verification swallowed inside try/catch, `verify_signature=False` (Python), `DEFAULT_USER_ID` / `DEFAULT_ADMIN_ID` / `DEFAULT_ADMIN_EMAIL` fallbacks, Ruby `params[:x] || "admin"`.
- **Missing-middleware bypasses** on Express-family routers: a destructive route declaration (`router.post("/users/delete", handler)`, `adminRouter.delete("/x", handler)`) with no authentication middleware in the argument list, where sibling routes on the same router DO pass an auth middleware. Pattern matches literal `router`/`app`/`api` identifiers OR any identifier ending in `Router`/`App`/`Api`. Verbs covered: `get`/`post`/`put`/`delete`/`patch`/`use`/`all`. String-literal-path first arg required.
- **Missing-HOC-wrapper bypasses** on Next.js App Router / Remix file-system-routed handlers: a destructive route exported as `export const POST = ...` / `export async function GET(...)` / `export default function PUT(...)` with NO higher-order function wrapper whose NAME convention suggests auth/admin enforcement (recognized as gated: `withAuth`, `withAdmin`, `requireAuth`, `requireAdmin`, `protect`, `secure`, `authMiddleware`, or any identifier containing `auth` or `admin` as a substring; HOCs with `session` in the name count as gating ONLY when the handler body uses the session value for an authorization decision — 401 on missing session, or ownership filter keyed on `session.user.id` — and a session-substring HOC whose body merely sets a tracking cookie or fires analytics is NOT gating) AND no inline auth check in the handler body. The LLM stage performs the HOC-name-convention judgment; generic-named wrappers (`withRoute(...)`, `appWrapper(...)`) that hide auth invisibly are treated as unguarded by default. **Synthetic calibration:** Phase C measured 3 positive + 3 negative App Router fixtures, all 6/6 passed (log: `test-output/auth-bypass-app-router-phase-c-posttune.log`). Phase D added 2 positive + 2 negative fixtures exercising unfamiliar ApiKey-suffix wrapper names (`withAccountApiKey`, `withStatsApiKey`) that do not match the `auth`/`admin` substring rule. Phase D ApiKey-pair result: POS-16 flagged HIGH, NEG-15 and NEG-16 both correctly skipped; POS-15 returned MEDIUM confidence and was suppressed to the review queue per HIGH-only emit policy — the harness records this as a positive miss because it expected FLAG, but the LLM's reasoning was correct ("blindly deletes any label by `body.labelId` without an ownership filter"), so we accept POS-15's MEDIUM result as intended conservative behavior on unfamiliar wrapper-name + no-body-enforcement, NOT as a relabel of the fixture's expected outcome (the baseline number stays 31/32, not 32/32). The body-discriminator rule generalizes from session-substring HOCs to non-enumerated wrapper-context auth shapes — `request.apiAuth.emailAccountId` scope-filtering recognized as gating without name enumeration. **Customer-facing UX consequence: routes wrapped in unfamiliar ApiKey-suffix HOCs with no body enforcement surface at MEDIUM in the review queue, not as HIGH alerts in the main panel.** Phase D ApiKey-pair log: `test-output/auth-bypass-phase-d-api-key-fixtures.log`. **Real-world partial measurement:** the inbox-zero scan halted at **182 of 228 App Router routes (~80%, PARTIAL scan, halted for API budget after $5-7 burn against the CLI's $2.74 estimate — not a full-corpus sweep)**. Across the scanned 182 routes: **0 auth-bypass findings**, including all measured `withAuth` / `withAdmin` / `withEmailAccount` / `withEmailProvider` / `withError` wrapper shapes. Session-tightening rule held across 21 measured `withEmailAccount` instances; not measured at full corpus density — the unscanned 46 routes contain 45 additional `withEmailAccount` instances, so the rule was tested at ~32% of the corpus's `withEmailAccount` usage (21 of 66). Real-world log: `test-output/inbox-zero-api-scan-phase-d.stdout.log`.

**DOES NOT CLAIM:**
- Fastify, Koa, Hono, NestJS Guards/Interceptors, Spring `@PreAuthorize`/`@Secured`, ASP.NET `[Authorize]`, GraphQL resolver-level auth.
- Declarative auth (Rails `routes.rb` `authenticated do ... end`).
- tRPC `protectedProcedure`, Next.js middleware-based auth, edge-runtime auth.
- Auth gating applied via `router.use()` at file scope when the relevant `use()` call lives in a different file than the route declaration (the prefilter sees the route file in isolation).
- File-system-routed framework handlers wrapped in generic-named HOCs that hide auth invisibly — e.g., `export const POST = withRoute(handler)` where `withRoute` is not auth-suggesting by name but actually enforces auth in a sibling file. The HOC-name-convention judgment treats these as unguarded by default; cross-file analysis to verify what `withRoute` does is out of scope. Same shape as the Express `router.use(authMiddleware)`-in-a-different-file limitation above.
- Customer wrappers whose NAME suggests auth but whose IMPLEMENTATION is a no-op stub. A wrapper named `withAuth`, `withAdmin`, `requireAuth`, etc. whose implementation in its defining module is `(fn) => fn` (or any other no-op identity passthrough) ships unguarded — Fixor reads the route file in isolation, trusts the auth-suggesting name, judges as gated. Same shape as the cross-file `router.use(authMiddleware)` limitation above, applied to the HOC-stub variant. To verify, audit the wrapper's implementation in its defining file.

**Measured baseline:** 31/32 (97%) post-Phase-D — log: `test-output/auth-bypass-phase-d-api-key-fixtures.log` (Phase D ApiKey pair added 2026-05-23: 15/16 positives caught + 16/16 negatives skipped, overall PASS per the harness's asymmetric criterion). **POS-15 is the one harness-recorded positive miss**: it returned MEDIUM confidence (suppressed to review queue) rather than the expected FLAG. We accept POS-15's MEDIUM result as intended conservative behavior on unfamiliar wrapper-name + no body enforcement, but we do NOT relabel the fixture's expected outcome to make the number look like 32/32 — the baseline number stays 31/32 and this row footnotes why. POS-16 flagged HIGH; NEG-15 and NEG-16 both skipped correctly. Phase C 28/28 baseline preserved at `test-output/auth-bypass-app-router-phase-c-posttune.log` for historical comparison. Pre-Phase-C Express-only baseline preserved at `test-output/auth-bypass-post-pr53-baseline.log`. Real-world partial measurement: `test-output/inbox-zero-api-scan-phase-d.stdout.log` — 182 of 228 inbox-zero App Router routes scanned (PARTIAL, halted for budget), 0 auth-bypass findings on the scanned 182; not a full-corpus sweep.

---

### 2. admin-check (`admin-check-multi`)

**CLAIMS:**
- **Hardcoded-admin shapes** in TS/JS/Python/Go: `email === "x@y.z"`, `email.endsWith("@domain")`, `email.includes("admin"|"owner"|"founder"|"root"|"superuser")`, Go `strings.HasSuffix(email, "@x")`, `ADMIN_EMAIL` / `admin_email` constants, `ADMIN_EMAILS` / `admin_emails` allowlist arrays, `DEFAULT_ADMIN_ID`, `DEFAULT_ADMIN_EMAIL`, `role || "admin"`, `role ?? "admin"`, `req.body|query|params.<role>` reads, `role === "admin"` string compare on a client-controlled value.
- **Missing-admin-gate shapes** on Express-family routers: a privileged route (role/tier change, user management, billing settings, `/admin/*` paths, privileged toggles) with no admin authorization check anywhere — neither `requireAdmin`/`isAdmin`/`adminOnly`/`verifyAdmin` middleware in the route arglist nor an inline check in the handler body — where sibling routes on the same router ARE admin-gated. Same route-def pattern coverage as auth-bypass.
- **Missing-admin-HOC-wrapper shapes** on Next.js App Router / Remix file-system-routed handlers: a privileged route exported as `export const PUT = ...` / `export async function POST(...)` / `export default function DELETE(...)` performing an administrative action (same destructive shapes as Express missing-admin-gate) AND wrapped in NO admin-suggesting HOC (recognized as gated: `withAdmin`, `requireAdmin`, `adminOnly`, `isAdmin`, `verifyAdmin`, `withAdminAuth`, `withRole("admin", ...)`, or any HOC identifier containing `admin` as a substring) AND no inline admin authorization check in the handler body AND no admin-suggesting helper call invoked in the body before the privileged operation (recognized as gating: helper-function identifiers like `requireAdmin`, `requireAdminRole`, `assertAdmin`, `checkAdmin`, `enforceAdminRole`, or any helper-call identifier containing `admin` as a substring; non-admin helper calls like `logAccess()`, `recordEvent()`, `trackRequest()`, or `withRateLimit()` do NOT count as gating even when invoked before the privileged op). General auth HOCs (`withAuth`, `requireAuth`, `withSession`, `protect`) are NOT sufficient — they enforce authentication, not admin authorization. **Synthetic calibration:** Phase C measured 4 positive + 4 negative App Router fixtures, all 8/8 passed (AC-P4/AC-N4 anchor the new helper-call name-convention rule symmetrically; log: `test-output/admin-check-app-router-phase-c-posttune.log`). **Real-world partial measurement:** the inbox-zero scan halted at **182 of 228 App Router routes (~80%, PARTIAL scan, halted for API budget — not a full-corpus sweep)**. Across the scanned 182 routes: **0 admin-check findings**, including the corpus's `admin/*` routes. Helper-call rule (AC-P4/AC-N4 anchor) held end-to-end on real OSS within the scanned 80%. Real-world log: `test-output/inbox-zero-api-scan-phase-d.stdout.log`.

**DOES NOT CLAIM:**
- Fastify, Koa, Hono, NestJS Guards, Spring `@PreAuthorize`, decorator-based RBAC (Python decorators, TS decorators outside Express).
- Declarative RBAC (Casbin policies, OPA, Cedar).
- tRPC `adminProcedure`, GraphQL resolver-level admin checks, Next.js middleware-based admin gating.
- Admin gating applied via `router.use(requireAdmin)` at file scope when the `use()` call lives in a different file than the route declaration.
- File-system-routed framework handlers wrapped in generic-named HOCs that hide admin enforcement invisibly (e.g., `withRoute("admin", handler)` where the admin-ness lives in `withRoute`'s implementation in a sibling file). Same cross-file limitation shape as Express's `router.use(requireAdmin)`-in-a-different-file case above.
- Customer wrappers whose NAME suggests admin but whose IMPLEMENTATION is a no-op stub. A wrapper named `withAdmin`, `requireAdmin`, `adminOnly`, etc. whose implementation is `(fn) => fn` ships unguarded — Fixor trusts the admin-suggesting name. Same cross-file analysis limitation as the auth-bypass deceptive-stub class above.

**Measured baseline:** 30/30 (100%) — log: `test-output/admin-check-app-router-phase-c-posttune.log` (Phase C post-tune, 2026-05-23: 11 Express + 4 App Router positives all flagged, 11 Express + 4 App Router negatives all correctly skipped). Pre-Phase-C Express-only baseline preserved at `test-output/admin-check-post-pr53-baseline.log` for historical comparison. Real-world partial measurement added 2026-05-23: `test-output/inbox-zero-api-scan-phase-d.stdout.log` — 182 of 228 inbox-zero App Router routes scanned (PARTIAL, halted for budget), 0 admin-check findings on the scanned 182; not a full-corpus sweep.

---

### 3. IDOR (`idor-multi`)

**CLAIMS:**
- DB read/write where a request-derived id (`req.params.id`, `req.body.id`, tRPC `input.id`, FastAPI path param, Rails `params[:id]`, Go chi `chi.URLParam`) flows into a query (`findUnique`, `findFirst`, `update`, `delete`, raw SQL, `pool.query`) with no ownership filter (`userId: ctx.session.user.id` or equivalent) in the `where` clause and no post-fetch ownership check.
- Router frameworks covered by fixtures: Express, Next.js App Router (both Next.js 14 destructured-params `{ params: { id: string } }` and Next.js 15+ async-params `{ params: Promise<{ id: string }> }` shapes — the latter added 2026-05-23 after Phase A surfaced the regex gap), Fastify (Hono via fixture), tRPC, NestJS, FastAPI, Rails, Go chi with raw SQL.

**DOES NOT CLAIM:**
- IDOR via predictable filenames in storage paths (S3, GCS object IDs).
- Tenant-scoping bugs (`orgId` missing instead of `userId`).
- GraphQL field-level IDOR.
- Business-logic IDOR ("user can change another user's email by knowing the email").
- TOCTOU race conditions on ownership checks.

**Measured baseline:** 16/16 (log: `test-output/idor-day4-run.log`).

---

### 4. env-exposure (`env-exposure-multi`)

**CLAIMS:**
- `process.env` serialized into HTTP response body (Express `res.json(process.env)`, Fastify, Flask `jsonify`, FastAPI).
- `JSON.stringify(process.env)` in logger payload.
- Go `os.Environ()` / `os.LookupEnv` echoed in handler response.
- Partial-redaction patterns with allowlist gaps.

**DOES NOT CLAIM:**
- Env vars leaking via error stack traces.
- Env vars in build-time bundles (Next.js `NEXT_PUBLIC_*` overlap is owned by secrets-exposure).
- Env vars leaked in webhook payloads to third-party services.
- Env vars logged at startup.
- Env vars baked into Docker image layers.

**Measured baseline:** 18/20 (log: `test-output/env-exposure-day5-r6-rerun.log`).

---

### 5. secrets-exposure (`secrets-exposure-multi`)

**CLAIMS:**
- Hardcoded API key / token / signing-secret literals: Stripe `sk_live_*`, OpenAI `sk-*`, Anthropic `sk-ant-api03-*`, AWS `AKIA[A-Z0-9]{16}`, Slack webhook URLs, Postgres passwords in connection strings, hardcoded JWT signing secrets in source.
- `NEXT_PUBLIC_*` exposing server secrets to client bundle.
- Supabase service-role key reaching client-side code.
- Firebase admin SDK creds in client components.

**DOES NOT CLAIM:**
- Secrets in git history (only present-tree files are scanned).
- Secrets in build outputs / bundles after the build runs (only source code, not artifacts).
- Secrets in `.env*` files (path-skipped).
- Secrets in test fixtures (path-skipped).
- Secrets stored in third-party config systems (Vault, AWS Secrets Manager) and incorrectly retrieved.
- Encryption-at-rest issues.

**Measured baseline:** 20/20 (log: `test-output/secrets-exposure-pilot-baseline.log`).

---

### 6. webhook-unverified (`webhook-unverified-multi`)

**CLAIMS:**
- Webhook handler routes for `/webhook`, `/hook`, `/hooks` in Express/Fastify-style routers, Flask decorators (`@bp.post`), Rails `post` routes, and Go `HandleFunc` / named `*Webhook*` handlers.
- Detects: no signature verification at all; explicit env-flag bypass of verification (e.g. `WEBHOOK_VERIFY=off` short-circuits `constructEvent`); raw string-compare of signatures (`sig != expected`, classified MEDIUM as a timing-leak — see precision note below).
- Correctly recognizes (and skips) verification done via: `stripe.webhooks.constructEvent` / `stripe.Webhook.construct_event`, `@octokit/webhooks` + `createNodeMiddleware`, `twilio.validateRequest`, `crypto.timingSafeEqual`, Python `hmac.compare_digest`, Go `subtle.ConstantTimeCompare`, Go `hmac.Equal`, dedicated verification middleware mounted before the handler.
- Providers covered by fixtures: Stripe, GitHub, Twilio, Slack, Lemon Squeezy, custom HMAC.
- **Next.js App Router and Remix file-system-routed webhook handlers** (`export async function POST(req)` at `app/api/<provider>/webhook/route.ts` or similar): the new App Router prefilter pattern routes every file-system-routed handler to the LLM, which then judges webhook-vs-not by file path (`/webhook/`, `/hooks/`, `/webhooks/` segment), webhook-library imports, signature-header reads (`stripe-signature`, `x-hub-signature`, `x-webhook-signature`, etc.), or `node:crypto` hash/HMAC operations whose output is compared against an incoming signature header. Hash outputs that flow into non-signature sinks (cache lookup, object-storage put, ETag header set, dedup-table insert, audit-log column, request fingerprinting for rate-limit memoization, content-addressed routing, etc.) are NOT webhook signals — Phase C tuned this distinction explicitly. Non-webhook App Router routes return LOW confidence and are not flagged. **Synthetic calibration:** Phase C measured 3 positive + 3 negative App Router fixtures, all 6/6 passed — including WH-P3 (custom-URL with `x-webhook-signature` header read, the symmetric webhook-recognition true-positive anchor) and WH-N1 (cache-key hashing, the load-bearing false-positive class). Baseline log: `test-output/webhook-unverified-app-router-phase-c-posttune.log`. **Real-world partial measurement:** the inbox-zero scan halted at **182 of 228 App Router routes (~80%, PARTIAL scan, halted for API budget — not a full-corpus sweep)**. Across the scanned 182 routes: **2 webhook_unverified findings**, both classified TRUE-POSITIVE-BY-RULE / FALSE-POSITIVE-BY-CONTEXT under documented limitations (see DOES NOT CLAIM rows below). The two findings are `apple/webhook/route.ts` (limitation class (c) cross-file verifier helper — verification delegated to `verifyAppleNotificationPayload` in `@/ee/billing/apple`) and `outlook/webhook/route.ts:59` (limitation class (d) non-HMAC shared-secret challenge — Microsoft Graph `clientState` equality comparison). Both classes are documented limitations, not calibration regressions. Real-world log: `test-output/inbox-zero-api-scan-phase-d.stdout.log`.

**DOES NOT CLAIM:**
- Replay-protection issues independent of signature verification (timestamp window, nonce reuse).
- Key rotation / multi-secret handling.
- mTLS-based webhook auth (e.g., AWS API Gateway client certs).
- Providers not in prefilter or fixtures: Shopify (`X-Shopify-Hmac-Sha256`), Discord interactions (Ed25519), Mailgun, SendGrid, AWS SNS subscription confirmation, GCP Pub/Sub push (OIDC token), Square, PayPal, Paddle, Plaid, Algolia, Cloudflare Workers signed requests.
- **Critical scope limitations** (residual, post-App-Router prefilter extension):
  - **(a) Express-style URLs that don't carry the webhook/hook/hooks token.** The 5 router-style URL-name prefilter patterns still require the webhook URL string to appear in file content alongside router syntax. A real Stripe handler mounted at `app.post("/billing/events", ...)` (Stripe allows any URL) is invisible to those patterns and never reaches the LLM via the Express path. The App Router prefilter does NOT compensate (App Router uses different syntax). Affected: Express / Flask / Rails / Go custom-URL webhook handlers.
  - **(b) Non-App-Router DIY-HMAC handlers that are silent.** An Express / Flask / Rails / Go custom-HMAC handler that imports no webhook library AND exhibits no signature-comparison anti-pattern is still invisible to the content prefilter. App Router DIY-HMAC handlers ARE now reached by the LLM via the new `app_router_route_def` prefilter, where Phase A measured them silently skipped; Phase C calibrated the LLM's gated-vs-unguarded judgment on 3 positive + 3 negative synthetic App Router fixtures (see CLAIMS-row baseline log above). Phase D real-world partial measurement on 182 of 228 inbox-zero App Router routes (PARTIAL, halted for budget) returned 2 findings, both of documented-limitation classes (c) and (d) below. The same DIY-HMAC shape on Express / Flask / Rails / Go remains a residual content-prefilter gap regardless of Phase B or C.
  - **(c) Cross-file webhook verification helpers.** App Router webhook routes that delegate verification to a helper imported from another module (e.g., `await verifyXyzPayload(body.signedPayload)` from `@/ee/billing/xyz`) will be flagged as missing verification by the route-file-in-isolation prefilter + LLM stage. Measured in Phase D against inbox-zero's Apple App Store Server Notifications handler — the route DOES verify (delegated to `verifyAppleNotificationPayload` in `@/ee/billing/apple`), Fixor flags it because the verification logic is not visible in the route file. Cross-file analysis to inspect the helper's implementation is out of scope (analogous to the cross-file `router.use(authMiddleware)` limitation in auth-bypass).
  - **(d) Non-HMAC shared-secret challenge verification.** Webhook handlers using shared-secret challenge mechanisms instead of HMAC signature verification — notably **Microsoft Graph webhooks** (compare `notification.clientState` against an env-stored expected value, 403 on mismatch) — will be flagged as missing verification. The Phase C webhook prompt's sink-principle recognizes HMAC-shape verification (hash output flowing to incoming-signature comparison) but does not recognize equality-comparison of a shared-secret string. Measured in Phase D against inbox-zero's Outlook (Microsoft Graph) webhook handler at `outlook/webhook/route.ts:59`. Other shared-secret challenge mechanisms (custom integrations, internal services) will surface in the same shape.

**Precision note (cross-detector):** MEDIUM-confidence findings (timing-leak comparisons, env-flag-conditional bypass) are routed to the internal review queue via `logger.warn` with `category: "webhook-unverified-review-queue"`, NOT emitted as a PR-comment finding. This matches the HIGH-only emit policy used by the other 5 detectors. If a customer asks "will Fixor flag a Stripe handler that toggles signature verification on/off via an env flag?", the honest answer is *"flagged in the review queue, not in the PR comment, by current policy."*

**Measured baseline:** 24/26 (Phase C post-tune; log: `test-output/webhook-unverified-app-router-phase-c-posttune.log`, 2026-05-23: 8/10 Express positives flagged plus 3/3 App Router positives flagged — the 2 Express MEDIUM-suppressed cases (`04-stripe-verify-toggle`, `10-go-github-eq-compare`) are routed to the review queue per existing HIGH-only emit policy and are out of Phase C scope, unchanged from Phase B — and 10/10 Express + 3/3 App Router negatives all correctly skipped). Pre-Phase-C Express-only baseline preserved at `test-output/webhook-unverified-baseline.log` for historical comparison. Real-world partial measurement added 2026-05-23: `test-output/inbox-zero-api-scan-phase-d.stdout.log` — 182 of 228 inbox-zero App Router routes scanned (PARTIAL, halted for budget), 2 findings (`apple/webhook` cross-file verifier, `outlook/webhook:59` non-HMAC shared-secret), both classified as documented-limitation classes (c) and (d) above; not a full-corpus sweep.

---

## Out of scope across the board

Independent of any specific detector, Fixor explicitly does not:

- **Replace SAST.** No SQL injection / XSS / command injection / path traversal scanning (those detectors are suppressed at output time — see `src/config/finding-suppressions.ts`).
- **Replace dependency scanning.** No CVE / SCA / supply-chain detection. Snyk and Dependabot remain authoritative.
- **Replace secret scanning of git history.** GitHub native secret scanning, gitleaks, etc. cover history; Fixor scans the present-tree diff.
- **Cover infrastructure-as-code or container security.** No Terraform, no Kubernetes manifests, no Dockerfile scanning.
- **Provide compliance certification.** SOC 2 / ISO 27001 outputs require their own controls; Fixor's PDF/SARIF outputs are evidence inputs to a compliance program, not compliance themselves.
- **Route-based detection is scoped along two axes — language and framework shape — both matter.**
  - **Language:** auth-bypass's missing-middleware / missing-HOC-wrapper sub-claims and admin-check's missing-admin-gate / missing-admin-HOC-wrapper sub-claims are JS/TS only today. Their sentinel-string and hardcoded-admin sub-claims are content-based and run across the languages listed in their CLAIMS rows. IDOR, env-exposure, secrets-exposure, and webhook-unverified have broader language coverage as enumerated in their CLAIMS rows.
  - **Framework shape:** auth-bypass and admin-check cover BOTH router-style (`router.METHOD(path, handlers...)` — Express family) AND **Next.js App Router** method-named exports (`export const POST = ...` / `export async function GET(...)`) via two sibling prefilter patterns (`express_route_def`, `app_router_route_def`). The router-style sub-claim has full baselines (`test-output/auth-bypass-post-pr53-baseline.log`, `test-output/admin-check-post-pr53-baseline.log`); the App Router sub-claim has Phase C synthetic calibration baselines (see per-detector CLAIMS rows) PLUS a Phase D real-world partial measurement against 182 of 228 inbox-zero App Router routes (~80%, PARTIAL scan, halted for API budget; log: `test-output/inbox-zero-api-scan-phase-d.stdout.log`). **Remix `loader` / `action` exports are NOT covered by the current `app_router_route_def` prefilter** — the regex matches HTTP-method names only (`GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS`), not `loader` / `action`. Phase D measured this statically against the Trigger.dev webapp (411 Remix routes, 0 prefilter matches); the silent-miss property is structurally verified (prefilter miss → no LLM call → no crash). Phase E scope: extend the regex to recognize `(loader|action)` alternations once Remix-specific calibration fixtures and a real-world Remix baseline are added. webhook-unverified covers Express + Next.js App Router shapes via the same prefilter addition plus an LLM-stage webhook-vs-not judgment driven by file path metadata / `node:crypto` HMAC / signature header reads — see the webhook-unverified "Critical scope limitations" section above for the four residual gaps (a) URL-in-content, (b) DIY-HMAC silent on non-App-Router, (c) cross-file verifier helpers, (d) non-HMAC shared-secret challenge. IDOR, env-exposure, and secrets-exposure are framework-shape independent by design (content-based detection with framework-aware patterns including IDOR's `nextjs_destructured` — extended 2026-05-23 to cover Next.js 15+ async-params — and secrets-exposure's `NEXT_PUBLIC_*`); their CLAIMS rows enumerate the verified patterns and their content-based detection still runs on Remix file content normally.

## Cross-detector overlap

`scan.ts` includes a deterministic post-filter: if `admin-check` fires on a `file:line` where `auth-bypass` also fires, the `admin-check` finding is dropped (the auth-bypass finding subsumes it — "no auth at all" is strictly worse than "no admin gate" and the remediation is the same). This is the only inter-detector dependency in the pipeline; all other detectors run independently and their findings are reported independently.

## When this file changes

Three rules:

1. **Adding a CLAIMS row** requires a positive fixture in `fixtures/<detector>/positive/` and at least one negative-control fixture in `fixtures/<detector>/negative/` exercising the new pattern. The fixture suite must pass a fresh baseline run before the CLAIMS row is added.
2. **Adding a DOES NOT CLAIM row** can ship ahead of code — it's a credibility-defending negative claim, not a capability claim. Add it the moment a real customer or reviewer raises the question, so the next reviewer doesn't have to re-ask.
3. **Promoting a detector to the wedge** (going from N to N+1 advertised classes) requires (a) a saved baseline log in `test-output/`, (b) a new CLAIMS / DOES NOT CLAIM row in this file, and (c) an audit of every customer-facing surface so the count stays consistent. See the audit pattern used in PR #54 (`docs/promote-webhook-unverified-6-class-wedge`).

If a public surface contradicts this file, this file wins and the public surface is the bug.
