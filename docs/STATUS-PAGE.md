# Status page — Better Uptime setup

> **Status (2026-04-27):** monitor endpoints are live (`/api/health` on the dashboard, `/health` on Railway), this doc is the setup script. The Better Uptime account creation, monitor configuration, status-page DNS, and notification routing are operator actions — there's nothing here a build pipeline can do for you.

The goal is `status.fixor.dev` showing four monitors: **Landing**, **Dashboard**, **Backend / webhook**, **Anthropic API edge**. Outages on any of them page the operator.

---

## 1. Account + plan

- Create an account at <https://betterstack.com/better-uptime>.
- The free plan covers 10 monitors and one public status page — exactly what we need.
- Mark this checkbox in the roadmap external-accounts list once you have credentials: **`Better Uptime (Phase 5G) — https://betterstack.com, free`**. (The roadmap originally said 5G but 5F-1 is the actual landing — fine to mark either way.)

## 2. Monitors

Create these four. All are **HTTPS** monitors with **30-second** check frequency unless noted.

### 2.1 Landing

| Field | Value |
|---|---|
| Name | `Fixor — Landing` |
| URL | `https://tornidomaroc-web.github.io/fixor/` (or `https://fixor.dev` once registered) |
| Method | `GET` |
| Expected status | `200` |
| Expected body | `Fixor` (substring match — the page's H1 / wordmark) |
| Frequency | 60 s (static page; no need to spam) |

### 2.2 Dashboard

| Field | Value |
|---|---|
| Name | `Fixor — Dashboard` |
| URL | `https://<your-vercel-domain>/api/health` |
| Method | `GET` |
| Expected status | `200` |
| Expected body | `"status":"ok"` (substring) |
| Frequency | 30 s |

The endpoint returns `503 + "status":"degraded"` when Neon is unreachable, which Better Uptime will flag as down.

### 2.3 Backend / webhook (Railway)

| Field | Value |
|---|---|
| Name | `Fixor — Backend` |
| URL | `https://<your-railway-domain>/health` |
| Method | `GET` |
| Expected status | `200` |
| Expected body | `"status":"ok"` (substring) |
| Frequency | 30 s |

`/health` already covers DB + Anthropic key sanity (5A-8). When this is green and `2.4` is green but the actual GitHub webhook is failing, the cause is almost always GitHub App private-key rotation — investigate that first.

### 2.4 Anthropic API edge

| Field | Value |
|---|---|
| Name | `Fixor — Anthropic edge` |
| URL | `https://api.anthropic.com/v1/messages` |
| Method | `GET` |
| Expected status | `401` |
| Frequency | 60 s |

The 401 is intentional — we hit the endpoint without a key so Anthropic rejects auth, which proves the edge is up + responsive. A `5xx` or timeout means Anthropic is genuinely down (independent of our keys / quotas). This monitor catches "Fixor scans are failing because Anthropic is on fire" before the support inbox does.

> **Why a separate monitor when our own /health already pings Anthropic?**
> /health (2.3) checks the API key shape, not Anthropic's edge — by design (see comment in `src/lib/health.ts`). 2.4 is the actual edge probe. They fail for different reasons.

## 3. Public status page

In Better Uptime → **Status pages → Create**:

- **Name**: `Fixor`
- **Subdomain / custom domain**: `status.fixor.dev` (custom; see DNS below)
- **Theme**: dark, accent `#f97316` to match the landing
- **Logo**: same SVG used in `landing/index.html` (the orange shield + checkmark)
- **Sections**: one section "Services", containing all four monitors above in the order listed
- **Subscribe form**: enabled — lets users opt into incident emails. Free plan caps subscribers at 100; the cap is lifted on paid plans before that bites.
- **Footer**: link back to `https://fixor.dev` (or the GitHub Pages URL until then)

## 4. DNS for `status.fixor.dev`

Once you own `fixor.dev` (Phase 5G locked-decision), add a `CNAME` record:

```
status   CNAME   <better-uptime-status-page-host>
```

Better Uptime shows the exact target in the status page settings under **Custom domain**. After the CNAME propagates, Better Uptime issues a Let's Encrypt cert automatically.

If `fixor.dev` isn't registered yet, point the status page at the default `<your-account>.betteruptime.com` subdomain temporarily — link from the landing footer once it's up.

## 5. Notification channels + on-call

Better Uptime → **On-call calendars + Escalation policies**:

1. Add an **email** integration with the operator's address (the same `support@fixor.dev` placeholder used in the marketplace listing — swap to a real address before launch).
2. Optional but recommended: **Slack** integration. Pick a channel like `#alerts` so an outage shows up where you already look.
3. Escalation policy: **email first, then Slack 5 min later, then SMS 10 min later** (SMS requires a paid plan; defer until launch).
4. Attach the policy to all four monitors.

## 6. Tuning + don't-page-me-for-this

- The dashboard `/api/health` will go down when Vercel rolls a new deploy. Better Uptime's **deploy windows** feature suppresses alerts during the window — set `1 minute` after every successful Vercel deploy via Better Uptime's GitHub Action.
- Anthropic edge has known weekly maintenance windows (rare; check their status page). Create a recurring **planned maintenance** entry to prevent paging during them.
- Set the **degraded → down** threshold to **2 consecutive failures**. One failed probe on a 30s cadence can be a Vercel cold-start; two in a row is real.

## 7. Pre-launch checklist

- [ ] All four monitors created and showing green for ≥ 1 hour
- [ ] Status page reachable at `status.fixor.dev` (or temp subdomain)
- [ ] Test alert: pause one monitor in Better Uptime → confirm email + Slack arrive within ~1 min
- [ ] Deploy-window integration wired so a normal Vercel deploy doesn't page
- [ ] Status page linked from landing footer (next to Privacy / Terms / Contact)
- [ ] Anthropic edge monitor's expected `401` documented in a runbook so on-call doesn't think a real Anthropic outage is a config bug

## 8. After launch

- Add **runbooks** to each monitor (Better Uptime supports a Markdown field per monitor). For each: top-3 likely causes + the first command to run. Example for "Backend down":
  1. Check Railway logs for crash-loop
  2. `gh workflow run deploy.yml` if last deploy was bad
  3. Check Neon's status page if /health is returning `db:"degraded"`
- Wire the status page's RSS feed into Slack so incidents land in the same channel as alerts.
