<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=160&section=header&text=Fixor&fontSize=56&fontColor=ffffff&fontAlignY=40&desc=AI-Native%20AppSec%20for%20Pull%20Requests&descAlignY=62&descColor=fca5a5&animation=fadeIn" width="100%"/>

<br/>

[![Claude AI](https://img.shields.io/badge/Powered%20by%20Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/tornidomaroc-web/fixor)
[![License](https://img.shields.io/badge/MIT-1D9E75?style=for-the-badge)](LICENSE)

> **A GitHub App that reviews every Pull Request for security vulnerabilities, posts structured fixes, and generates a downloadable PDF report — powered by Claude.**

</div>

---

## What Fixor does today

| Capability | Status |
|---|---|
| 🛡️ SQL injection detection (JS/TS) | ✅ Shipping |
| 🔧 Parameterized-query rewrites (MySQL, Postgres) | ✅ Shipping |
| 📄 Branded PDF report per PR | ✅ Shipping |
| 🔌 Native GitHub App (HMAC webhook, installation tokens) | ✅ Shipping |
| 🛡️ XSS / Command injection / Path traversal | 🚧 On roadmap |
| 🐍 Python, ☕ Java, 🐹 Go support | 🚧 On roadmap |
| 📊 SARIF output + GitHub Code Scanning integration | 🚧 On roadmap |
| 🤖 Auto-fix Pull Requests (commit back) | 🚧 On roadmap |

> Fixor is in active development. The roadmap above is public and tracked in `docs/ROADMAP.md`.

## How it works

1. Install Fixor as a GitHub App on a repo or organization.
2. When a PR opens, GitHub sends a signed webhook to Fixor.
3. Claude analyzes the diff and Fixor generates parameterized-query fixes.
4. A structured review comment is posted on the PR, with a link to a downloadable PDF.

## Self-hosting

```bash
git clone https://github.com/tornidomaroc-web/fixor.git
cd fixor
npm ci
cp .env.example .env        # fill in your credentials
npm run build
npm start
```

Requires Node.js 20+, a registered GitHub App, an Anthropic API key, and a Cloudinary account (for PDF hosting).

### Environment variables

See [`.env.example`](./.env.example) — it lists every required and optional variable with inline docs.

## Project structure

```
src/
  analysis-engine/    # Claude-powered detection engine
  config/             # Model registry, tunables
  integrations/
    github/           # GitHub App auth, webhooks, PR comments
  services/           # Fix generation, PDF, Cloudinary
  server/             # Webhook server entry point
  types/              # Shared TypeScript types
  workflows/          # Auditor workflow orchestration
landing/              # Landing + Privacy + Terms (GitHub Pages)
```

## Tech stack

- **Runtime:** Node.js 20 (LTS) + TypeScript 5
- **AI:** Claude (Sonnet 4.6 for detection, Opus 4.7 for reasoning) via `@anthropic-ai/sdk` with prompt caching & tool use
- **Auth:** GitHub App (RS256 JWT + short-lived installation tokens)
- **PDF:** PDFKit with branded layouts
- **Storage:** Cloudinary (PDF reports); JSON file store for pilot persistence
- **Deploy:** Railway (backend) + GitHub Pages (landing)
- **Security:** HMAC-SHA256 webhook verification, timing-safe comparison, zero code retention

## Security posture

Fixor operates on PR diffs in memory only. No source code is written to disk. Reports are uploaded to Cloudinary under a per-PR public ID; see [Privacy Policy](landing/privacy.html) for the full retention story.

## Contributing

PRs welcome — see [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## License

MIT © Fixor

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=100&section=footer&animation=fadeIn" width="100%"/>
</div>
