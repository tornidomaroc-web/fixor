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
| Payments | **Stripe** | Industry standard, Checkout + Customer Portal |
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
- [ ] Stripe (Phase 5D) — https://stripe.com, requires business info + ID
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
- [ ] **5A-5** Add Pino: `npm i pino pino-pretty`. Create `src/lib/logger.ts` with redaction for `ANTHROPIC_API_KEY`, `GITHUB_APP_PRIVATE_KEY`, `STRIPE_*`. Replace every `console.log/warn/error` in `src/server`, `src/workflows`, `src/services`, `src/integrations` with structured logger calls. CI rule: `console.*` is banned outside `src/scripts/` and tests.
- [ ] **5A-6** Add Sentry: `npm i @sentry/node`. Initialize in `src/server/webhook-server.ts` startup with DSN from env. Wrap workflow + handler in `Sentry.startSpan`. Add `Sentry.captureException` in every catch block that currently logs+swallows.
- [ ] **5A-7** Cloudinary signed URLs: replace public unsigned uploads with signed delivery (1h TTL). PR comment links should include the signature. Document URL expiry behaviour in PILOT.md.
- [ ] **5A-8** Health endpoint: `GET /health` returns `{status: "ok", db: "ok|degraded", anthropic: "ok|degraded", uptime_s}`. Add `/ready` (just checks DB).
- [ ] **5A-9** Retry with exponential backoff on Anthropic 429/5xx in `callClaude`: max 3 retries, 1s/2s/4s delays + jitter. Record all retry attempts in Sentry as breadcrumbs.
- [ ] **5A-10** Resolve the Phase 4C pending items from the close-out:
  - Add structured logs for `checkBudget` decisions and `recordCost` writes.
  - Comment text: `"cap of $X reached (spent $Y)"` → `"$X cap (spent $Y)"`.
  - Investigate duplicate-scan-on-reopen: scope idempotency around `installation+sha`, not raw payload.

**Exit criterion**: Push a deliberately broken PR; verify (a) Sentry captures the error, (b) Pino logs include `installationId`, (c) cost ledger entry survives a Railway redeploy, (d) `/health` returns 200, (e) Anthropic 429 simulation triggers retries visible in Sentry.

---

### 🟦 Phase 5B — Multi-tenancy minimum viable

**Goal**: One GitHub installation = one Org. Per-org settings + per-org ledger + audit log.

**Tasks**:
- [ ] **5B-1** Schema additions: `orgs` (id, github_installation_id, plan_tier, stripe_customer_id, stripe_subscription_id, monthly_cap_usd, created_at), `org_settings` (org_id FK, severity_threshold, ignored_globs, enabled_detectors[], slack_webhook_url), `audit_log` (id, org_id, actor_type, actor_id, action, target, metadata jsonb, created_at).
- [ ] **5B-2** On `installation_created` webhook event: insert/upsert an `orgs` row with default `plan_tier="free"`, default `monthly_cap_usd=5`. Audit log entry.
- [ ] **5B-3** `runAuditorWorkflow` reads tier-derived caps + per-org settings. `checkBudget` reads from `orgs.monthly_cap_usd` (override path env still wins for `EXEMPT`).
- [ ] **5B-4** Settings application: `auditor-workflow` skips findings whose file path matches any `ignored_globs`. Skips disabled detectors. Filters out findings below `severity_threshold`.
- [ ] **5B-5** API tokens: `api_tokens` table (org_id, hash, name, last_used_at, revoked_at). Endpoint `POST /api/v1/scan` (auth via `Authorization: Bearer <token>`) — runs the workflow synchronously on a posted diff. Rate-limited per token.

**Exit criterion**: Two test installations on two test repos. Each scan attributes correctly. One has `severity_threshold=high` set; verify only high+critical findings appear in its PR comment.

---

### 🟦 Phase 5C — Dashboard + Auth

**Goal**: Customers log in with GitHub, see their orgs, view scan history, change settings.

