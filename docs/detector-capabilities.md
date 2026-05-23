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
- **Missing-HOC-wrapper bypasses** on Next.js App Router / Remix file-system-routed handlers: a destructive route exported as `export const POST = ...` / `export async function GET(...)` / `export default function PUT(...)` with NO higher-order function wrapper whose NAME convention suggests auth/admin enforcement (recognized as gated: `withAuth`, `withAdmin`, `requireAuth`, `requireAdmin`, `protect`, `secure`, `authMiddleware`, or any identifier containing `auth` or `admin` as a substring; HOCs with `session` in the name count as gating ONLY when the handler body uses the session value for an authorization decision — 401 on missing session, or ownership filter keyed on `session.user.id` — and a session-substring HOC whose body merely sets a tracking cookie or fires analytics is NOT gating) AND no inline auth check in the handler body. The LLM stage performs the HOC-name-convention judgment; generic-named wrappers (`withRoute(...)`, `appWrapper(...)`) that hide auth invisibly are treated as unguarded by default. **App Router calibration measured on 3 positive + 3 negative synthetic fixtures (Phase C post-tune): all 3 positives correctly flagged, all 3 negatives correctly skipped. Baseline log: `test-output/auth-bypass-app-router-phase-c-posttune.log`. Synthetic fixtures only; real-world OSS re-measurement deferred to Phase D.**

**DOES NOT CLAIM:**
- Fastify, Koa, Hono, NestJS Guards/Interceptors, Spring `@PreAuthorize`/`@Secured`, ASP.NET `[Authorize]`, GraphQL resolver-level auth.
- Declarative auth (Rails `routes.rb` `authenticated do ... end`).
- tRPC `protectedProcedure`, Next.js middleware-based auth, edge-runtime auth.
- Auth gating applied via `router.use()` at file scope when the relevant `use()` call lives in a different file than the route declaration (the prefilter sees the route file in isolation).
- File-system-routed framework handlers wrapped in generic-named HOCs that hide auth invisibly — e.g., `export const POST = withRoute(handler)` where `withRoute` is not auth-suggesting by name but actually enforces auth in a sibling file. The HOC-name-convention judgment treats these as unguarded by default; cross-file analysis to verify what `withRoute` does is out of scope. Same shape as the Express `router.use(authMiddleware)`-in-a-different-file limitation above.

**Measured baseline:** 28/28 (100%) — log: `test-output/auth-bypass-app-router-phase-c-posttune.log` (Phase C post-tune, 2026-05-23: 11 Express + 3 App Router positives all flagged, 11 Express + 3 App Router negatives all correctly skipped). Pre-Phase-C Express-only baseline preserved at `test-output/auth-bypass-post-pr53-baseline.log` for historical comparison. Synthetic fixtures only; real-world OSS re-measurement deferred to Phase D.

---

### 2. admin-check (`admin-check-multi`)

**CLAIMS:**
- **Hardcoded-admin shapes** in TS/JS/Python/Go: `email === "x@y.z"`, `email.endsWith("@domain")`, `email.includes("admin"|"owner"|"founder"|"root"|"superuser")`, Go `strings.HasSuffix(email, "@x")`, `ADMIN_EMAIL` / `admin_email` constants, `ADMIN_EMAILS` / `admin_emails` allowlist arrays, `DEFAULT_ADMIN_ID`, `DEFAULT_ADMIN_EMAIL`, `role || "admin"`, `role ?? "admin"`, `req.body|query|params.<role>` reads, `role === "admin"` string compare on a client-controlled value.
- **Missing-admin-gate shapes** on Express-family routers: a privileged route (role/tier change, user management, billing settings, `/admin/*` paths, privileged toggles) with no admin authorization check anywhere — neither `requireAdmin`/`isAdmin`/`adminOnly`/`verifyAdmin` middleware in the route arglist nor an inline check in the handler body — where sibling routes on the same router ARE admin-gated. Same route-def pattern coverage as auth-bypass.
- **Missing-admin-HOC-wrapper shapes** on Next.js App Router / Remix file-system-routed handlers: a privileged route exported as `export const PUT = ...` / `export async function POST(...)` / `export default function DELETE(...)` performing an administrative action (same destructive shapes as Express missing-admin-gate) AND wrapped in NO admin-suggesting HOC (recognized as gated: `withAdmin`, `requireAdmin`, `adminOnly`, `isAdmin`, `verifyAdmin`, `withAdminAuth`, `withRole("admin", ...)`, or any HOC identifier containing `admin` as a substring) AND no inline admin authorization check in the handler body AND no admin-suggesting helper call invoked in the body before the privileged operation (recognized as gating: helper-function identifiers like `requireAdmin`, `requireAdminRole`, `assertAdmin`, `checkAdmin`, `enforceAdminRole`, or any helper-call identifier containing `admin` as a substring; non-admin helper calls like `logAccess()`, `recordEvent()`, `trackRequest()`, or `withRateLimit()` do NOT count as gating even when invoked before the privileged op). General auth HOCs (`withAuth`, `requireAuth`, `withSession`, `protect`) are NOT sufficient — they enforce authentication, not admin authorization. **App Router calibration measured on 4 positive + 4 negative synthetic fixtures (Phase C post-tune; AC-P4/AC-N4 anchor the new helper-call name-convention rule symmetrically): all 4 positives correctly flagged, all 4 negatives correctly skipped. Baseline log: `test-output/admin-check-app-router-phase-c-posttune.log`. Synthetic fixtures only; real-world OSS re-measurement deferred to Phase D.**

