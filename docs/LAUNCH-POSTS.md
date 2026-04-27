# Launch posts — drafts (do not post yet)

> **Status (2026-04-27):** drafts, not scheduled. The roadmap's 5F-7 calendars the actual posting (HN at 8am ET Tuesday, etc.). This file holds the copy so launch day is paste-and-go, not write-and-pray.

Each section below is one platform. Each is written in that platform's voice — the HN draft is dry and technical, the X thread is punchy with screenshot cues, IH is journey-driven, Product Hunt is tagline-first.

**Before posting**, do this find/replace pass:

- `<install-url>` &rarr; final GitHub App install URL (likely `https://github.com/apps/fixor/installations/new` once you confirm the slug)
- `<landing-url>` &rarr; final landing URL (likely `https://fixor.dev` once DNS is live; until then the GitHub Pages URL)
- `<demo-gif>` &rarr; the 30-second demo GIF from the marketplace asset checklist
- `<pr-comment-screenshot>` &rarr; the PR comment screenshot from the marketplace asset checklist
- `<pdf-screenshot>` &rarr; the PDF report screenshot
- `<dashboard-screenshot>` &rarr; the `/orgs/<id>/scans` screenshot
- `support@fixor.dev` &rarr; your real address if it differs

The "what's the differentiator" line is the same across all four posts — keep it consistent.

---

## 1. Hacker News &mdash; Show HN

**Title** (≤80 chars):

```
Show HN: Fixor – AI security review on every GitHub PR (4 detectors, MIT)
```

**Body** (paste into the URL field as the link, then this in the text field):

```
Hi HN — I built Fixor because I kept committing SQL injection in
side projects and felt stupid every time CodeQL or Semgrep would
have caught it if I'd bothered to wire one up. The "bothered to
wire" part was the bug.

Fixor is a GitHub App. Install it on a repo, open a PR, and ~30
seconds later a structured comment lands with findings + concrete
fix patches. No CI step. No rules to write. No tokens to rotate.

What it scans for today:

  - SQL injection (with parameterized rewrites for MySQL, Postgres,
    Knex, Prisma raw)
  - XSS (DOM sinks, innerHTML, dangerouslySetInnerHTML, common
    React bypass patterns)
  - Command injection (exec, shell concat, unsafe spawn)
  - Path traversal (fs.* / express.static / .. patterns)

JS/TS only at the moment. Python is the next language; demand
signal from paid customers drives the order after that.

The differentiator vs Snyk Code or Semgrep isn't breadth — they
have hundreds of rules to Fixor's four detector families. It's
"fewest steps to a useful finding". You don't write rules. You
don't add a CI job. You install the App and the next PR gets a
review with concrete fixes, not just "consider parameterizing
this query".

Under the hood:

  - Each scan sends only the diff (not the full repo) to Anthropic's
    Claude API. Diffs are processed in memory and never written
    to our DB.
  - Each install gets a hard monthly Anthropic budget cap (free=$5,
    indie=$30, pro=$80, team=$200). At 80% we nudge in the comment
    + email + dashboard banner; at 100% scans pause until next month
    or upgrade. So Fixor can never blow up your bill.
  - The full code is MIT at github.com/tornidomaroc-web/fixor.
    Every claim on the trust center page is grep-able.

Pricing: free tier is real (5 scans / month on public repos, all
four detectors). Paid tiers are $29 / $79 / $199, billed via
Paddle (merchant of record, handles VAT).

It's a solo project, six weeks from "what if Claude reviewed PRs"
to today. Happy to answer questions about the analysis engine,
the cost-cap math, or why I chose Paddle over Stripe (geographic
constraints — not all founders can sign up for Stripe).

Try it: <install-url>
Source: https://github.com/tornidomaroc-web/fixor
```

**Posting tips:**

- 8am ET Tuesday is conventional wisdom for Show HN. Stay logged in for the next 8 hours and respond to every comment within an hour, especially critical ones — silence reads as defensive.
- Your first comment within 5 minutes of posting should be a one-paragraph "what I'd do differently next time" — HN rewards self-awareness.

---

## 2. X (Twitter) thread

**Tweet 1** (the hook — most important):

```
i kept committing SQL injection in my own side projects.

embarrassing, but also: every "fix it" tool wanted me to wire up
CI, write rules, or pay $50/dev/mo before i'd even tried it.

so i built Fixor. install the github app, open a PR, get a real
security review in ~30 seconds.

🧵
```

**Tweet 2** (the proof — attach `<pr-comment-screenshot>`):

```
this is what lands on every PR.

four detector families: SQL injection, XSS, command injection,
path traversal.

each finding has a file, a line, a severity, and a concrete patch
— not "consider parameterizing this query."
```

**Tweet 3** (the report — attach `<pdf-screenshot>`):

```
every scan also generates a branded PDF + SARIF report (signed
URL, 1h TTL).

attach the PDF to a compliance ticket. drop the SARIF into Code
Scanning, DefectDojo, or whatever else speaks SARIF.

no extra config — it's in the same comment.
```