**Tasks**:
- [ ] **5C-1** Spin up Next.js 15 app at `apps/dashboard/` (turborepo or npm workspaces). Tailwind + shadcn/ui. Deploy hello world to Vercel at `app.fixor.dev` (or vercel subdomain initially).
- [ ] **5C-2** Clerk integration: GitHub OAuth as the only sign-in method. Sign-up flow: after OAuth → check if user has any GitHub installations of Fixor → if yes, list them as Orgs; if no, send to install page.
- [ ] **5C-3** Page `/` (after sign-in): list user's orgs with tier badge + this-month spend.
- [ ] **5C-4** Page `/orgs/[id]/scans`: scan history table (date, PR, repo, status, findings, fixes, cost). Click row → detail page with the SARIF + PDF links.
- [ ] **5C-5** Page `/orgs/[id]/settings`: form to edit `severity_threshold`, `ignored_globs`, `enabled_detectors`, `slack_webhook_url`. Saves call API `PATCH /api/orgs/:id/settings` (auth via Clerk session passed as bearer to backend).
- [ ] **5C-6** Page `/orgs/[id]/billing`: shows current plan + Stripe customer portal link (Phase 5D wires this up).
- [ ] **5C-7** Trends widget on org page: line chart of findings/scans by week, pie of findings by family. Use `recharts`.

**Exit criterion**: User can sign in with GitHub, see at least one org, change settings, see those settings respected on the next scan.

---

### 🟦 Phase 5D — Stripe Billing

**Goal**: Self-serve upgrades, automatic tier provisioning, automatic suspension on payment failure.

**Tasks**:
- [ ] **5D-1** Create 4 Stripe Products + Prices: `price_free`, `price_indie_29`, `price_pro_79`, `price_team_199`. Store IDs in env (`STRIPE_PRICE_INDIE`, etc.).
- [ ] **5D-2** `POST /api/stripe/checkout`: create Checkout Session for org_id + selected tier. Redirect.
- [ ] **5D-3** Webhook `POST /api/stripe/webhook` handling: `checkout.session.completed` → set `org.plan_tier` + `stripe_customer_id` + `stripe_subscription_id`. `customer.subscription.updated` → update tier. `customer.subscription.deleted` / `invoice.payment_failed` → downgrade to free + email user via Resend.
- [ ] **5D-4** Tier-to-cap mapping: free=$5, indie=$30, pro=$80, team=$200 (round numbers — these are Anthropic budget caps, not what user pays). User pay > Anthropic cost = margin.
- [ ] **5D-5** Customer Portal link on `/orgs/[id]/billing`: shortcut to `https://billing.stripe.com/p/login/...`.
- [ ] **5D-6** Resend templates: welcome email, payment failed, suspended, scan limit reached (proactive at 80%), monthly digest.

**Exit criterion**: Sign up → free tier auto-provisioned. Upgrade to Indie via Checkout → tier updated within 30s of payment. Cancel subscription → downgrade visible, scans capped at 5.

---

### 🟦 Phase 5E — Landing + Onboarding

**Goal**: Visitor → installed Fixor on at least one repo → first scan completed → upgrade prompt.

**Tasks**:
- [ ] **5E-1** Update existing `landing/` page: replace placeholder pricing with real $29/$79/$199 tiers, "Install on GitHub" CTA, social proof slot (testimonials when available).
- [ ] **5E-2** GitHub App marketplace listing prep: screenshots of PR comment + PDF, 30-second demo GIF, install URL, support email.
- [ ] **5E-3** Onboarding flow on dashboard: post-OAuth, if user has 0 orgs → "Install Fixor on GitHub" wizard → after install webhook fires → return to dashboard with success toast.
- [ ] **5E-4** First-scan magic: as soon as the first PR scan succeeds for a new org, send a Resend email "Fixor just scanned your first PR — see results [link]".
- [ ] **5E-5** Free-tier limit nudge: at 80% of monthly cap, post a soft notice in the PR comment + send email + show banner in dashboard.

**Exit criterion**: A friend (one of yours, never seen Fixor) signs up, installs on a personal repo, opens a PR, sees Fixor's comment, gets the welcome email — all without you helping.

---

### 🟦 Phase 5F — Soft Launch

**Goal**: 100 sign-ups, 5 paying customers within 30 days of launch.

**Tasks**:
- [ ] **5F-1** Status page on `status.fixor.dev` via Better Uptime: monitors for landing, dashboard, webhook, Anthropic API.
- [ ] **5F-2** Privacy policy + ToS via Termly. Customize for Fixor specifics (data we store: scan results, ledger). Link from landing footer.
- [ ] **5F-3** Trust center page on `fixor.dev/security`: list subprocessors (Anthropic, Vercel, Railway, Neon, Clerk, Stripe, Cloudinary, Resend), security practices, contact for vulnerability disclosures.
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
