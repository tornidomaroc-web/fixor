# Fixor — Indie SaaS Roadmap

> **Goal**: Open-source security scanner with a self-hosted commercial tier that pays solo founder rent. Target: ship paid hosted version in 6 weeks, hit $1k MRR within 6 months.
>
> **NOT the goal**: Fortune 500 enterprise sales. SOC 2 audits. 50-person team. That path needs $500k+ funding and 18 months — out of scope.

---

## 🔒 Locked decisions (no re-debate without user override)

### Pricing tiers
| Tier | Price | Scans/month | Repos | Detectors |
|---|---|---|---|---|
| Free | $0 | 5 | Public only | All 4 |
| Indie | $29/month | 100 | 1 private + unlimited public | All 4 |
| Pro | $79/month | 500 | 5 private + unlimited public | All + Slack/Jira |
| Team | $199/month | 2000 | Unlimited | All + priority support |

### Tech stack (chosen, do not switch)
| Layer | Tech | Why |
|---|---|---|
| Database | **Neon Postgres** | Serverless, generous free tier, branching |
| ORM | **Drizzle** | Type-safe, light, serverless-friendly |
| Logger | **Pino** | Standard Node logger, JSON, redaction built-in |
| Error tracking | **Sentry** | Free 5k events/month, dev-friendly |
| Frontend | **Next.js 15 + Tailwind + shadcn/ui** | Modern, fast, idiomatic |
| Frontend host | **Vercel** | Best for Next.js, free tier covers indie |
| Auth | **Clerk** | GitHub OAuth + sessions OOTB, 10k MAU free |
| Email | **Resend** | 100/day free, simple API, React Email templates |
| Payments | **Paddle** | Stripe unavailable in operator's country; Paddle is merchant-of-record so it also handles VAT/sales tax (see Decision Log 2026-04-27) |
| Object storage | **Cloudinary** (already) | Migrate to **Cloudflare R2** in Phase 6 if scale demands |
| Status page | **Better Uptime** | Free 10 monitors |
| Docs site | **Mintlify** | Free for OSS, looks good |
| Backend host | **Railway** (already) | Keep until 1k+ MRR, then evaluate Fly.io / DigitalOcean |
| CDN/DNS | **Cloudflare** | Free, faster than alternatives |

### External accounts to create (user, before each phase that needs it)
- [ ] Neon (Phase 5A) — https://neon.tech, free tier
- [ ] Sentry (Phase 5A) — https://sentry.io, free tier
- [ ] Cloudflare (Phase 5A) — https://cloudflare.com, free
- [ ] Vercel (Phase 5C) — https://vercel.com, free hobby
- [ ] Clerk (Phase 5C) — https://clerk.com, free up to 10k MAU
- [x] Paddle (Phase 5D) — https://paddle.com, merchant-of-record (Stripe alt; handles VAT)
- [ ] Resend (Phase 5D) — https://resend.com, free 100/day
- [ ] Better Uptime (Phase 5G) — https://betterstack.com, free
- [ ] Mintlify (Phase 5G) — https://mintlify.com, free for OSS

### Domain
- Already have `tornidomaroc-web.github.io` (free).
- **Recommendation**: buy `fixor.dev` ($12/year on Cloudflare Registrar). Switch when ready.

---

## 📋 Phases

Each phase has explicit exit criteria. A phase is DONE when every box is checked AND the exit criterion verified by the user.

### ✅ Phase 4C — Cost Cap (DONE — see commits 15a40e8 + cdfc9b5)

---

### 🟦 Phase 5A — Production Hardening

**Goal**: Fixor production is observable, durable, and recoverable. No more silent failures, no lost ledgers on redeploy.

