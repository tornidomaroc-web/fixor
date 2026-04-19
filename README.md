<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=160&section=header&text=Fixor&fontSize=56&fontColor=ffffff&fontAlignY=40&desc=Automated%20Security%20Detection%20for%20GitHub%20PRs&descAlignY=62&descColor=fca5a5&animation=fadeIn" width="100%"/>

<br/>

[![Live](https://img.shields.io/badge/●_LIVE-1D9E75?style=for-the-badge)](https://github.com/tornidomaroc-web/fixor)
[![Claude AI](https://img.shields.io/badge/Powered%20by%20Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/tornidomaroc-web/fixor)
[![Security](https://img.shields.io/badge/Detects-SQL%20%7C%20XSS%20%7C%20CMDi%20%7C%20Path%20Traversal-dc2626?style=for-the-badge)](https://github.com/tornidomaroc-web/fixor)
[![License](https://img.shields.io/badge/MIT-1D9E75?style=for-the-badge)](LICENSE)

> **A GitHub App that analyzes every Pull Request for SQL injection, posts structured fixes, and generates downloadable PDF compliance reports — powered by Claude AI.**

</div>

---

## Features

| Feature | Description |
|---|---|
| 🛡️ SQL Injection Detection | Raw SQL, string concatenation, template literal interpolation — caught before merge |
| 🤖 Claude AI Analysis | Contextual reasoning over regex. Understands frameworks, ORMs, and intent |
| 📄 PDF Compliance Reports | Professional branded reports — perfect for SOC 2 audits and stakeholder reviews |
| 🔌 Native GitHub App | Install once per org. No tokens to rotate, no webhooks to configure |
| ⚡ Fast Analysis | Average PR analyzed in under 20 seconds |
| 🔒 Secure by Design | HMAC-SHA256 verification, short-lived installation tokens, zero code storage |

## How it works

1. **Install** Fixor as a GitHub App on your organization or repository
2. **Open a PR** — Fixor receives the webhook automatically
3. **Analysis runs** — Claude AI reviews the diff for SQL injection patterns
4. **Report posted** — Structured comment appears on the PR with suggested fixes
5. **Download PDF** — Professional compliance-ready report available via Cloudinary CDN

## Getting Started

### For Users (Recommended)

Install Fixor as a GitHub App on your repositories — no setup required.

> 🚀 **[Install Fixor →](https://tornidomaroc-web.github.io/fixor/)**

Free tier includes 3 repositories. Pro plan ($19/mo) unlocks unlimited repos + PDF reports.

### For Self-Hosting

Want to run your own instance? You'll need:

- Node.js 20+
- A registered GitHub App (App ID + Private Key)
- Anthropic API key
- Cloudinary account (for PDF hosting)

```bash
git clone https://github.com/tornidomaroc-web/fixor.git
cd fixor
npm install
cp .env.example .env
# Fill in your credentials in .env
npm run build
node dist/server/webhook-server.js
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_APP_ID` | ✅ | Your GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | ✅ | Your GitHub App private key (PEM format) |
| `GITHUB_WEBHOOK_SECRET` | ✅ | Secret for webhook signature verification |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key for Claude AI |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Cloudinary account name (for PDF hosting) |
| `CLOUDINARY_API_KEY` | ✅ | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | ✅ | Cloudinary API secret |
| `GITHUB_TOKEN` | ⚠️ | Legacy PAT fallback (optional, for dev) |
| `PORT` | ❌ | Server port (default: 3000) |
| `DRY_RUN` | ❌ | Set to `true` to preview without posting |

## Project Structure

```
src/
  analysis-engine/    # Claude AI-powered vulnerability detection
  integrations/
    github/           # GitHub App auth, webhook handler, PR comments
  services/           # Fix generation, PDF reports, Cloudinary upload
  server/             # Express webhook server entry point
  types/              # Shared TypeScript types
  workflows/          # Auditor workflow orchestration
landing/              # Landing page + Privacy + Terms (deployed to GitHub Pages)
```

## Tech Stack

- **Runtime:** Node.js 20 + TypeScript 5
- **AI Engine:** Claude Sonnet 4 (claude-sonnet-4-20250514)
- **Authentication:** GitHub App with JWT (RS256) + installation tokens
- **PDF Generation:** PDFKit with custom branded layouts
- **File Hosting:** Cloudinary CDN (PDF reports)
- **Deployment:** Railway (backend) + GitHub Pages (landing)
- **Security:** HMAC-SHA256 webhook verification, short-lived tokens, zero code storage

## Contributing

PRs are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## License

MIT © 2026 Fixor

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=100&section=footer&animation=fadeIn" width="100%"/>
</div>
