# GitHub Comment Mode — internal demo

This folder holds **near-real** assets to validate the full Fixor flow: `pull_request` webhook → Semgrep JSON → auditor workflow → aggregated PR comment (markdown).

## Assets

| File | Purpose |
|------|--------|
| `pull_request.webhook.json` | Sample `pull_request` payload (`repository`, `pull_request.number`, `pull_request.head.sha`, etc.) |
| `semgrep.sample.json` | Two Semgrep results: one **SQL injection** (classified + fix) and one **non-SQL** rule (skipped by Fixor SQL path) |

## Commands

From the **repository root**:

```bash
# Install / build
npm install
npm run build
```

### Dry-run (default — no GitHub API writes)

Uses bundled assets and **never** posts a comment. Safe for laptops and CI read-only checks.

```bash
node dist/integrations/github/demo/validate-github-comment-demo.js
```

Custom files:

```bash
node dist/integrations/github/demo/validate-github-comment-demo.js \
  --webhook demo-assets/github-comment-mode/pull_request.webhook.json \
  --semgrep demo-assets/github-comment-mode/semgrep.sample.json
```

### Live comment on a real PR

**Requires:**

1. A **real** webhook JSON file whose `repository.owner.login`, `repository.name`, and `pull_request` fields match that PR.
2. A Semgrep JSON file for the same revision you want to represent.
3. `GITHUB_TOKEN` with permission to **post issue comments** on the repo (classic PAT or GitHub App installation token with `issues: write` / equivalent).
4. **`DEMO_LIVE_CONFIRM=true`** — without this, the script **forces dry-run** even if you pass `--live`.

```bash
set DEMO_LIVE_CONFIRM=true
set GITHUB_TOKEN=ghp_your_token_here

node dist/integrations/github/demo/validate-github-comment-demo.js --live \
  --webhook path\to\your\pull_request.webhook.json \
  --semgrep path\to\your\semgrep.json
```

On Unix:

```bash
export DEMO_LIVE_CONFIRM=true
export GITHUB_TOKEN=ghp_your_token_here

node dist/integrations/github/demo/validate-github-comment-demo.js --live \
  --webhook demo-assets/github-comment-mode/pull_request.webhook.json \
  --semgrep demo-assets/github-comment-mode/semgrep.sample.json
```

**Warning:** `--live` with matching repo/PR will **create or update** a single Fixor comment on that PR.

Optional:

- `GITHUB_API_BASE_URL` — GitHub Enterprise host (e.g. `https://github.mycompany.com/api/v3`).

### npm shortcut

```bash
npm run demo:validate-github-comment
```

Equivalent to build + dry-run with default asset paths.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|--------|
| `GITHUB_TOKEN` | Live mode only | Bearer token for REST API |
| `DEMO_LIVE_CONFIRM` | Live mode | Must be exactly `true` or live posting is blocked (dry-run forced) |
| `GITHUB_API_BASE_URL` | Optional | Non-default API root (Enterprise) |

## Expected output (dry-run)

1. **Banner** — whether the run is `dry-run` or `live`, and if live was requested but confirmation was missing (forced dry-run).
2. **Processed webhook result** — JSON: `ok`, `signatureState`, PR coordinates, workflow status, `fixesGenerated`, `commentPosted`, `commentAction`, etc.
3. **Create vs update** — With `GITHUB_TOKEN` set, a **read-only** probe lists issue comments and reports **would UPDATE** (existing Fixor marker) or **would CREATE**. Without a token in dry-run, this line explains that the probe was skipped.
4. **Generated markdown** — full comment body that would be POSTed/PATCHed.

## Signature verification (optional)

The validation script skips GitHub signature verification by default (local files). In production, use `X-Hub-Signature-256` and `verifyGitHubWebhookSignature256` from `src/integrations/github/webhook-signature.ts` before calling the handler.

## Scope

- **No** PR creation, branch writes, commits, or auto-merge — **comment only**.