**Tweet 4** (the differentiator):

```
fixor isn't competing with Snyk or Semgrep on rule count.

they have hundreds. fixor has 4 families.

the bet is on "fewest steps to a useful finding": no CI step, no
rules to write, AI-reasoned fixes that understand Express / Knex /
Prisma instead of regex-pattern-matching them.
```

**Tweet 5** (the operations — attach `<dashboard-screenshot>`):

```
each install has a hard monthly Anthropic budget cap.

free=$5, indie=$30, pro=$80, team=$200.

at 80% you get a heads-up in the comment + email + dashboard.
at 100% scans pause. the bill can never surprise you.
```

**Tweet 6** (the open-source play):

```
Fixor is MIT.

every claim above is grep-able against the source —
github.com/tornidomaroc-web/fixor

if the hosted version goes down, run it yourself:
$ git clone … && npm ci && npm start
```

**Tweet 7** (the close — attach `<demo-gif>`):

```
free tier is real: 5 scans/month on public repos, all four
detectors, no card.

install: <install-url>

if you try it and find a false positive — DM me, i want to know
about it.
```

**Posting tips:**

- Post the thread in one go via your client's "thread" mode. Don't manually reply or you'll lose the threaded behavior.
- Quote-tweet the first tweet ~6 hours later with "still around if anyone has questions" — bumps the reach.

---

## 3. Indie Hackers &mdash; launch post

**Title:**

```
I built an AI security reviewer for GitHub PRs in 6 weeks. Here's the build log.
```

**Body:**

```
Hey IH —

I'm Aboud (@tornidomaroc on X). I just shipped Fixor, an AI
security reviewer that runs on every GitHub pull request. It's
the first commercial thing I've built that I genuinely think
solo founders need, so I want to share the build log + what I
learned.

== The problem

I kept finding SQL injection in my own code. Embarrassing, but
also: I'm not unique. The Snyk/Semgrep tier of the market wants
you to wire up CI, write rules, and pay $40-50 per developer
per month. The free indie hacker isn't going to do that.

== What Fixor does

Install the GitHub App. Open a PR. ~30 seconds later you get a
structured comment with security findings + concrete patches.
Four detectors today: SQL injection, XSS, command injection,
path traversal.

The differentiator isn't rule count — it's "fewest steps to a
useful finding". Zero CI config, zero rules to write, framework-
aware fix patches that understand Express / Knex / Prisma instead
of pattern-matching them.

== The build

Six weeks of nights and weekends. The shape:

  Phase 4 — JS/TS analysis engine + first detector (SQL)
  Phase 5A — Postgres-backed cost ledger, Pino, Sentry, retry,
             health endpoints, signed Cloudinary URLs
  Phase 5B — Multi-tenancy: orgs, per-org settings, audit log,
             API tokens
  Phase 5C — Next.js dashboard with Clerk OAuth, scan history,
             trends widget, settings page, billing page
  Phase 5D — Paddle billing, webhook handler, customer portal,
             Resend templates
  Phase 5E — Onboarding wizard, first-scan email, 80%-of-budget
             nudge in three places (PR comment + email + banner)
  Phase 5F — Status page, privacy/ToS, trust center, Mintlify
             docs, README polish, this post

The full roadmap with what's checked off is at
docs/INDIE-SAAS-ROADMAP.md in the repo.

== Three things I learned

1. **Budget caps are a feature, not just a guard.** Telling
   customers "Fixor will pause before spending $30 of Anthropic
   credits this month" sells the trust they actually want from
   an AI tool more than any "low FP rate" claim.

2. **Paddle over Stripe is a real option for non-US founders.**
   Stripe wasn't available in my country. Paddle was. They handle
   VAT, sales tax, chargebacks. The integration was harder than
   Stripe (per-subscription portal URLs vs Customer Portal
   sessions) but it works and the customer experience is
   indistinguishable.

3. **The dashboard isn't optional.** I started thinking the
   GitHub PR comment was the whole product. Wrong: customers
   need somewhere to see scan history, tune detectors, change
   tier, manage billing. The dashboard took most of two phases.

== Pricing + free tier

  Free  — $0   — 5 scans/mo on public repos
  Indie — $29  — 100 scans/mo, 1 private repo
  Pro   — $79  — 500 scans/mo, 5 private repos
  Team  — $199 — 2,000 scans/mo, unlimited

The free tier is real. I want people to try it before paying.
Goal is $1k MRR within 6 months — happy to share the actual
revenue if/when I hit it.

== Next 30 days

I'm posting this on launch day, so the answer is "see what
sticks". Specifically:

  - Soft-launch on X / HN / IH today
  - Watch for friction in the install flow + first scan
  - Ship Python detectors if 3+ paying customers ask for them
    (this is my "build based on demand signal" rule, not pre-
    emptive scope)

If you're building anything in JS/TS, install Fixor on a side
project — even the free tier will catch real bugs. And if you
hit anything weird, DM me here or email support@fixor.dev — I
read every one personally.

  Source:  github.com/tornidomaroc-web/fixor
  Install: <install-url>
  Landing: <landing-url>
```

