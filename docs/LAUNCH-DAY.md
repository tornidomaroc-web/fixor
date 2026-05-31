# Launch day — playbook

> **Status (2026-05-31):** updated post-pivot to the six business-logic detectors. Aligned to `docs/detector-capabilities.md` (the scope contract). QUARANTINED pending founder sign-off. Do not run a launch off this file or `LAUNCH-POSTS.md` until signed off.
>
> **Purpose:** turn launch-day into a mechanical exercise. The drafts in [`LAUNCH-POSTS.md`](LAUNCH-POSTS.md) are ready; this doc is the minute-by-minute timeline + readiness checklist + pre-thought answers to the 15 questions you'll get asked on every platform.
>
> **5F-7 itself is operator action — there is no code to ship.** This file is the runbook.

---

## T-1 day: readiness checklist

Walk this list the day before launch. Every item must be green; if anything is red, push the launch a day rather than ship around the gap.

### Code + infrastructure

- [ ] Latest `main` is deployed and `/health` (Railway) + `/api/health` (Vercel) both return `{"status":"ok"}`
- [ ] All four monitors on `status.fixor.dev` have been green for ≥ 24 hours
- [ ] Run a real install on a test repo, open a sandbox PR with a deliberate IDOR (a `GET /:id` route returning a record with no ownership check), confirm the comment lands within 30s
- [ ] Welcome email actually sends (check Vercel function logs aren't running in `[resend stub]` mode)
- [ ] Sandbox Paddle checkout completes end-to-end (`transaction.completed` webhook flips `plan_tier` within 30s; Resend welcome email arrives)
- [ ] Cancel via Paddle portal triggers downgrade + cancellation email

### Public surfaces

- [ ] Landing renders cleanly at the public URL on mobile + desktop, all CTAs lead to `github.com/apps/fixor/installations/new`
- [ ] Privacy / Terms / Security pages render and intra-doc links resolve
- [ ] `.well-known/security.txt` returns `text/plain` from the GitHub Pages URL
- [ ] Marketplace listing approved by GitHub (1-2 weeks lead time — start the submission well before T-7)
- [ ] Mintlify docs site live at the chosen URL (`docs.fixor.dev` if DNS is up, else default `*.mintlify.app`)
- [ ] Logo + hero card + 4 screenshots + 30-sec demo GIF all captured and uploaded to the marketplace listing

### Communication channels

- [ ] `support@fixor.dev` actually receives mail (or your real address is grep-replaced everywhere — see `docs/MARKETPLACE-LISTING.md` find/replace section)
- [ ] You're logged in to **HN, X, Indie Hackers, Product Hunt, Reddit** — confirm sessions don't expire mid-launch
- [ ] Slack / Better Uptime / Sentry / your phone are all reachable for the full 8-hour launch window
- [ ] Your scheduling app says you have ZERO meetings / errands / calls during the window. Block it like a deploy

### Drafts swap-in

- [ ] Open [`LAUNCH-POSTS.md`](LAUNCH-POSTS.md), do the find/replace pass listed at the top of that file:
  - `<SIGN-OFF-REQUIRED-DO-NOT-POST>` → confirm founder sign-off, then delete this token from every post body; if it is still present, the copy is NOT cleared to post
  - `<install-url>` → real install URL
  - `<landing-url>` → real landing URL
  - `<demo-gif>`, `<pr-comment-screenshot>`, `<pdf-screenshot>`, `<dashboard-screenshot>` → asset URLs from the marketplace listing
  - `support@fixor.dev` → your real address if different
- [ ] Paste each into a private draft on its platform (HN doesn't support drafts; keep yours in a local file or Notion)
- [ ] Verify character counts inside each platform's UI — placeholders may have changed the length

---

## Launch day — minute-by-minute

**Set a hard rule: no new features ship today.** If something is broken, you fix it. If it's not broken, you leave it.

| Local time | Action | Channel |
|---|---|---|
| **00:01 PT (03:01 ET)** | Submit Product Hunt listing the moment the day rolls over | PH |
| 00:05 PT | Post your "first comment" on the PH listing (the one in `LAUNCH-POSTS.md` §4) | PH |
| 00:10 PT | DM 3-5 friends asking for an upvote + a substantive comment if they have one. **Do not ask strangers.** | DM |
| Sleep until 6am ET | Set 2 alarms. PH builds momentum overnight. | — |
| **06:00 ET** | Submit Indie Hackers post | IH |
| 07:55 ET | Final pre-flight: refresh Better Uptime status page, confirm green | check |
| **08:00 ET** | Submit Show HN | HN |
| 08:00 ET | Post X thread (same minute, all 7 tweets via thread mode) | X |
| 08:05 ET | Post your "what I'd do differently next time" first comment under the HN submission | HN |
| **08:15 ET** | Pin the X thread to your profile | X |
| **09:00 ET** | Cross-post HN URL to Reddit r/programming with a brief context paragraph (don't copy-paste the HN body — Reddit downvotes that) | Reddit |
| 09:00–17:00 ET | **Be online.** Reply to every comment within ~30 minutes. | All |
| 12:00 ET | Mid-day pulse check: is HN ranking? Is PH on the homepage? Adjust if needed. | check |
| 16:00 ET | Quote-tweet your X opening tweet with "still around if anyone has questions" | X |
| 17:00 ET | First quiet hour. Make tea. | — |
| 21:00 ET | If HN front-page or PH top-5: bookmark the screenshots for tomorrow's retro thread | — |

**Don't:**

- Don't ask people on the launch posts to upvote. Asks like that get the post penalized on HN and PH.
- Don't reply with "thanks!" to every comment — substantive replies only.
- Don't quote-tweet criticism with a defensive response; sit on it for an hour and reply with substance, not heat.
- Don't try to ship a fix mid-launch unless something is genuinely broken (see the "Hotfix protocol" below).

---

## Canned responses — the 15 questions you'll get

These come up on every developer-tool launch. Pre-thinking them lets you reply in 60 seconds instead of stewing for 20.

### Product / positioning

**Q: How is this different from Snyk Code?**

> Honestly: less breadth, more depth on what it does cover. Snyk Code has 100+ rules across 10+ languages; Fixor has 6 business-logic detector families on JS/TS. The bet is that for indie hackers and small JS/TS teams, "fewest steps to a useful finding" wins over breadth — install the App, no CI step, no rules to write. If you're at a 50-person company with a polyglot stack, Snyk is the right call.

**Q: Why not just use GitHub Code Scanning + CodeQL?**

> CodeQL is excellent and free for public repos, go run it. Fixor sits beside it on a different class: CodeQL's taint analysis is strong on injection and known sinks, while Fixor catches business-logic flaws (missing ownership checks, auth gaps, weak admin gates) that need reasoning about intent, not data flow. Each Fixor finding comes with a precise explanation and remediation steps. The two coexist on the same PR comfortably.

**Q: Is this just `Claude.send(diff)` in a wrapper?**

> Not quite — there's a real analysis engine that triages findings before they hit the LLM, applies per-org filtering (severity threshold, ignored globs, detector allowlist) AFTER the LLM, and renders the structured PR comment. Claude is the heaviest lift, but it's not the whole product. Source is MIT — `src/analysis-engine/` if you want to grep.

**Q: How do I know it's not just hallucinating findings?**

> You don't, fully. Fixor's terms ([fixor.dev/terms](https://fixor.dev/terms.html)) are explicit about this — every finding is a *suggestion*. The way you reduce it: tighter severity threshold + detector allowlist in your org settings, plus reviewer judgment on each PR. We don't claim zero false positives.

### Privacy / data

**Q: Do you store my code?**

> No. The PR diff is processed in memory and not written to our database. We store metadata (which scans ran, what they cost, severity counts) but the diff content itself is never persisted. Full retention table at [fixor.dev/privacy](https://fixor.dev/privacy.html).

**Q: Does Anthropic train on my code?**

> No — Anthropic's API terms exclude commercial customer data from training. We don't opt in to any "improve our model" setting. Their commitments are at [trust.anthropic.com](https://trust.anthropic.com/).

**Q: What happens if I uninstall?**

> GitHub revokes our access immediately. The org row in our DB is deleted after a 30-day grace window (so an accidental uninstall doesn't lose your settings). Reports purge on the same schedule.

### Pricing / billing

**Q: Is the free tier really free or is this a "free trial"?**

> Really free. 5 scans / month on public repos, all 6 detectors, no card. The cap exists because every scan calls Anthropic and that has a real cost — we'd rather pause than overspend on someone who hasn't subscribed.

**Q: Why is your card statement Paddle, not Fixor?**

> Paddle is our merchant of record. They handle VAT, sales tax, and chargebacks for the regions we serve. Stripe wasn't available in my country (founder is non-US), so Paddle was the practical choice — and as a side benefit, Paddle does VAT/tax filing for you, which is a non-trivial thing to handle yourself.

**Q: What's the refund policy?**

> 14 days, defect-only. If Fixor was unusable for you in the first two weeks of a paid plan due to something on our side, email and I'll refund through Paddle. After that, no refunds — cancel before the next renewal instead. EU statutory rights apply on top.

### Operations / reliability

**Q: What if Fixor goes down mid-PR?**

> Status page is at [status.fixor.dev](https://status.fixor.dev) — four monitors (landing, dashboard, backend, Anthropic edge). The PR comment doesn't block your merge; if it doesn't show up in 30 seconds, the PR keeps moving. Worst case is no Fixor review for that PR.

**Q: What's the SLA?**

> No formal SLA on free or Indie tiers. Team gets best-effort 99.5% uptime — we're a solo founder operation and won't promise more than we can keep. The status page is the source of truth for incidents.

**Q: Is the dashboard EU-hosted?**

> Vercel runs the dashboard with EU edge support; Neon (our Postgres) lets you pick a region. The Anthropic edge is US-only — if your data residency story requires no US transit, Fixor isn't the right fit today.

### Open source / contribution

**Q: Why MIT and not AGPL?**

> MIT keeps the friction low for contributors and self-hosters. The hosted service is the business; the code being open is the trust signal, not the moat.

**Q: Can I contribute a Python detector?**

> Yes please — open an issue first to align on the shape, then a PR. The detector interface lives at `src/analysis-engine/detector.types.ts`. The six existing detectors are each ~150-200 lines, so the per-detector cost is real but bounded.

---

## What "good" looks like (and what to do if not)

| Outcome | What I'd consider that |
|---|---|
| **HN front page (top 30)** | Stay online another 8 hours. Reply, don't promote. |
| **HN top 10** | Same as above — and bookmark every substantive comment thread for tomorrow's retro |
| **PH top 5 of the day** | Same. |
| **PH top product of the day** | Don't celebrate publicly until 24h after — "Product of the Day" gets retroactively reshuffled sometimes |
| **IH first page** | Reply in detail. The IH audience is fellow builders; this is where real users come from in week 1 |
| **Reddit r/programming + comments** | Engage on technical critique only; ignore tone-trolling |

If the launch flatlines (HN doesn't get past page 3, PH stays below 50, IH front page never), don't panic-post:

1. **Don't re-submit to HN.** It's against the unwritten rules and gets accounts shadowbanned.
2. **Wait 30 days, ship a v0.2** with one substantial new thing (e.g. Python detector landing, or autofix-PR-commits), then re-submit fresh.
3. The 5F goal is 100 sign-ups + 5 paying customers in 30 days. A flat launch day isn't fatal — incremental builds are.

---

## Hotfix protocol

If something IS broken on launch day:

1. **Confirm it's actually broken.** Sentry has events / `/api/health` returns 503 / a user reports something verifiable. Don't fix vibes.
2. **Comment on the launch post acknowledging it.** "Working on this right now, will edit when fixed." Beats silent fixing.
3. **Branch + minimal fix + push.** No "while I'm in here" cleanups.
4. **Tag a CHANGELOG entry** even if the post is small. The post-launch retro thread will reference it.
5. **Reply on the launch post when shipped.** The fix-and-acknowledge story plays better on HN than a perfect launch — it shows you're present.

The only thing worse than a broken launch is a silent broken launch.

---

## After the 8-hour window

- **22:00 ET** — log off. Tomorrow you write the retro thread (see `LAUNCH-POSTS.md` §6 for the after-launch follow-up cadence).
- **+24 hours** — write the day-2 X thread. Include real numbers if they're good; lessons if they're not.
- **+5 days** — IH update post: "First 100 sign-ups, here's the cohort breakdown."
- **+7 days** — `v0.1.0` git tag with a CHANGELOG that pulls Phase 4 → 5F highlights. Useful for anyone arriving from delayed search results.

---

## Closing note

You shipped a product, not just a launch. The launch is one day; the product is forever. If today doesn't break the world, that's fine — most launches don't. Most paying customers come in week 2-4 from people who saw the PH listing late, not from launch-day hype.

Good luck.
