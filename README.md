# Fixor — Automated Security Vulnerability Detection for GitHub PRs

> Fixor automatically analyzes every Pull Request for security vulnerabilities and posts a detailed report as a PR comment — no setup required beyond installation.

![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Security](https://img.shields.io/badge/security-SQL%20%7C%20XSS%20%7C%20CMDi%20%7C%20Path%20Traversal-red)

## What it detects

| Vulnerability | Description |
|---|---|
| SQL Injection | Raw SQL built from user input, string concatenation in queries |
| XSS | Unescaped user input in HTML, dangerouslySetInnerHTML, innerHTML |
| Command Injection | User input passed to exec(), spawn(), eval(), or shell commands |
| Path Traversal | User input used in file paths without sanitization |

## How it works

1. Developer opens a Pull Request
2. Fixor receives the PR webhook from GitHub
3. Analyzes the diff using Claude AI
4. Posts a detailed security report directly on the PR

## Getting Started

### Requirements
- Node.js 18+
- GitHub Token with `repo` scope
- Anthropic API Key

### Installation

```bash
git clone https://github.com/tornidomaroc-web/fixor.git
cd fixor
npm install
cp .env.example .env
```

### Environment Variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub personal access token |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret (optional but recommended) |
| `PORT` | Server port (default: 3000) |
| `DRY_RUN` | Set to `true` to preview without posting |

### Running

```bash
npm run build
node dist/server/webhook-server.js
```

## Project Structure

```
src/
  analysis-engine/    # AI-powered vulnerability detection
  integrations/
    github/           # GitHub webhook handler, PR comments, API client
  services/           # Fix generation, risk explanation, diff analysis
  types/              # Shared TypeScript types
  workflows/          # Auditor workflow orchestration
```

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **AI Engine:** Claude (claude-sonnet-4-20250514)
- **Integration:** GitHub Webhooks API
- **Security:** HMAC-SHA256 webhook signature verification

## Contributing

PRs are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## License

MIT © 2025 Fixor