**Posting tips:**

- IH is a slower-burn community than HN. Comments roll in over 24-48 hours, not the first hour.
- Reply to every comment with substance, not just "thanks!" — the audience is other builders who can tell the difference.

---

## 4. Product Hunt &mdash; launch package

**Tagline** (max 60 chars):

```
AI security review on every GitHub PR — install in 60 seconds.
```

**Description (short)** (max 260 chars):

```
Fixor reviews every pull request for SQL injection, XSS, command
injection, and path traversal. Posts a structured comment with
concrete fixes + a PDF/SARIF report. No CI step, no rules to
write. MIT-licensed; free tier is real.
```

**Description (long)** — paste into the "Topics & description" longer field:

```
Most security tools want you to wire up CI, write rules, and pay
per-developer before you've tried them. Fixor flips that:

✓ Install once on GitHub
✓ Open a PR — get a structured review back in ~30s
✓ Concrete fix patches (Claude reasons about your specific code,
  not regex)
✓ Branded PDF + SARIF report linked in the comment
✓ Per-org Anthropic budget cap so the bill never surprises you
✓ Real free tier: 5 scans / month on public repos, all 4
  detectors, no card

Today: SQL injection, XSS, command injection, path traversal —
JS/TS. Python next.

MIT-licensed at github.com/tornidomaroc-web/fixor — every claim is
grep-able against the source.

Built solo in 6 weeks. Free tier is the front door; paid tiers
($29 / $79 / $199 via Paddle) keep the lights on.
```

**First comment (post immediately after the listing goes live):**

```
Hey PH — Aboud (@tornidomaroc) here, the solo founder.

Fixor is what I wish I'd had on my own side projects. The pitch is
simple: GitHub App install + ~30 seconds to a structured PR review
with concrete fixes, not just "consider parameterizing this
query".

The differentiator vs Snyk Code or Semgrep isn't the rule count —
they have hundreds, Fixor has 4 detector families. It's "fewest
steps to a useful finding". No CI step, no rules to write, AI-
reasoned patches that understand Express / Knex / Prisma instead
of pattern-matching them.

Three things I'd love feedback on:

1. The free tier (5 scans/month, public repos, all 4 detectors).
   Is that the right shape for "let me try it before paying"?
2. The 4 detector families. If you scan JS/TS and the next family
   you'd want isn't already on the list, tell me — paid-customer
   demand drives the order.
3. The dashboard onboarding (install → first scan → tune
   detectors). Anything confusing?

Will be in this thread for the next 8 hours. AMA.
```

**Topics to attach:** Developer Tools, Open Source, GitHub, AI, Productivity

**Logo:** the orange shield icon at 240x240 (already in `landing/index.html` SVG; export it).

**Gallery images** (in this order):

1. `<pr-comment-screenshot>` — the PR comment that lands on every PR
2. `<pdf-screenshot>` — the branded PDF report's first page
3. `<dashboard-screenshot>` — `/orgs/<id>/scans` showing trends + history
4. The pricing grid screenshot (4 tiers from `/orgs/<id>/billing` or the landing)
5. `<demo-gif>` — the 30-second install→PR→comment loop

**Posting tips:**

- PH timing is **00:01 PT** — that's when the day's listings reset. Schedule for that exact moment, not 6am or 8am.
- Hunters with audiences can submit on your behalf, but for a small launch a self-submission is fine.
- Stay online for the first 4 hours. Upvote your first comment from a different signed-in account if you have one (PH allows this for the maker). Reply to every other comment within 30 minutes.

---

## 5. Posting calendar (5F-7 references this)

**Tuesday morning, ET timezone** — proven to outperform Mon/Fri for technical-audience launches.

| Time | Platform | Action |
|---|---|---|
| 00:01 PT | Product Hunt | Listing goes live |
| 06:00 PT | Indie Hackers | Submit launch post |
| 08:00 ET | Hacker News | Submit Show HN |
| 08:00 ET | X / Twitter | Post the thread |
| 09:00 ET | Reddit r/programming | Cross-post the HN URL with a brief context paragraph |
| Ongoing | Email + Slack | Stay reachable; respond within 30 min for first 8 hours |

The intent is to crest as many launch waves as the same day allows without spreading attention so thin that you can't respond to comments. Eight hours of focused presence beats 24 hours of half-attention.

---

## 6. After-launch follow-up (first 7 days)

These are the posts to write **after** you see what stuck:

- **Day 2 retro thread on X** — "24 hours of Fixor: what surprised me". Numbers if good, lessons if not. Lower-key than the launch thread; people are watching for whether you ghost or stay engaged.
- **Day 5 IH update post** — "First 100 sign-ups: here's what they've installed Fixor on". Honest cohort breakdown.
- **Day 7 GitHub release notes** — `v0.1.0` tag with a CHANGELOG that pulls Phase 4 → Phase 5 highlights. Useful for anyone arriving from delayed search results.

Don't write any of these in advance — they only land authentically with real numbers. The hooks are pre-recorded; the data isn't.
