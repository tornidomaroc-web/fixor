<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=160&section=header&text=Fixor&fontSize=56&fontColor=ffffff&fontAlignY=40&desc=Automated%20Security%20Detection%20for%20GitHub%20PRs&descAlignY=62&descColor=fca5a5&animation=fadeIn" width="100%"/>

<br/>

[![Live](https://img.shields.io/badge/●_LIVE-1D9E75?style=for-the-badge)](https://github.com/tornidomaroc-web/fixor)
[![Claude AI](https://img.shields.io/badge/Powered%20by%20Claude-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/tornidomaroc-web/fixor)
[![Security](https://img.shields.io/badge/Detects-SQL%20%7C%20XSS%20%7C%20CMDi%20%7C%20Path%20Traversal-dc2626?style=for-the-badge)](https://github.com/tornidomaroc-web/fixor)
[![License](https://img.shields.io/badge/MIT-1D9E75?style=for-the-badge)](LICENSE)

> **Automatically analyzes every Pull Request for security vulnerabilities — reports posted directly on the PR.**

</div>

---

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

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0d0d,50:7f1d1d,100:dc2626&height=100&section=footer&animation=fadeIn" width="100%"/>
</div>
