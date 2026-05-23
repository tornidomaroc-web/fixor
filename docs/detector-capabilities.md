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

**DOES NOT CLAIM:**
- Fastify, Koa, Hono, NestJS Guards/Interceptors, Spring `@PreAuthorize`/`@Secured`, ASP.NET `[Authorize]`, GraphQL resolver-level auth.
- Declarative auth (Rails `routes.rb` `authenticated do ... end`).
- tRPC `protectedProcedure`, Next.js middleware-based auth, edge-runtime auth.
- Auth gating applied via `router.use()` at file scope when the relevant `use()` call lives in a different file than the route declaration (the prefilter sees the route file in isolation).
- File-system-routed framework handlers (Next.js App Router `export const POST = ...` / `export async function GET(...)`, Remix `app/routes/*.ts` action/loader exports) **for the missing-middleware sub-claim only.** The shared `EXPRESS_ROUTE_DEF_RE` requires `router.METHOD(path, ...)` shape and does not match the file-system-routed `export METHOD` shape, so the missing-middleware sub-claim silently skips these files. The sentinel-string sub-claim (content-based) still fires on them normally.

**Measured baseline:** 22/20 (110%) — log: `test-output/auth-bypass-post-pr53-baseline.log` (captured 2026-05-23, post-PR #53 fixtures).

---

### 2. admin-check (`admin-check-multi`)

**CLAIMS:**
- **Hardcoded-admin shapes** in TS/JS/Python/Go: `email === "x@y.z"`, `email.endsWith("@domain")`, `email.includes("admin"|"owner"|"founder"|"root"|"superuser")`, Go `strings.HasSuffix(email, "@x")`, `ADMIN_EMAIL` / `admin_email` constants, `ADMIN_EMAILS` / `admin_emails` allowlist arrays, `DEFAULT_ADMIN_ID`, `DEFAULT_ADMIN_EMAIL`, `role || "admin"`, `role ?? "admin"`, `req.body|query|params.<role>` reads, `role === "admin"` string compare on a client-controlled value.
- **Missing-admin-gate shapes** on Express-family routers: a privileged route (role/tier change, user management, billing settings, `/admin/*` paths, privileged toggles) with no admin authorization check anywhere — neither `requireAdmin`/`isAdmin`/`adminOnly`/`verifyAdmin` middleware in the route arglist nor an inline check in the handler body — where sibling routes on the same router ARE admin-gated. Same route-def pattern coverage as auth-bypass.

**DOES NOT CLAIM:**
- Fastify, Koa, Hono, NestJS Guards, Spring `@PreAuthorize`, decorator-based RBAC (Python decorators, TS decorators outside Express).
- Declarative RBAC (Casbin policies, OPA, Cedar).
- tRPC `adminProcedure`, GraphQL resolver-level admin checks, Next.js middleware-based admin gating.
- Admin gating applied via `router.use(requireAdmin)` at file scope when the `use()` call lives in a different file than the route declaration.
- File-system-routed framework handlers (Next.js App Router `export const POST = ...` / `export async function GET(...)`, Remix `app/routes/*.ts` action/loader exports) **for the missing-admin-gate sub-claim only.** The shared `EXPRESS_ROUTE_DEF_RE` requires `router.METHOD(path, ...)` shape and does not match the file-system-routed `export METHOD` shape, so the missing-admin-gate sub-claim silently skips these files. The hardcoded-admin sub-claim (content-based) still fires on them normally.

**Measured baseline:** 22/22 (100%) — log: `test-output/admin-check-post-pr53-baseline.log` (captured 2026-05-23, post-PR #53 fixtures).

---

### 3. IDOR (`idor-multi`)

**CLAIMS:**
- DB read/write where a request-derived id (`req.params.id`, `req.body.id`, tRPC `input.id`, FastAPI path param, Rails `params[:id]`, Go chi `chi.URLParam`) flows into a query (`findUnique`, `findFirst`, `update`, `delete`, raw SQL, `pool.query`) with no ownership filter (`userId: ctx.session.user.id` or equivalent) in the `where` clause and no post-fetch ownership check.
- Router frameworks covered by fixtures: Express, Next.js app router, Fastify (Hono via fixture), tRPC, NestJS, FastAPI, Rails, Go chi with raw SQL.

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

**DOES NOT CLAIM:**
- Replay-protection issues independent of signature verification (timestamp window, nonce reuse).
- Key rotation / multi-secret handling.
- mTLS-based webhook auth (e.g., AWS API Gateway client certs).
- Providers not in prefilter or fixtures: Shopify (`X-Shopify-Hmac-Sha256`), Discord interactions (Ed25519), Mailgun, SendGrid, AWS SNS subscription confirmation, GCP Pub/Sub push (OIDC token), Square, PayPal, Paddle, Plaid, Algolia, Cloudflare Workers signed requests.
- **Critical scope limitations** (two, both produce silent skips):
  - **(a) URL is matched in file content, not file path.** Five of the eleven prefilter patterns (`express_post_webhook`, `express_use_webhook`, `flask_decorator_webhook`, `rails_post_webhook`, `go_handler_webhook`) require the webhook URL to appear as a string literal in file content alongside router-style syntax. File-system-routed frameworks (Next.js App Router, Remix) put routing in the file path — e.g. `app/api/<provider>/webhook/route.ts` — so these patterns never fire on those handlers. The original Stripe-at-`POST /billing/events` case is a second instance of the same shape: when the URL string in content doesn't carry the `webhook` / `hook` / `hooks` token, the URL-name patterns silently skip even on Express.
  - **(b) Content prefilter is blind to DIY-HMAC handlers that are silent.** A handler that imports no webhook library (`@octokit/webhooks`, `stripe.webhooks.constructEvent`, `twilio.validateRequest`, etc.) AND exhibits no signature-comparison anti-pattern (no `sig != expected`, no `WEBHOOK_VERIFY=off`) is invisible to the content prefilter. The inbox-zero Lemon Squeezy handler at `apps/web/app/api/lemon-squeezy/webhook/route.ts` is exactly this case: correct `crypto.timingSafeEqual` verification, no webhook-lib import, no anti-pattern, so no prefilter pattern fires and the file never reaches the LLM. The invisibility is because the file is correct, not because all DIY-HMAC is inherently invisible — a vulnerable DIY-HMAC handler that uses `sig != expected` would still hit the `signature_loose_eq` / `raw_signature_string_compare` content patterns. (Combined with (a), this means file-system-routed DIY-HMAC webhook handlers that ARE vulnerable but ARE silent — no anti-pattern in their broken code — are the worst-case invisibility.)

**Precision note (cross-detector):** MEDIUM-confidence findings (timing-leak comparisons, env-flag-conditional bypass) are routed to the internal review queue via `logger.warn` with `category: "webhook-unverified-review-queue"`, NOT emitted as a PR-comment finding. This matches the HIGH-only emit policy used by the other 5 detectors. If a customer asks "will Fixor flag a Stripe handler that toggles signature verification on/off via an env flag?", the honest answer is *"flagged in the review queue, not in the PR comment, by current policy."*

**Measured baseline:** 18/20 (log: `test-output/webhook-unverified-baseline.log`, captured 2026-05-23).

---

## Out of scope across the board

Independent of any specific detector, Fixor explicitly does not:

- **Replace SAST.** No SQL injection / XSS / command injection / path traversal scanning (those detectors are suppressed at output time — see `src/config/finding-suppressions.ts`).
- **Replace dependency scanning.** No CVE / SCA / supply-chain detection. Snyk and Dependabot remain authoritative.
- **Replace secret scanning of git history.** GitHub native secret scanning, gitleaks, etc. cover history; Fixor scans the present-tree diff.
- **Cover infrastructure-as-code or container security.** No Terraform, no Kubernetes manifests, no Dockerfile scanning.
- **Provide compliance certification.** SOC 2 / ISO 27001 outputs require their own controls; Fixor's PDF/SARIF outputs are evidence inputs to a compliance program, not compliance themselves.
- **Route-based detection is scoped along two axes — language and framework shape — both matter.**
  - **Language:** auth-bypass's missing-middleware sub-claim and admin-check's missing-admin-gate sub-claim are JS/TS only today. Their sentinel-string and hardcoded-admin sub-claims are content-based and run across the languages listed in their CLAIMS rows. IDOR, env-exposure, secrets-exposure, and webhook-unverified have broader language coverage as enumerated in their CLAIMS rows.
  - **Framework shape:** the same two route-shape sub-claims (auth-bypass missing-middleware, admin-check missing-admin-gate) require router-style framework syntax — `router.METHOD(path, handlers...)` — and do not fire on file-system-routed handlers (Next.js App Router `export const POST = ...`, Remix `app/routes/*.ts` action/loader exports). webhook-unverified has the same shape constraint on its URL-name prefilter patterns; its content prefilter (lib import, signature-comparison anti-patterns, env-flag bypass) is framework-shape independent — see the webhook-unverified "Critical scope limitations" section above for the two-axis breakdown. IDOR, env-exposure, and secrets-exposure are framework-shape independent by design (content-based detection with framework-aware patterns including IDOR's `nextjs_destructured` and secrets-exposure's `NEXT_PUBLIC_*`); their CLAIMS rows enumerate the verified patterns.

## Cross-detector overlap

`scan.ts` includes a deterministic post-filter: if `admin-check` fires on a `file:line` where `auth-bypass` also fires, the `admin-check` finding is dropped (the auth-bypass finding subsumes it — "no auth at all" is strictly worse than "no admin gate" and the remediation is the same). This is the only inter-detector dependency in the pipeline; all other detectors run independently and their findings are reported independently.

## When this file changes

Three rules:

1. **Adding a CLAIMS row** requires a positive fixture in `fixtures/<detector>/positive/` and at least one negative-control fixture in `fixtures/<detector>/negative/` exercising the new pattern. The fixture suite must pass a fresh baseline run before the CLAIMS row is added.
2. **Adding a DOES NOT CLAIM row** can ship ahead of code — it's a credibility-defending negative claim, not a capability claim. Add it the moment a real customer or reviewer raises the question, so the next reviewer doesn't have to re-ask.
3. **Promoting a detector to the wedge** (going from N to N+1 advertised classes) requires (a) a saved baseline log in `test-output/`, (b) a new CLAIMS / DOES NOT CLAIM row in this file, and (c) an audit of every customer-facing surface so the count stays consistent. See the audit pattern used in PR #54 (`docs/promote-webhook-unverified-6-class-wedge`).

If a public surface contradicts this file, this file wins and the public surface is the bug.
