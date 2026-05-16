<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=160&section=header&text=Fixor&fontSize=56&fontColor=ffffff&fontAlignY=40&desc=AI-Native%20AppSec%20for%20Pull%20Requests&descAlignY=62&descColor=fca5a5&animation=fadeIn" width="100%"/>

<br/>

[![Install on GitHub](https://img.shields.io/badge/Install%20on%20GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/apps/fixor-security/installations/new)
[![Powered by Claude](https://img.shields.io/badge/Powered%20by%20Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![License: MIT](https://img.shields.io/badge/MIT-1D9E75?style=for-the-badge)](LICENSE)

> **A GitHub App that reviews every pull request for the business-logic vulnerabilities Snyk and Semgrep miss — auth bypass, IDOR, weak admin checks, env exposure, and hardcoded secrets. Posts a precise explanation and remediation steps inline, generates a PDF/SARIF report, runs in &lt;30 seconds.**

[Landing](https://tornidomaroc-web.github.io/fixor/) ·
[Dashboard](https://app.fixor.dev) ·
[Docs](https://docs.fixor.dev) ·
[Status](https://status.fixor.dev) ·
[Security](https://tornidomaroc-web.github.io/fixor/security.html)

</div>

---

## What Fixor does today

| Capability | Status |
|---|---|
| 🔓 Authentication bypass — weakened or short-circuited auth checks: role-to-admin fallbacks, swallowed token verification, hardcoded bypass flags | ✅ Shipping (measured) |
| 🔑 IDOR — resource access without an ownership check | ✅ Shipping (measured) |
| 👮 Weak admin check — privilege gated by hardcoded email/role allowlists or client-supplied role | ✅ Shipping (measured) |
| 🌫️ Env exposure — secrets leaked through env vars into response bodies | ✅ Shipping (measured) |
| 🗝️ Secrets exposure — hardcoded API keys, tokens, credentials | ✅ Shipping (measured) |
| 📄 Branded PDF report per PR (signed Cloudinary URL, 1h TTL) | ✅ Shipping |
| 📊 SARIF output (linked from PR comment, drops into Code Scanning et al.) | ✅ Shipping |
| 🔌 Native GitHub App — HMAC webhook, ≤1h installation tokens | ✅ Shipping |
| 💳 Paddle billing — free / $29 / $79 / $199, hosted checkout + portal | ✅ Shipping |
| 🎛️ Dashboard — scan history, trends, settings, billing | ✅ Shipping |
| 💸 Per-org Anthropic budget cap — 80% nudge + hard pause at 100% | ✅ Shipping |
| 🐍 Python detectors | 🚧 On roadmap (Phase 6) |
| ☕ Java / 🐹 Go / 🐘 PHP / 💎 Ruby | 🚧 On roadmap (Phase 6) |
| 🤖 Auto-fix Pull Requests (commit back) | 🚧 On roadmap (Phase 6) |

The full plan and what's already shipped is in [`docs/INDIE-SAAS-ROADMAP.md`](docs/INDIE-SAAS-ROADMAP.md).

## How it works

1. Install Fixor as a GitHub App on a repo or org.
2. When a PR opens or updates, GitHub sends a signed webhook to Fixor.
3. The diff (only the changed lines — never the full repo) is sent to Claude.
4. Fixor's analysis engine produces findings, each with a precise explanation and remediation steps.
5. A structured comment lands on the PR with the report inline + signed PDF/SARIF links.

Total latency from PR push to comment: typically 10–30 seconds.

> **A second pair of eyes, not a guarantee.** Fixor is tuned for near-zero false positives — when it flags something, it's real, so it reports only what it can stand behind. It sharpens human review; it does not replace it.

## Screenshots

A live Fixor Security Report, posted on a real pull request — [`fixor-demo` PR #1](https://github.com/tornidomaroc-web/fixor-demo/pull/1):

<img src="docs/screenshots/pr-comment.png" alt="Fixor Security Report comment on a pull request — summary table and four business-logic findings" width="900"/>

<!-- TODO: capture remaining assets, then uncomment -->
<!-- ![PDF report](docs/screenshots/pdf-report.png) -->
<!-- ![Dashboard scans](docs/screenshots/dashboard-scans.png) -->

## Compared to Snyk and Semgrep

Fixor doesn't compete with Snyk or Semgrep — it covers the class they structurally can't. CVE scanners and pattern matchers are strong on dependency vulns and known injection sinks (SQLi, XSS); they are blind to business-logic flaws, because catching those needs reasoning about auth, ownership, and role semantics — not patterns. **Run Snyk for dependencies, run Fixor for the logic in your own code.**

| | **Fixor** | Snyk Code | Semgrep (OSS / Pro) |
|---|---|---|---|
| Setup time | Install GitHub App, done | CLI / CI step + dashboard config | Add `.semgrep.yml` + CI step |
| Languages | JS/TS today (more on roadmap) | 10+ | 30+ |
| Detector focus | Business logic: auth-bypass · IDOR · admin-check · env-exposure · secrets | Dependency CVEs + injection patterns | 2,000+ pattern rules |
| False-positive driver | Claude reasoning (low) | Heuristics + ML | Pattern rules (highest precision when written; brittle on edge cases) |
| Remediation output | Precise explanation + remediation steps per finding | Partial auto-patch (Snyk Code Fix) | Rule message only |
| PDF + SARIF | ✅ Both | ✅ SARIF | ✅ SARIF |
| Pricing (entry) | $0 (free tier, real) | Free tier; $52/dev/mo Team | OSS free; $40/dev/mo Pro |
| Open source | ✅ MIT | ❌ | ✅ rules engine |
| Best for | Catching logic flaws in your own JS/TS code | Dependency + known-CVE coverage | Teams who want full rule control |

If you're at a 50-person company with a polyglot codebase, Snyk or Semgrep Pro is probably the right call. If you're a solo founder or a small team shipping a Node.js app and want a security review on every PR with zero ceremony, Fixor is built for you.

## Self-hosting

Fixor is MIT-licensed; you can run the entire stack yourself. The hosted service exists because most operators don't want to run Postgres, manage GitHub App keys, and pay Anthropic directly — but if you do, the path is:

```bash
git clone https://github.com/tornidomaroc-web/fixor.git
cd fixor
npm ci
cp .env.example .env        # fill in credentials per inline docs
npm run build
npm run db:migrate          # apply schema to your Postgres
npm start                   # webhook server on $PORT
```

Requires Node.js ≥ 20, a registered GitHub App, an Anthropic API key, a Postgres database (we use Neon; any Postgres works), and a Cloudinary account for report hosting. Optional: Sentry DSN for error tracking, Resend for transactional email, Paddle for billing if you want the same paid tiers as the hosted service.

The dashboard is a separate Next.js app at [`apps/dashboard/`](apps/dashboard/) — see its `.env.example` for the Vercel-side requirements (Clerk, the same Postgres URL, Paddle public token).

## Tech stack

| Layer | Tech | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript 5 | Boring, fast, well-supported |
| AI | Claude (Anthropic SDK with prompt caching + tool use) | Reasons about diff context; lower FP rate than regex |
| Database | Neon Postgres + Drizzle ORM | Serverless, branching, type-safe |
| Auth (App) | GitHub App — RS256 JWT + ≤1h installation tokens | Standard for App-based GitHub integrations |
| Auth (Dashboard) | Clerk — GitHub OAuth only | 10k MAU free, OOTB |
| Backend host | Railway | Cheap, fast deploys, fits indie budget |
| Frontend host | Vercel + Next.js 16 + Tailwind 4 | Standard for Next.js |
| Logger | Pino with redaction for keys + secrets | JSON, fast, lint-banned `console.*` outside scripts |
| Errors | Sentry | Free 5k events / month |
| Payments | Paddle (merchant of record — handles VAT) | Stripe alt; geo-friendly |
| Email | Resend | 100/day free; transactional only, no marketing |
| Object storage | Cloudinary (signed URLs, 1h TTL) | PDF + SARIF reports |
| Status page | Better Uptime | Four monitors at `status.fixor.dev` |
| Security | HMAC-SHA256 on both webhook surfaces, hashed API tokens, TLS everywhere | See [security.html](landing/security.html) |

## Project structure

```
src/
  analysis-engine/        # Claude-powered detection (4 detector families)
  config/                 # Model registry, tunables
  db/                     # Drizzle schema + migrations
  integrations/github/    # GitHub App auth, webhooks, PR comments
  lib/                    # logger, retry, anthropic helpers, resend
  services/               # Cost store, orgs, fix generation, PDF, SARIF, first-scan-email
  server/                 # Webhook server entry + /health endpoint
  test/                   # Self-runnable unit tests (no jest, no vitest)
  workflows/              # Auditor workflow orchestration
apps/dashboard/           # Next.js 16 dashboard (Vercel)
landing/                  # Landing + Privacy + Terms + Security + .well-known/security.txt
docs/                     # Roadmap, marketplace listing, status-page, legal, mintlify source
```

## Security

Every claim in this README is checkable against the source — Fixor is fully open. The trust center page at [`landing/security.html`](landing/security.html) (live at `https://tornidomaroc-web.github.io/fixor/security.html`) has the full posture: HMAC-verified webhooks on both inbound surfaces, in-memory diff handling, signed report URLs, hashed API tokens, redacted Pino logs, audit trail in `audit_log`. Vulnerability disclosure: email `support@fixor.dev` with subject `SECURITY:`. Safe-harbor terms in the trust center page.

## Contributing

PRs welcome — see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md). The `docs/INDIE-SAAS-ROADMAP.md` file is the source of truth for what's planned and what's already shipped; pick an unchecked item and propose an approach in an issue first if it's substantive.

## License

MIT © Fixor

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=100&section=footer&animation=fadeIn" width="100%"/>
</div>