**DOES NOT CLAIM:**
- Fastify, Koa, Hono, NestJS Guards, Spring `@PreAuthorize`, decorator-based RBAC (Python decorators, TS decorators outside Express).
- Declarative RBAC (Casbin policies, OPA, Cedar).
- tRPC `adminProcedure`, GraphQL resolver-level admin checks, Next.js middleware-based admin gating.
- Admin gating applied via `router.use(requireAdmin)` at file scope when the `use()` call lives in a different file than the route declaration.
- File-system-routed framework handlers wrapped in generic-named HOCs that hide admin enforcement invisibly (e.g., `withRoute("admin", handler)` where the admin-ness lives in `withRoute`'s implementation in a sibling file). Same cross-file limitation shape as Express's `router.use(requireAdmin)`-in-a-different-file case above.

**Measured baseline:** 30/30 (100%) — log: `test-output/admin-check-app-router-phase-c-posttune.log` (Phase C post-tune, 2026-05-23: 11 Express + 4 App Router positives all flagged, 11 Express + 4 App Router negatives all correctly skipped). Pre-Phase-C Express-only baseline preserved at `test-output/admin-check-post-pr53-baseline.log` for historical comparison. Synthetic fixtures only; real-world OSS re-measurement deferred to Phase D.

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
- **Next.js App Router and Remix file-system-routed webhook handlers** (`export async function POST(req)` at `app/api/<provider>/webhook/route.ts` or similar): the new App Router prefilter pattern routes every file-system-routed handler to the LLM, which then judges webhook-vs-not by file path (`/webhook/`, `/hooks/`, `/webhooks/` segment), webhook-library imports, signature-header reads (`stripe-signature`, `x-hub-signature`, `x-webhook-signature`, etc.), or `node:crypto` hash/HMAC operations whose output is compared against an incoming signature header. Hash outputs that flow into non-signature sinks (cache lookup, object-storage put, ETag header set, dedup-table insert, audit-log column, request fingerprinting for rate-limit memoization, content-addressed routing, etc.) are NOT webhook signals — Phase C tuned this distinction explicitly. Non-webhook App Router routes return LOW confidence and are not flagged. **App Router calibration measured on 3 positive + 3 negative synthetic fixtures (Phase C post-tune): all 3 positives correctly flagged — including WH-P3 (custom-URL with `x-webhook-signature` header read, the symmetric webhook-recognition true-positive anchor) — and all 3 negatives correctly skipped — including WH-N1 (cache-key hashing, the load-bearing false-positive class). Baseline log: `test-output/webhook-unverified-app-router-phase-c-posttune.log`. Synthetic fixtures only; real-world OSS re-measurement deferred to Phase D.**

**DOES NOT CLAIM:**
- Replay-protection issues independent of signature verification (timestamp window, nonce reuse).
- Key rotation / multi-secret handling.
- mTLS-based webhook auth (e.g., AWS API Gateway client certs).
- Providers not in prefilter or fixtures: Shopify (`X-Shopify-Hmac-Sha256`), Discord interactions (Ed25519), Mailgun, SendGrid, AWS SNS subscription confirmation, GCP Pub/Sub push (OIDC token), Square, PayPal, Paddle, Plaid, Algolia, Cloudflare Workers signed requests.
- **Critical scope limitations** (residual, post-App-Router prefilter extension):
  - **(a) Express-style URLs that don't carry the webhook/hook/hooks token.** The 5 router-style URL-name prefilter patterns still require the webhook URL string to appear in file content alongside router syntax. A real Stripe handler mounted at `app.post("/billing/events", ...)` (Stripe allows any URL) is invisible to those patterns and never reaches the LLM via the Express path. The App Router prefilter does NOT compensate (App Router uses different syntax). Affected: Express / Flask / Rails / Go custom-URL webhook handlers.
  - **(b) Non-App-Router DIY-HMAC handlers that are silent.** An Express / Flask / Rails / Go custom-HMAC handler that imports no webhook library AND exhibits no signature-comparison anti-pattern is still invisible to the content prefilter. App Router DIY-HMAC handlers ARE now reached by the LLM via the new `app_router_route_def` prefilter, where Phase A measured them silently skipped; Phase C calibrated the LLM's gated-vs-unguarded judgment on 3 positive + 3 negative synthetic App Router fixtures (see CLAIMS-row baseline log above); end-to-end LLM judgment on real-world App Router handlers is a Phase D measurement, not a Phase C claim. The same DIY-HMAC shape on Express / Flask / Rails / Go remains a residual content-prefilter gap regardless of Phase B or C.

**Precision note (cross-detector):** MEDIUM-confidence findings (timing-leak comparisons, env-flag-conditional bypass) are routed to the internal review queue via `logger.warn` with `category: "webhook-unverified-review-queue"`, NOT emitted as a PR-comment finding. This matches the HIGH-only emit policy used by the other 5 detectors. If a customer asks "will Fixor flag a Stripe handler that toggles signature verification on/off via an env flag?", the honest answer is *"flagged in the review queue, not in the PR comment, by current policy."*

**Measured baseline:** 24/26 (Phase C post-tune; log: `test-output/webhook-unverified-app-router-phase-c-posttune.log`, 2026-05-23: 8/10 Express positives flagged plus 3/3 App Router positives flagged — the 2 Express MEDIUM-suppressed cases (`04-stripe-verify-toggle`, `10-go-github-eq-compare`) are routed to the review queue per existing HIGH-only emit policy and are out of Phase C scope, unchanged from Phase B — and 10/10 Express + 3/3 App Router negatives all correctly skipped). Pre-Phase-C Express-only baseline preserved at `test-output/webhook-unverified-baseline.log` for historical comparison. Synthetic fixtures only; real-world OSS re-measurement deferred to Phase D.

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
  - **Framework shape:** auth-bypass and admin-check cover BOTH router-style (`router.METHOD(path, handlers...)` — Express family) AND file-system-routed (`export const POST = ...` / `export async function GET(...)` — Next.js App Router / Remix) shapes via two sibling prefilter patterns (`express_route_def`, `app_router_route_def`). The router-style sub-claim has full baselines (`test-output/auth-bypass-post-pr53-baseline.log`, `test-output/admin-check-post-pr53-baseline.log`); the App Router sub-claim is annotated with measured calibration baseline (Phase C post-tune; see per-detector CLAIMS rows for log paths and pass counts). Synthetic fixtures only; real-world OSS re-measurement is deferred to Phase D. webhook-unverified covers both shapes via the same prefilter addition plus an LLM-stage webhook-vs-not judgment driven by file path metadata / `node:crypto` HMAC / signature header reads — see the webhook-unverified "Critical scope limitations" section above for the residual gaps. IDOR, env-exposure, and secrets-exposure are framework-shape independent by design (content-based detection with framework-aware patterns including IDOR's `nextjs_destructured` — extended 2026-05-23 to cover Next.js 15+ async-params — and secrets-exposure's `NEXT_PUBLIC_*`); their CLAIMS rows enumerate the verified patterns.

## Cross-detector overlap

`scan.ts` includes a deterministic post-filter: if `admin-check` fires on a `file:line` where `auth-bypass` also fires, the `admin-check` finding is dropped (the auth-bypass finding subsumes it — "no auth at all" is strictly worse than "no admin gate" and the remediation is the same). This is the only inter-detector dependency in the pipeline; all other detectors run independently and their findings are reported independently.

## When this file changes

Three rules:

1. **Adding a CLAIMS row** requires a positive fixture in `fixtures/<detector>/positive/` and at least one negative-control fixture in `fixtures/<detector>/negative/` exercising the new pattern. The fixture suite must pass a fresh baseline run before the CLAIMS row is added.
2. **Adding a DOES NOT CLAIM row** can ship ahead of code — it's a credibility-defending negative claim, not a capability claim. Add it the moment a real customer or reviewer raises the question, so the next reviewer doesn't have to re-ask.
3. **Promoting a detector to the wedge** (going from N to N+1 advertised classes) requires (a) a saved baseline log in `test-output/`, (b) a new CLAIMS / DOES NOT CLAIM row in this file, and (c) an audit of every customer-facing surface so the count stays consistent. See the audit pattern used in PR #54 (`docs/promote-webhook-unverified-6-class-wedge`).

If a public surface contradicts this file, this file wins and the public surface is the bug.