**Tasks**:
- [x] **5A-1** Install `gh` CLI globally on dev machine + verify `gh auth login` works. (Removes the manual "open this URL" overhead going forward.)
- [x] **5A-2** Create Neon Postgres project. Add `DATABASE_URL` to Railway env. Add to `.env.example`. (PR #13 added the placeholder; user created the Neon project and set Railway env.)
- [x] **5A-3** Add Drizzle: `npm i drizzle-orm pg`, `npm i -D drizzle-kit @types/pg`. Create `src/db/schema.ts` with tables: `installations`, `cost_ledger` (replacing JSON ledger), `scan_runs`. Generate + run migration. (PR #14 — schema + scaffolding committed; user applied migration on Neon.)
- [x] **5A-4** Replace `src/services/cost-store.ts` JSON-file persistence with Drizzle Postgres queries. Keep API surface identical (`recordCost`, `getMonthlySpend`, `checkBudget`). Migrate data: small one-shot script `src/scripts/migrate-json-ledger-to-pg.ts`. (PR #15 — sync→async; fail-open on DB errors via `db_unavailable`.)
- [x] **5A-5** Add Pino: `npm i pino pino-pretty`. Create `src/lib/logger.ts` with redaction for `ANTHROPIC_API_KEY`, `GITHUB_APP_PRIVATE_KEY`, `STRIPE_*`. Replace every `console.log/warn/error` in `src/server`, `src/workflows`, `src/services`, `src/integrations` with structured logger calls. CI rule: `console.*` is banned outside `src/scripts/` and tests. (PR #16 — pino + redaction + scripts/lint-no-console.mjs.)
- [x] **5A-6** Add Sentry: `npm i @sentry/node`. Initialize in `src/server/webhook-server.ts` startup with DSN from env. Wrap workflow + handler in `Sentry.startSpan`. Add `Sentry.captureException` in every catch block that currently logs+swallows. (PR #17 — instrument.ts loaded first; 8 catches captureException; SIGTERM flushes.)
- [x] **5A-7** Cloudinary signed URLs: replace public unsigned uploads with signed delivery (1h TTL). PR comment links should include the signature. Document URL expiry behaviour in PILOT.md. (PR #18 — type=authenticated + private_download_url; FIXOR_REPORT_URL_TTL_SECONDS knob.)
- [x] **5A-8** Health endpoint: `GET /health` returns `{status: "ok", db: "ok|degraded", anthropic: "ok|degraded", uptime_s}`. Add `/ready` (just checks DB). (PR #19 — both endpoints, 503 on degraded; helpers in src/lib/health.ts.)
- [x] **5A-9** Retry with exponential backoff on Anthropic 429/5xx in `callClaude`: max 3 retries, 1s/2s/4s delays + jitter. Record all retry attempts in Sentry as breadcrumbs. (PR #20 — pure helpers in src/lib/anthropic-retry.ts; SDK retries set to 0; honors Retry-After.)
- [x] **5A-10** Resolve the Phase 4C pending items from the close-out:
  - Add structured logs for `checkBudget` decisions and `recordCost` writes. (done — pino info-level logs in cost-store.ts)
  - Comment text: `"cap of $X reached (spent $Y)"` → `"$X cap (spent $Y)"`. (done — comment-builder.ts)
  - Investigate duplicate-scan-on-reopen: scope idempotency around `installation+sha`, not raw payload. (partial — `buildFixorExecutionKey` now scopes to `inst-<id>/<sha>` when installationId is available; full Postgres-backed idempotency is tracked as a Phase 5B follow-up below.)

**Exit criterion**: Push a deliberately broken PR; verify (a) Sentry captures the error, (b) Pino logs include `installationId`, (c) cost ledger entry survives a Railway redeploy, (d) `/health` returns 200, (e) Anthropic 429 simulation triggers retries visible in Sentry.

#### Phase 5A close-out follow-ups (deferred, not blocking)

- **Scan idempotency in production (Postgres-backed).** The JSON pilot store (`FIXOR_PILOT_ENABLED`) is opt-in and not used on Railway, so a `pull_request.reopened` event on the same head SHA currently triggers a fresh scan + duplicate Anthropic spend. Fix: query `scan_runs` for an existing recent row with `(installation_id, head_sha)` before launching the workflow; reuse its `comment_id` instead of re-running. Land this in **Phase 5B** alongside the `orgs` schema work since the same path will need org context anyway. (5A-10 narrowed the executionKey to `inst-<id>/<sha>` for the JSON store, which is a partial fix; the full fix needs the DB layer.)

---

### 🟦 Phase 5B — Multi-tenancy minimum viable

**Goal**: One GitHub installation = one Org. Per-org settings + per-org ledger + audit log.

**Tasks**:
- [x] **5B-1** Schema additions: `orgs` (id, github_installation_id, plan_tier, stripe_customer_id, stripe_subscription_id, monthly_cap_usd, created_at), `org_settings` (org_id FK, severity_threshold, ignored_globs, enabled_detectors[], slack_webhook_url), `audit_log` (id, org_id, actor_type, actor_id, action, target, metadata jsonb, created_at). (PR #22 — schema + 0001 migration; user applied to Neon.)
- [x] **5B-2** On `installation_created` webhook event: insert/upsert an `orgs` row with default `plan_tier="free"`, default `monthly_cap_usd=5`. Audit log entry. (PR #23 — provisionOrgForInstallation, transactional, idempotent; 503-on-fail so GitHub retries.)
- [x] **5B-3** `runAuditorWorkflow` reads tier-derived caps + per-org settings. `checkBudget` reads from `orgs.monthly_cap_usd` (override path env still wins for `EXEMPT`). (PR #24 — resolveMonthlyCapForInstallation; spend reads + cap lookup parallel via Promise.all; effective caps surfaced in BudgetCheck.caps.)
- [x] **5B-4** Settings application: `auditor-workflow` skips findings whose file path matches any `ignored_globs`. Skips disabled detectors. Filters out findings below `severity_threshold`. (PR #25 — minimatch filter at the analysis-finding layer; no-op for default settings; 24-assertion unit suite.)
- [x] **5B-5** API tokens: `api_tokens` table (org_id, hash, name, last_used_at, revoked_at). Endpoint `POST /api/v1/scan` (auth via `Authorization: Bearer <token>`) — runs the workflow synchronously on a posted diff. Rate-limited per token. (PR #26 — fxr_ token format, SHA-256 hash, in-memory fixed-window limiter; CLI `npm run create-api-token`.)

**Exit criterion**: Two test installations on two test repos. Each scan attributes correctly. One has `severity_threshold=high` set; verify only high+critical findings appear in its PR comment.

---

### 🟦 Phase 5C — Dashboard + Auth

**Goal**: Customers log in with GitHub, see their orgs, view scan history, change settings.

**Tasks**:
- [x] **5C-1** Spin up Next.js 15 app at `apps/dashboard/` (turborepo or npm workspaces). Tailwind + shadcn/ui. Deploy hello world to Vercel at `app.fixor.dev` (or vercel subdomain initially). (PR #27 — Next.js 16 + Tailwind 4 + shadcn/ui; deployed at fixor-seven.vercel.app.)
- [x] **5C-2** Clerk integration: GitHub OAuth as the only sign-in method. Sign-up flow: after OAuth → check if user has any GitHub installations of Fixor → if yes, list them as Orgs; if no, send to install page. (PR #28 — Clerk middleware as proxy.ts; listFixorInstallations via clerkClient → GitHub API.)
- [x] **5C-3** Page `/` (after sign-in): list user's orgs with tier badge + this-month spend. (PR #29 — `<TierBadge/>` + `<SpendBar/>`; getOrgSummaries does one LEFT JOIN orgs↔cost_ledger with a start-of-month-UTC filtered aggregate; DB error → "spend unavailable" per row, page still renders. DATABASE_URL set on Vercel.)
- [x] **5C-4** Page `/orgs/[id]/scans`: scan history table (date, PR, repo, status, findings, fixes, cost). Click row → detail page with the SARIF + PDF links. (PR #30 — list + detail pages with auth scoped to the user's installations; getOrgForUser/getScansForOrg/getScanForOrg in scans-data.ts; ScanStatusPill component; org rows on `/` link to scans page when provisioned. Detail page links out to the PR for the SARIF/PDF — those URLs aren't durably stored since Cloudinary signs them with a 1h TTL; persisting them is a Phase-6 follow-up if/when reports outlive the PR comment.)
- [x] **5C-5** Page `/orgs/[id]/settings`: form to edit `severity_threshold`, `ignored_globs`, `enabled_detectors`, `slack_webhook_url`. Saves call API `PATCH /api/orgs/:id/settings` (auth via Clerk session passed as bearer to backend). (PR #31 — settings form + PATCH route handler scoped via getOrgForUser; settings-validation.ts is the input boundary, settings-data.ts owns the upsert + audit_log write. Endpoint lives on the dashboard runtime — Vercel→Neon — rather than fanning out to Railway: tight loop, single auth path, the 5B-5 API-token surface stays on /api/v1/* where it already lives. See Phase 5C close-out follow-ups for the audit_log mirror note.)
- [x] **5C-6** Page `/orgs/[id]/billing`: shows current plan + Paddle customer-portal link (Phase 5D wires the actual portal URL up). (PR #32 — billing page renders current tier, monthly cap, this-month spend, the four-tier pricing table, and "manage subscription" / "upgrade" CTAs that are intentionally disabled with a "Phase 5D" note. Tier definitions live in `lib/tiers.ts` so 5D-2 can reuse the same prices/caps when wiring Paddle checkout. The org row on `/` and both `/scans` + `/settings` nav now also link to Billing.)
- [x] **5C-7** Trends widget on org page: line chart of findings/scans by week, pie of findings by family. Use `recharts`. (PR #33 — `<TrendsChart/>` mounted at the top of `/scans`. Line chart: 12-week ISO-week buckets with zero-fill so the x-axis is contiguous; one line each for Scans + Findings. Pie chart: per-detector finding sums via `jsonb_each(findings_by_family)`. Migration 0003 added the `findings_by_family jsonb NOT NULL DEFAULT '{}'` column on `scan_runs` so the pie has somewhere to read from once the workflow writer lands. Empty state covers the "no scans in window" case so we don't render an all-zero recharts axis.)

**Exit criterion**: User can sign in with GitHub, see at least one org, change settings, see those settings respected on the next scan.

#### Phase 5C close-out follow-ups (deferred, not blocking)

- **Wire `scan_runs` writes from the workflow.** The table was scaffolded in 5A-3 but no code path inserts into it yet — the cost ledger and Sentry are the de-facto record. As a result, the 5C-4 history page AND the 5C-7 trends widget render the empty state on every org until this lands. Plan: in `runAuditorWorkflow` (or its caller in `pr-webhook-handler.ts`), insert one `scan_runs` row at start (`status="running"`, started_at=now), update on completion (`status`, `total_findings`, `findings_by_family` (added in migration 0003 for 5C-7's pie chart), `fixes_generated`, `cost_usd`, `finished_at`), and link `cost_ledger.scan_run_id` to the new row's id. Bundle this with the next backend phase that touches the workflow boundary.

- **Add a dashboard test runner (vitest).** 5C-5 added `settings-validation.ts` — pure logic that's the security boundary for the PATCH endpoint. The dashboard has no test tool installed, so the validator is currently only verified by build + manual checks. Plan: `npm i -D vitest` inside `apps/dashboard/`, add `npm test` script, port a small assertion suite for the validator (severity enum, glob caps, detector allowlist, slack URL must be https), and wire into the existing CI workflow as a separate matrix job so the dashboard ships with its own typecheck+test step. Land before the next dashboard PR that touches validated input.

---

### 🟦 Phase 5D — Paddle Billing

**Goal**: Self-serve upgrades, automatic tier provisioning, automatic suspension on payment failure. Paddle is merchant-of-record — they handle VAT/sales tax + dunning + chargeback liability, which is why the operator's geography forced this choice (see Decision Log 2026-04-27) but is also a real ergonomic win for an indie shop.

**Tasks**:
- [x] **5D-1** Create 3 paid Paddle Products + Prices in the Paddle dashboard: `price_indie_29`, `price_pro_79`, `price_team_199` (free tier needs no Paddle product). Store the Paddle price IDs in env (`PADDLE_PRICE_INDIE`, `PADDLE_PRICE_PRO`, `PADDLE_PRICE_TEAM`). Add `PADDLE_API_KEY` + `PADDLE_WEBHOOK_SECRET` to `.env.example` and Railway/Vercel envs. Rename the existing `orgs.stripe_customer_id` / `stripe_subscription_id` columns to `paddle_customer_id` / `paddle_subscription_id` (no rows yet, so it's a free migration). (PR #34 — `.env.example` placeholders on backend + dashboard; `lib/tiers.ts` now carries `paddlePriceEnv` per tier so 5D-2's checkout call has the env-var name handy; migration `0004_paddle_rename.sql` does the column rename. The Paddle dashboard product setup + filling the env values is the user's action; the code/schema are ready for them.)
- [x] **5D-2** `POST /api/billing/checkout`: build a Paddle checkout link (Paddle.js overlay or hosted checkout) for org_id + selected tier. Pass `customData={ org_id }` so the webhook can correlate. Redirect. (PR #35 — `lib/paddle.ts` wraps `POST https://{sandbox-,}api.paddle.com/transactions` with a hand-rolled fetch (one-call surface, no SDK dep). Route handler at `apps/dashboard/src/app/api/billing/checkout/route.ts` does Clerk auth → `getOrgForUser` scope check → resolves the price id from `tier.paddlePriceEnv` → creates the transaction with `custom_data={org_id}` + a `checkout.url` return URL derived from `req.url.origin`. `<UpgradeButton/>` (client) replaces the disabled buttons in the pricing grid; the billing page also handles `?checkout=success` with a banner. Free tier stays inert — downgrade is 5D-5's portal, not this endpoint.)
- [x] **5D-3** Webhook `POST /api/billing/webhook` (Paddle): verify signature with `PADDLE_WEBHOOK_SECRET`. Handle: `transaction.completed` → set `org.plan_tier` + `paddle_customer_id` + `paddle_subscription_id`. `subscription.updated` → update tier. `subscription.canceled` / `transaction.payment_failed` → downgrade to free + email user via Resend. (PR #36 — endpoint added to the public matcher in `proxy.ts` so Clerk skips it; `lib/paddle-webhook.ts` parses the `Paddle-Signature` header and verifies HMAC-SHA256 over `<ts>:<rawBody>` in constant time with a 5-min replay window; `lib/billing-events.ts` does the org+audit-log writes inside one transaction per event; `lib/resend.ts` is a stubs-when-unconfigured email helper so the webhook 200s even before 5D-6 wires real templates. Tier-to-cap mapping (5D-4) is applied here too — `monthly_cap_usd` is updated alongside `plan_tier` so `checkBudget` doesn't immediately reject post-upgrade.)
- [x] **5D-4** Tier-to-cap mapping: free=$5, indie=$30, pro=$80, team=$200 (round numbers — these are Anthropic budget caps, not what user pays). User pay > Anthropic cost = margin. (Absorbed into PR #36 — `Tier.monthlyCapUsd` carries the values from 5D-1's `lib/tiers.ts`, and the Paddle webhook handler writes them to `orgs.monthly_cap_usd` alongside `plan_tier` on every transition. Provisioning's $5 default remains the floor for newly-installed orgs.)
- [x] **5D-5** Customer-portal link on `/orgs/[id]/billing`: Paddle's hosted update-payment / cancel page (the Paddle equivalent of Stripe's Customer Portal — link is per-subscription, fetched via the API or stored at checkout time). (PR #37 — `getSubscriptionManagementUrls` in `lib/paddle.ts` calls `GET /subscriptions/{id}` and returns the `management_urls.update_payment_method` + `management_urls.cancel` pair. `POST /api/billing/portal` is the auth-scoped wrapper (Clerk session → `getOrgForUser` → 409 when no `paddle_subscription_id`). `<ManageSubscriptionButtons/>` replaces the disabled "Manage subscription" button on the billing page with a paired "Update payment" + "Cancel" group; URLs fetched fresh on click rather than cached so the customer always lands on a non-stale Paddle-signed URL. The buttons stay inert with explanatory copy when the org is on the free tier.)
- [x] **5D-6** Resend templates: welcome email, payment failed, suspended, scan limit reached (proactive at 80%), monthly digest. (PR #38 — five typed `render*` functions in `lib/email-templates.ts`, each pure with `{ subject, text }` outputs. The Paddle webhook from 5D-3 now plumbs `renderWelcomeEmail` through `transaction.completed`, `renderCancellationEmail` through `subscription.canceled`, and `renderPaymentFailedEmail` through `transaction.payment_failed` — replacing the placeholder bodies. The 80% scan-limit and monthly-digest renderers are wired but not triggered yet — see Phase 5D close-out follow-up. Plain text first; React Email upgrade is a Phase-6 polish task that doesn't touch any caller.)

**Exit criterion**: Sign up → free tier auto-provisioned. Upgrade to Indie via Paddle checkout → tier updated within 30s of payment. Cancel subscription via the Paddle portal → downgrade visible in dashboard within 30s, scans capped at 5.

#### Phase 5D close-out follow-ups (deferred, not blocking)

- **Wire the scan-limit-80% trigger.** `renderScanLimitWarningEmail` is ready (5D-6), but the natural place to fire it is `cost-store.recordCost` on the **backend** — which currently has no Resend setup. Two reasonable shapes: (a) add `lib/resend.ts` to the backend and call from `recordCost` once spend crosses 80% of cap (one-shot per month, gated by an audit_log lookup so we don't spam), or (b) add a Vercel Cron on the dashboard runtime that scans `orgs × cost_ledger` ratios daily and emails newly-crossed orgs. Option (b) keeps Resend in one place but adds a cron dependency. Decision deferred to whichever phase next touches the backend cost path.

- **Wire the monthly-digest cron.** `renderMonthlyDigestEmail` is ready (5D-6) but needs (1) a scheduled job to fire on the 1st of each month and (2) per-org aggregations from `scan_runs` (which itself isn't being written to yet — see the 5C close-out follow-up). Sensible plan: land the `scan_runs` writer first, then add a Vercel Cron at `apps/dashboard/src/app/api/cron/monthly-digest/route.ts` that iterates active orgs, runs the same shape of aggregate the trends widget uses, and calls `sendBillingEmail`. Free tier orgs can be excluded to stay under Resend's 100/day during launch.

- **Polish bodies with React Email.** The locked-decisions table calls out React Email as the eventual template stack. Plain text was the right call for the v1 webhook + cancel + payment-failed emails — Paddle's URLs already carry the brand, and bodies that work in any email client matter more than rich layout. When user count grows, swap each `render*` to JSX-emitting React Email components and add HTML alongside the existing text.

---

### 🟦 Phase 5E — Landing + Onboarding

**Goal**: Visitor → installed Fixor on at least one repo → first scan completed → upgrade prompt.

**Tasks**:
- [x] **5E-1** Update existing `landing/` page: replace placeholder pricing with real $29/$79/$199 tiers, "Install on GitHub" CTA, social proof slot (testimonials when available). (PR #39 — `landing/index.html` swaps the private-beta waitlist for a 3-card pricing grid (Free / Indie [popular] / Pro) plus a Team mention in the foot, all four CTAs wired to `https://github.com/apps/fixor/installations/new`. Hero H1 broadened from "SQL injection" to "security bugs", lead now lists all four detector families. New social-proof section with placeholder copy + an HTML comment marking where testimonial cards / customer logos drop in. Header nav CTA flipped from "Join Waitlist" to "Install on GitHub". Slug `fixor` is hard-coded with a top-of-file comment so the operator can find/replace if the live App's slug differs.)
- [x] **5E-2** GitHub App marketplace listing prep: screenshots of PR comment + PDF, 30-second demo GIF, install URL, support email. (PR #40 — `docs/MARKETPLACE-LISTING.md` is the single source of truth: tagline, short + long descriptions, features list, permissions justification, pricing summary, asset checklist with exact GitHub Marketplace specs (logo 200×200 / hero 1280×640 / screenshots 1280×800), pre-submit + post-submit notes. Landing footer gains a `mailto:support@fixor.dev` link with an HTML comment pointing at the find/replace section in the listing doc. Asset capture itself — the screenshots and 30-sec demo GIF — is the operator's action; the doc lists exactly what to capture, where, and at what dimensions.)
- [x] **5E-3** Onboarding flow on dashboard: post-OAuth, if user has 0 orgs → "Install Fixor on GitHub" wizard → after install webhook fires → return to dashboard with success toast. (PR #41 — `<InstallWizard/>` (client) replaces the bare empty-state with three phases: `ready` (numbered "what happens next" copy + same-tab Install CTA), `waiting` (auto-`router.refresh()` every 3s for up to 30s after `?installed=1`, then a manual refresh button), and `error` (split copy for `no_token` vs GitHub-API failure). `<WelcomeBanner/>` is the success "toast" — emerald banner shown for one render after the install lands, then 5s later strips `?installed=1` from the URL via `router.replace("/")`. Operator action: set the GitHub App's Setup URL to `https://<vercel-domain>/?installed=1` so GitHub sends the user back into the waiting phase.)
- [x] **5E-4** First-scan magic: as soon as the first PR scan succeeds for a new org, send a Resend email "Fixor just scanned your first PR — see results [link]". (PR #42 — migration `0005_omniscient_wolf_cub.sql` adds `orgs.installer_email` + `orgs.first_scan_email_sent_at`. Backend gets a parallel `src/lib/resend.ts` (mirrors the dashboard's, logs through pino) and `src/services/first-scan-email.ts` whose `maybeSendFirstScanEmail` does an atomic `UPDATE orgs SET first_scan_email_sent_at = now() WHERE installation_id = $1 AND first_scan_email_sent_at IS NULL RETURNING installer_email` — wins-the-race semantics so duplicate scans can't double-send. The webhook handler fires it after `postFixorPullRequestComment` succeeds, fire-and-forget so a Resend hiccup never breaks a scan. Dashboard side: `lib/onboarding-state.ts` opportunistically populates `installer_email` from Clerk's primary email on every authenticated visit to `/`. `RESEND_API_KEY` + `RESEND_FROM_EMAIL` placeholders added to backend `.env.example`; while unset, the helper stubs and the path is harmless.)
- [x] **5E-5** Free-tier limit nudge: at 80% of monthly cap, post a soft notice in the PR comment + send email + show banner in dashboard. (PR #43 — three nudges from one signal: pure `computeBudgetWarning` returns the warning shape only at `[0.8, 1.0)` (the hard `budget_exceeded` path owns ≥1.0); `WorkflowResult.budgetWarning` is set by the webhook handler after a fresh post-scan budget re-read; comment-builder renders `> ⚠️ Heads-up — Fixor is at NN% …` above the summary table; dashboard `<BudgetWarningBanner/>` (server-rendered, amber) shows on `/` per-org and on `/orgs/[id]/billing` when the same threshold trips. Email path: `triggerLimitWarningEmailIfNeeded` resolves orgId + tier-based upsell ("free→Indie", "indie→Pro", "pro→Team", "team→null") + `FIXOR_DASHBOARD_URL`-derived billing URL, then `maybeSendLimitWarningEmail` claims atomically with a "lastSent < startOfThisMonth UTC" condition so each calendar month fires at most once. Migration `0006_dizzy_rhodey.sql` adds `orgs.limit_warning_email_sent_at`. New `npm run test:limit-warning` covers threshold edges, NaN/zero-cap defenses, year-boundary month math, and start-of-next-month rollover.)

**Exit criterion**: A friend (one of yours, never seen Fixor) signs up, installs on a personal repo, opens a PR, sees Fixor's comment, gets the welcome email — all without you helping.

---

### 🟦 Phase 5F — Soft Launch

**Goal**: 100 sign-ups, 5 paying customers within 30 days of launch.

**Tasks**:
- [x] **5F-1** Status page on `status.fixor.dev` via Better Uptime: monitors for landing, dashboard, webhook, Anthropic API. (PR #44 — new `apps/dashboard/src/app/api/health/route.ts` mirrors the backend's `/health` (5A-8) shape so a single Better Uptime body assertion `"status":"ok"` works for both. Added to the public matcher in `proxy.ts` so Clerk doesn't 302-redirect probes. `docs/STATUS-PAGE.md` is the operator setup script — four monitors with exact specs (landing 60s/200/contains "Fixor"; dashboard 30s on `/api/health`; backend 30s on `/health`; Anthropic edge 60s on `https://api.anthropic.com/v1/messages` expecting 401), status-page branding, DNS for `status.fixor.dev`, escalation policy, deploy-window suppression, and a pre-launch checklist. Better Uptime account creation + monitor configuration + DNS itself is the operator's action.)
- [x] **5F-2** Privacy policy + ToS via Termly. Customize for Fixor specifics (data we store: scan results, ledger). Link from landing footer. (PR #45 — `landing/privacy.html` and `landing/terms.html` rewritten end-to-end to reflect actual current Fixor: four detectors not just SQL; full subprocessor table (Anthropic / Neon / Railway / Vercel / Clerk / Paddle / Resend / Cloudinary / Sentry / GitHub) with policy links and regions; the actual retention table per DB column (`orgs`, `org_settings`, `cost_ledger`, `scan_runs`, `audit_log`, `api_tokens`, reports); Paddle-as-merchant-of-record explained, real $0/$29/$79/$199 pricing, 14-day refund window, MIT IP, GDPR / CCPA rights surface. Footer links from `landing/index.html` were already wired in 5E-1, so no markup change there. `docs/LEGAL.md` is the operator guide: a refresh checklist for keeping the hand-written pages accurate, plus a Termly migration checklist with the exact data items to feed into Termly's wizard if/when we outgrow self-written. Hand-written pages are clearly noted as not legal advice.)
- [x] **5F-3** Trust center page on `fixor.dev/security`: list subprocessors (Anthropic, Vercel, Railway, Neon, Clerk, Paddle, Cloudinary, Resend, plus Sentry + GitHub for completeness), security practices, contact for vulnerability disclosures. (PR #46 — `landing/security.html` ships eight concrete practice cards (HMAC verification on both webhook surfaces, short-lived install tokens, in-memory diff handling, signed Cloudinary URLs, hashed API tokens, per-org budget caps, redacted Pino logs, TLS everywhere), full subprocessor table mirroring privacy with each vendor's *security* page (not just privacy), an honest compliance posture (open-source MIT yes, audit log yes, SOC 2 not pursuing), and a vulnerability-disclosure block with explicit in-scope / out-of-scope / safe-harbor sections. RFC 9116 compliance via `landing/.well-known/security.txt` — needs `landing/.nojekyll` (added) so GitHub Pages serves the dotfolder. Stripe references in the original roadmap line corrected to Paddle. Footer of every legal page now carries a Security link.)
- [ ] **5F-4** Mintlify docs site: setup guide, supported languages, detector catalogue, API reference, FAQ.
- [ ] **5F-5** Public README polish: "Install on GitHub" badge linking to marketplace, screenshots, comparison table vs Snyk/Semgrep.
- [ ] **5F-6** Launch posts (write but don't post yet): X thread, HN Show, Indie Hackers, ProductHunt teaser.
- [ ] **5F-7** **Launch day**: schedule for a Tuesday. Post HN at 8am ET. X thread same time. PH 12am PT. Reddit r/programming at 9am ET. Be online for 8 hours to answer questions.

**Exit criterion**: 100 signups + 5 paying customers within 30 days of launch. If miss: write a postmortem, iterate on landing + pricing, retry.

---

## 🚧 Post-launch (build based on customer feedback)

DO NOT prematurely build. Build only after at least 3 customers explicitly ask.

- Python detector (very high demand likely)
- Java + Go detectors
- Secrets detection (very high demand likely)
- SCA / dependency scanning (very high demand likely)
- Slack notifications integration
- Jira/Linear ticket creation
- Native GitHub Code Scanning SARIF upload
- Monorepo support (multi-package PRs)
- Custom rules per org
- SOC 2 Type 1 prep (only if pursuing mid-market customers)

---

## 🤝 How Claude Code uses this file

At the start of each session:
1. `cat docs/INDIE-SAAS-ROADMAP.md`
2. Find the first **un-checked** task in the active phase.
3. Confirm with user: "Working on task `5A-3 Add Drizzle...`. Proceed?"
4. Execute. Run typecheck + tests. Open PR via `gh pr create`. Wait for user merge.
5. After merge, mark `[x]` in roadmap, commit roadmap update, push.
6. Move to next task or pause.

If a task needs an external account/API key the user hasn't provided yet, ask once, save to `.env.example` (placeholder) + ask user to set on Railway, then proceed.

If uncertain about a decision NOT in "Locked decisions", surface it to user and DO NOT guess.

If a task uncovers a need to change "Locked decisions", create a `## Decision Log` section at the bottom and propose the change with rationale; user approves explicitly before re-architecture.

---

## 📓 Decision Log

### 2026-04-27 — Payments: Stripe → Paddle (approved)

**Original decision** (Locked decisions table): Use **Stripe** for billing — Checkout + Customer Portal.

**Change**: Use **Paddle** instead.

**Reason**: The operator's country does not support Stripe accounts, so Stripe was never actually viable — the original "Locked decision" was made without that constraint visible. The user already has a Paddle account.

**Side effects considered:**
- Paddle is merchant-of-record (handles VAT/sales tax filing, chargebacks, dunning) — strictly nicer for an indie shop than rolling Stripe Tax + Radar + dunning ourselves. Net win on operational complexity.
- API surface differs: Paddle Billing uses `transaction.*` and `subscription.*` events instead of Stripe's `checkout.session.completed` / `customer.subscription.*`. Phase 5D tasks updated to match (see 5D-1 through 5D-5).
- Customer-portal flow differs: Paddle issues a per-subscription update/cancel URL rather than a global portal session. Stored at checkout time or fetched on demand via the API.
- Schema columns `orgs.stripe_customer_id` / `stripe_subscription_id` exist from the 5B-1 migration but have never been written to (no rows in any environment). They will be renamed to `paddle_*` in the first migration of 5D-1 — free rename, no backfill.
- Tier prices ($29 / $79 / $199) and tier-to-cap mapping unchanged.
