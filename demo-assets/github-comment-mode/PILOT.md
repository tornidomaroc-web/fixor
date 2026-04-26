# GitHub Comment Mode — controlled live pilot

This guide is for running Fixor’s **issue-comment** integration on a **small, explicit allowlist** of repositories. Fixor does **not** open pull requests or write commits in this mode; it only **creates or updates** a single PR comment per head SHA when configured to post live.

## Prerequisites

- A GitHub **fine-grained** or **classic** token with permission to **read** the repo and **write** issue comments on the target repository (or organization policy that allows it).
- Webhook endpoint (or local demo) that receives `pull_request` events for `opened`, `synchronize`, and `reopened`.
- Environment variables documented below.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Token used for GitHub REST calls when not passing a token in code. |
| `GITHUB_API_BASE_URL` | Optional. Default `https://api.github.com`. |
| `GITHUB_COMMENT_DRY_RUN` | When unset or `true`, no POST/PATCH; markdown is still built. |
| `DEMO_LIVE_CONFIRM` | Must be `true` together with dry-run `false` in the workflow layer so live posts are never accidental. |
| `FIXOR_PILOT_ENABLED` | Set `true` to enable **file-backed** comment-id cache and **execution idempotency** (see below). |
| `FIXOR_PILOT_STORE_PATH` | Optional path to the JSON store (default: `data/fixor-pilot-store.json` under the process cwd). |

Optional workflow flags (see `HandlePullRequestWebhookOptions` in `src/integrations/github/pr-webhook-handler.ts`): `pilotPersistence`, `pilotStorePath`, `maxCommentUtf8Bytes`, `forceRepost` (bypasses pilot duplicate skip when reposting the same execution key).

## Pilot persistence (what gets stored)

With `FIXOR_PILOT_ENABLED=true` (or `pilotPersistence: true`), Fixor maintains a small JSON file (default `data/fixor-pilot-store.json`) with:

1. **`commentByRepoPullSha`** — Latest Fixor comment **numeric id** keyed by `owner/repo/pullNumber/headSha`, so the client tries **PATCH** first instead of listing all comments every time.
2. **`executions`** — Records **completed** live runs keyed by **`executionKey`** (`owner/repo/pr-<n>/<headSha>`). A second run with the same key returns **`duplicate_skipped`** unless **`forceRepost`** / **`FORCE_RUN`** is used.

The store is **not** safe for multiple concurrent writers; use a **single** worker process for the pilot.

## Safe operating procedure

1. **Allowlist** — Install the webhook only on agreed repos; restrict token scope to those repos.
2. **Dry-run first** — Run with `GITHUB_COMMENT_DRY_RUN=true` (or handler `dryRun: true`) and confirm logs + markdown output. No GitHub writes occur in comment dry-run.
3. **Live second** — Set `GITHUB_COMMENT_DRY_RUN=false`, `DEMO_LIVE_CONFIRM=true`, and `GITHUB_TOKEN`. Enable pilot only when ready: `FIXOR_PILOT_ENABLED=true`.
4. **Observe** — Watch logs for `duplicate_skipped`, truncation notices in the comment body, and structured `GitHubApiError` details (HTTP status, message, rate-limit headers when present).

## API errors (rate limits and non-2xx)

Failed GitHub REST responses throw **`GitHubApiError`** with **`details`**: `status`, `statusText`, parsed **`message`** when available, response body snippet, and useful headers (`x-ratelimit-*`, `retry-after`, `x-github-request-id`). The PR webhook handler maps failures to a result shape that includes **`githubError`** when the failure was a GitHub API error.

## Comment size

Bodies are capped (default **58_000 UTF-8 bytes**). If exceeded, the text is truncated and a short **truncation notice** is inserted; the Fixor marker remains at the end. Override with `maxCommentUtf8Bytes` on the comment input / webhook config.

## Report URL expiry (Phase 5A-7+)

PDF and SARIF reports are uploaded to Cloudinary as `type=authenticated`. The PR comment links are **signed delivery URLs** that **expire after 1 hour** (configurable via `FIXOR_REPORT_URL_TTL_SECONDS`).

- **What this means for reviewers**: clicking the link more than ~1 hour after the comment was posted returns **HTTP 401** from Cloudinary.
- **How to recover**: re-trigger the scan (push a new commit, or close + reopen the PR). Each scan creates a fresh upload + a fresh signed URL.
- **Why this default**: signed URLs limit blast radius if a comment URL leaks. 1h is enough for the typical "PR opened → reviewed within an hour" flow; longer windows trade off security for convenience.
- **To extend**: set `FIXOR_REPORT_URL_TTL_SECONDS` to e.g. `86400` (24 hours) on Railway. Min effective floor is 60 seconds.

The Cloudinary asset itself is not deleted — only the signing key embedded in the URL has elapsed. A fresh URL minted for the same `public_id` would work, but Fixor never re-mints; the public_id includes a `Date.now()` segment so each scan is its own upload.

## Rollback

1. **Stop** the webhook or set **`GITHUB_COMMENT_DRY_RUN=true`** so no new posts occur.
2. **Delete** the Fixor comment on the PR manually in GitHub if you want it removed from the thread.
3. **Clear pilot state** for that run so a future live run is not treated as a duplicate:
   - Edit the JSON store and remove the matching **`executions`** entry for that `executionKey`, and/or the **`commentByRepoPullSha`** entry for that PR head SHA; or delete the file to reset entirely (you will lose all cached ids).
4. Optionally remove the webhook from the repo.

## Demo commands

From repo root (after `npm run build`):

```bash
# Dry-run validation (no writes)
npm run demo:validate-github-comment

# Pilot store + idempotency in demo (still dry-run unless --live + DEMO_LIVE_CONFIRM)
node dist/integrations/github/demo/validate-github-comment-demo.js --pilot

# Live (requires GITHUB_TOKEN and DEMO_LIVE_CONFIRM=true)
node dist/integrations/github/demo/validate-github-comment-demo.js --live --pilot
```

Use `--force-repost` with the demo to bypass pilot idempotency for that process (maps to `forceRepost` on the handler).

## Explicit non-goals (pilot)

- No **PR creation**.
- No **commit** or **branch** writes via this mode.
