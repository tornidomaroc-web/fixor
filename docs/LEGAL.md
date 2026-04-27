# Legal pages — Privacy + ToS

> **Status (2026-04-27):** the repo ships hand-written `landing/privacy.html` and `landing/terms.html` reflecting Fixor's actual data flows as of the date above. They are accurate but they are **not legal advice** and they have not been reviewed by a lawyer. This doc tells you when to keep using them and when to swap them for Termly's lawyer-reviewed templates.

---

## Two paths

### Path A — Keep the hand-written pages

Free. Already linked from the landing footer. Covers the data items Fixor actually stores so you're not making promises the codebase doesn't keep.

**OK if:**
- You're shipping a free + paid SaaS at indie scale, no enterprise customers
- You can answer rights requests yourself within ~30 days
- You're comfortable defending the wording in a small claims dispute

**Refresh checklist** (re-run when any item changes):
- [ ] Does any new subprocessor exist? (Add to section 4 of `privacy.html` and pin its policy URL.)
- [ ] Did a column get added to the database that holds personal data? (Add to the section 2 retention table.)
- [ ] Did pricing change? (Update section 3 of `terms.html`.)
- [ ] Did the refund window change? (Update section 5 of `terms.html`.)
- [ ] Bump the "Last updated" date at the top of each file.

---

### Path B — Migrate to Termly

Termly is a hosted privacy/ToS generator (<https://termly.io>). Free to draft, $10/mo to host without their badge. The generator wizard asks ~50 questions and produces a hosted policy URL. You'd link the dashboard footer at the Termly URL instead of the local `.html` files.

**Worth it when:**
- You start signing customer contracts that reference your Privacy Policy
- You move into the EU/UK and want explicit GDPR / UK-GDPR controls (consent banners, DPIAs, etc.)
- A customer asks for a Data Processing Addendum (DPA)

If you go this route, here's the data the Termly wizard needs &mdash; pull it from `landing/privacy.html` so the two stay in sync.

#### Personal data we collect / process

| Category | Source | Where it lives |
|---|---|---|
| GitHub installation id | Webhook from GitHub | `orgs.github_installation_id` |
| Plan tier | Internal | `orgs.plan_tier` |
| Paddle customer / subscription ids | Paddle webhook | `orgs.paddle_customer_id`, `orgs.paddle_subscription_id` |
| Installer email | Clerk OAuth → primary email | `orgs.installer_email` |
| Per-org settings | User input via dashboard | `org_settings` (severity, globs, detector allowlist, optional Slack webhook URL) |
| Audit log entries | Internal | `audit_log` (org id, actor, action, target, jsonb metadata) |
| Anthropic spend ledger | Internal | `cost_ledger` (per-call cost + token counts; no diff content) |
| Scan history | Internal | `scan_runs` (repo, PR number, status, finding counts; no diff content) |
| API token hashes | User generates via CLI | `api_tokens.hash` (SHA-256, plain token never stored) |
| GitHub OAuth token | Clerk holds it on our behalf | (not in our DB) |
| Paddle customer email | Paddle holds it on their side | (not in our DB; we only see it on inbound webhook events) |
| Generated PDF / SARIF reports | Internal | Cloudinary, signed URLs, 1h TTL, 90-day retention |

#### Subprocessors Termly will ask about

Anthropic, Neon, Railway, Vercel, Clerk, Paddle, Resend, Cloudinary, Sentry, GitHub. URLs to each subprocessor's privacy policy are already in `landing/privacy.html` section 4 &mdash; copy them into Termly's subprocessor table.

#### Cookies / tracking

The marketing site sets none; the dashboard sets a single Clerk session cookie. Termly will ask if you set marketing/analytics cookies &mdash; the answer is no.

#### Data subject rights surface

- Access / portability: ad-hoc JSON export by emailing `support@fixor.dev`
- Deletion: GitHub uninstall triggers a 30-day grace then full delete
- Correction: most settings are self-serve in the dashboard; everything else by email
- Objection: marketing email isn't sent, so no opt-out is needed beyond uninstall

#### International transfers

USA-based subprocessors rely on each provider's published Standard Contractual Clauses. Paddle handles GDPR / UK-GDPR for the billing relationship as merchant of record &mdash; Termly will ask whether you have a third-party DPA in place; the answer is &ldquo;Paddle's DPA covers billing-side, we sign the per-subprocessor DPAs for the rest&rdquo;.

#### Retention table

Same as `landing/privacy.html` section 2.

---

## When to involve a lawyer

The hand-written pages aim to be honest and concrete. They're not a substitute for legal advice. Talk to a lawyer if any of the following becomes true:

- You sign your first contract with an enterprise customer (they will hand you their Privacy/DPA template &mdash; engage someone to review it)
- You move beyond the four detector families and start storing diff content (this changes the retention table materially)
- You hit > 100 paid customers and want to formalize the data subject rights process
- You're sued, served, or get a regulator inquiry &mdash; immediately

For routine `support@fixor.dev` questions (deletion requests, subprocessor lists, &ldquo;do you sell my data&rdquo;), the existing pages should answer them.

---

## What landed in this PR

- `landing/privacy.html` rewritten end-to-end. Sections: what we access, what we store + retention, how we use it, full subprocessor list, international transfers, cookies, your rights, security, contact, changes.
- `landing/terms.html` rewritten end-to-end. Sections: service description, eligibility, real pricing tiers, Paddle billing, refund policy, acceptable use, no-warranty, liability cap, IP / MIT, termination, changes, governing law, contact.
- `docs/LEGAL.md` &mdash; this file. Operator guide for keeping the hand-written pages fresh, plus a Termly migration checklist if you ever want to switch.
- Footer links from `landing/index.html` to both pages were already in place from 5E-1 &mdash; no markup change needed.
