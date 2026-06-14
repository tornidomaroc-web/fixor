# Launch posts: drafts (do not post yet)

> **Status (2026-05-31):** rewritten post-pivot to the six business-logic
> detectors. Aligned to `docs/detector-capabilities.md` (the scope contract).
> QUARANTINED pending founder sign-off. Do not post any of this until signed off.
> The roadmap's 5F-7 calendars the actual posting (HN at 8am ET Tuesday, etc.).

Each section below is one platform, written in that platform's voice: the HN
draft is dry and technical, the X thread is punchy with screenshot cues, IH is
journey-driven, Product Hunt is tagline-first.

**Before posting**, do this find/replace pass:

- `<SIGN-OFF-REQUIRED-DO-NOT-POST>` confirm founder sign-off, then delete this token from every post body. If the token is still present, the copy is NOT cleared to post.
- `<install-url>` to the final GitHub App install URL (likely `https://github.com/apps/fixor-security/installations/new`)
- `<landing-url>` to the final landing URL (likely `https://fixor.dev` once DNS is live; until then the GitHub Pages URL)
- `<demo-gif>` to the 30-second demo GIF from the marketplace asset checklist
- `<pr-comment-screenshot>` to the PR comment screenshot from the marketplace asset checklist
- `<pdf-screenshot>` to the PDF report screenshot
- `<dashboard-screenshot>` to the `/orgs/<id>/scans` screenshot
- `support@fixor.dev` to your real address if it differs

The differentiator line is the same across all four posts. Keep it consistent.

---

## 1. Hacker News: Show HN

**Title** (less than 80 chars):

```
Show HN: Fixor – AI business-logic security review on every GitHub PR (MIT)
```

**Body** (paste into the URL field as the link, then this in the text field):

```
<SIGN-OFF-REQUIRED-DO-NOT-POST>
Hi HN. I kept shipping endpoints that trusted whoever called them: a
GET /:id route with no ownership check, an admin action gated only by
"is the user logged in." Dependency scanners and pattern matchers
sailed straight past them, because catching that needs reasoning about
auth, ownership, and roles, not patterns. That gap is what Fixor is for.

Fixor is a GitHub App. Install it on a repo, open a PR, and ~30 seconds
later a structured comment lands with each finding's file, line,
severity, a precise explanation, and remediation steps. No CI step. No
rules to write. No tokens to rotate.

What it detects today (six business-logic classes, Node/TypeScript):

  - Authentication bypass (role-to-admin fallbacks, swallowed token
    verification, hardcoded bypass flags)
  - IDOR (resource access with no ownership check)
  - Weak admin checks (privilege gated by hardcoded email/role
    allowlists or a client-supplied role)
  - Env-variable exposure (secrets leaked through env vars into
    response bodies)
  - Hardcoded secrets (API keys, tokens, signing secrets in source)
  - Unverified webhook handlers (handlers that skip signature
    verification)

JS/TS is the wedge; Python and Go have partial coverage and expand on
paid-customer demand.

The differentiator vs Snyk Code or Semgrep is not breadth. They cover
dependency CVEs and known injection patterns; Fixor covers the
business-logic class pattern-matchers structurally can't. Run both. The
bet for indie and small-team JS/TS shops is "fewest steps to a useful
finding": install the App, the next PR gets reviewed.

It is a second pair of eyes, not a guarantee. Every finding comes with
a precise explanation and remediation steps so you can judge it
quickly. It sharpens human review; it does not replace it.

Under the hood:

  - Each scan sends only the diff (not the full repo) to Anthropic's
    Claude API. Diffs are processed in memory and never written to
    our DB.
  - Each install gets a hard monthly Anthropic budget cap (free=$5,
    indie=$30, team=$200). At 80% we nudge in the comment, email, and
    dashboard; at 100% scans pause until next month or upgrade. Fixor
    can never blow up your bill.
  - The full code is MIT at github.com/tornidomaroc-web/fixor. Every
    claim on the trust center page is grep-able.

Pricing: the free tier is real (5 scans/month on public repos, all 6
detectors, no card). Paid tiers are $29 (Indie) and $199 (Team), billed
via Paddle (merchant of record, handles VAT).

Solo project, built over several weeks. Happy to answer questions about
the analysis engine, the cost-cap math, or why I chose Paddle over
Stripe (geographic constraints, not all founders can sign up for
Stripe).

Try it: <install-url>
Source: https://github.com/tornidomaroc-web/fixor
```

**Posting tips:**

- 8am ET Tuesday is conventional wisdom for Show HN. Stay logged in for the next 8 hours and respond to every comment within an hour, especially critical ones. Silence reads as defensive.
- Your first comment within 5 minutes of posting should be a one-paragraph "what I'd do differently next time." HN rewards self-awareness.

---

## 2. X (Twitter) thread

**Tweet 1** (the hook, most important):

```
<SIGN-OFF-REQUIRED-DO-NOT-POST>
i kept shipping routes that trusted whoever called them. a GET /:id
with no ownership check. an admin action gated by "is the user logged
in."

CVE scanners and pattern matchers missed all of it.

so i built Fixor: install the github app, open a PR, get a real
business-logic security review in ~30 seconds.

🧵
```

**Tweet 2** (the proof, attach `<pr-comment-screenshot>`):

```
this is what lands on every PR.

six business-logic classes: auth bypass, IDOR, weak admin checks,
env-variable exposure, hardcoded secrets, unverified webhooks.

each finding has a file, a line, a severity, a precise explanation,
and remediation steps.
```

**Tweet 3** (the report, attach `<pdf-screenshot>`):

```
every scan also generates a branded PDF + SARIF report (signed URL,
1h TTL).

attach the PDF to a compliance ticket. drop the SARIF into Code
Scanning, DefectDojo, or whatever else speaks SARIF.

no extra config. it's in the same comment.
```

**Tweet 4** (the differentiator):

```
fixor isn't competing with Snyk or Semgrep on rule count.

they cover dependency CVEs and injection patterns. fixor covers the
business-logic class they structurally can't: flaws that need
reasoning about auth, ownership, and roles.

run both.
```

**Tweet 5** (the operations, attach `<dashboard-screenshot>`):

```
each install has a hard monthly Anthropic budget cap.

free=$5, indie=$30, team=$200.

at 80% you get a heads-up in the comment, email, and dashboard.
at 100% scans pause. the bill can never surprise you.
```

**Tweet 6** (the open-source play):

```
Fixor is MIT.

every claim above is grep-able against the source:
github.com/tornidomaroc-web/fixor

if the hosted version goes down, run it yourself:
$ git clone … && npm ci && npm start
```

**Tweet 7** (the close, attach `<demo-gif>`):

```
free tier is real: 5 scans/month on public repos, all 6 detectors,
no card.

it's a second pair of eyes, not a guarantee. if you try it and hit a
false positive, DM me. i want to know.

install: <install-url>
```

**Posting tips:**

- Post the thread in one go via your client's "thread" mode. Don't manually reply or you'll lose the threaded behavior.
- Quote-tweet the first tweet ~6 hours later with "still around if anyone has questions" to bump reach.

---

## 3. Indie Hackers: launch post

**Title:**

```
I built an AI business-logic security reviewer for GitHub PRs. Here's the build log.
```

**Body:**

```
<SIGN-OFF-REQUIRED-DO-NOT-POST>
Hey IH,

I'm Aboud (@tornidomaroc on X). I just shipped Fixor, an AI security
reviewer that runs on every GitHub pull request and catches
business-logic flaws. It's the first commercial thing I've built that
I genuinely think solo founders need, so I want to share the build log
and what I learned.

== The problem

I kept shipping endpoints that trusted whoever called them: an /:id
route with no ownership check, an admin action gated only by a
logged-in check. The Snyk/Semgrep tier of the market is strong on
dependency CVEs and injection patterns, but those tools are blind to
business-logic flaws, and they want you to wire up CI, write rules,
and pay $40-50 per developer per month. The free indie hacker isn't
going to do that.

== What Fixor does

Install the GitHub App. Open a PR. ~30 seconds later you get a
structured comment with security findings, each with a precise
explanation and remediation steps. Six business-logic classes today:
auth bypass, IDOR, weak admin checks, env-variable exposure, hardcoded
secrets, unverified webhooks. Node/TypeScript is the wedge; Python and
Go are partial and expand on demand.

The differentiator isn't rule count. It's "fewest steps to a useful
finding," on a class the pattern-matchers structurally can't reach:
zero CI config, zero rules to write, findings that reason about your
specific Express / Prisma / auth code instead of pattern-matching it.
It's a second pair of eyes, not a guarantee.

== The build

Several weeks of nights and weekends. The shape:

  Phase 4: JS/TS analysis engine + first business-logic detectors
  Phase 5A: Postgres-backed cost ledger, Pino, Sentry, retry,
            health endpoints, signed Cloudinary URLs
  Phase 5B: Multi-tenancy: orgs, per-org settings, audit log,
            API tokens
  Phase 5C: Next.js dashboard with Clerk OAuth, scan history,
            trends widget, settings page, billing page
  Phase 5D: Paddle billing, webhook handler, customer portal,
            Resend templates
  Phase 5E: Onboarding wizard, first-scan email, 80%-of-budget
            nudge in three places (PR comment, email, banner)
  Phase 5F: Status page, privacy/ToS, trust center, Mintlify
            docs, README polish, this post

The full roadmap with what's checked off is at
docs/INDIE-SAAS-ROADMAP.md in the repo.

== Three things I learned

1. Budget caps are a feature, not just a guard. Telling customers
   "Fixor will pause before spending $30 of Anthropic credits this
   month" sells the trust they actually want from an AI tool.

2. Paddle over Stripe is a real option for non-US founders. Stripe
   wasn't available in my country. Paddle was. They handle VAT, sales
   tax, chargebacks. Harder integration than Stripe, but the customer
   experience is indistinguishable.

3. The dashboard isn't optional. I started thinking the GitHub PR
   comment was the whole product. Wrong: customers need somewhere to
   see scan history, tune detectors, change tier, manage billing.

== Pricing + free tier

  Free   $0     5 scans/mo on public repos, all 6 detectors
  Indie  $29    100 scans/mo, 1 private repo + unlimited public
  Team   $199   2,000 scans/mo, unlimited repos, priority support

The free tier is real. I want people to try it before paying. Goal is
$1k MRR within 6 months, happy to share the actual revenue if/when I
hit it.

== Next 30 days

I'm posting this on launch day, so the answer is "see what sticks."
Specifically:

  - Soft-launch on X / HN / IH today
  - Watch for friction in the install flow and first scan
  - Expand Python/Go coverage if 3+ paying customers ask for it
    (build on demand signal, not pre-emptive scope)

If you're building anything in JS/TS, install Fixor on a side project.
Even the free tier will catch real logic bugs. If you hit anything
weird, DM me here or email support@fixor.dev. I read every one
personally.

  Source:  github.com/tornidomaroc-web/fixor
  Install: <install-url>
  Landing: <landing-url>
```

**Posting tips:**

- IH is a slower-burn community than HN. Comments roll in over 24-48 hours, not the first hour.
- Reply to every comment with substance, not just "thanks!" The audience is other builders who can tell the difference.

---

## 4. Product Hunt: launch package

**Tagline** (max 60 chars):

```
Business-logic security review on every GitHub PR.
```

**Description (short)** (max 260 chars):

```
Fixor reviews every pull request for business-logic flaws: auth bypass,
IDOR, weak admin checks, env exposure, hardcoded secrets, unverified
webhooks. Posts a structured comment with explanations + remediation
and a PDF/SARIF report. No CI step, no rules. MIT; free tier is real.
```

**Description (long):**

```
<SIGN-OFF-REQUIRED-DO-NOT-POST>
Most security tools want you to wire up CI, write rules, and pay
per-developer before you've tried them, and they're blind to
business-logic flaws anyway. Fixor flips that:

✓ Install once on GitHub
✓ Open a PR, get a structured review back in ~30s
✓ A precise explanation and remediation steps per finding (Claude
  reasons about your specific code for five of the six detectors, not
  just regex; the hardcoded-secrets detector runs on high-precision
  patterns)
✓ Branded PDF + SARIF report linked in the comment
✓ Per-org Anthropic budget cap so the bill never surprises you
✓ Real free tier: 5 scans/month on public repos, all 6 detectors,
  no card

Six business-logic classes today: authentication bypass, IDOR, weak
admin checks, env-variable exposure, hardcoded secrets, unverified
webhook handlers. Node/TypeScript is the wedge; Python and Go are
partial. It's a second pair of eyes, not a guarantee.

Why alongside Snyk/Semgrep: they cover dependency CVEs and injection
patterns; Fixor covers the business-logic class they structurally
can't. Run both.

MIT-licensed at github.com/tornidomaroc-web/fixor. Every claim is
grep-able against the source.

Built solo. Free tier is the front door; paid tiers ($29 Indie / $199
Team, via Paddle) keep the lights on.
```

**First comment (post immediately after the listing goes live):**

```
<SIGN-OFF-REQUIRED-DO-NOT-POST>
Hey PH, Aboud (@tornidomaroc) here, the solo founder.

Fixor is what I wish I'd had on my own side projects: GitHub App
install plus ~30 seconds to a structured PR review with a precise
explanation and remediation steps, on a class of bug CVE scanners
miss.

The differentiator vs Snyk Code or Semgrep isn't rule count. They
cover dependency CVEs and injection patterns; Fixor covers the
business-logic class they structurally can't (auth, ownership, roles).
It's "fewest steps to a useful finding": no CI step, no rules to write.

Three things I'd love feedback on:

1. The free tier (5 scans/month, public repos, all 6 detectors). Right
   shape for "let me try it before paying"?
2. The six detector families. If the next business-logic class you'd
   want isn't on the list, tell me. Paid-customer demand drives the
   order.
3. The dashboard onboarding (install, first scan, tune detectors).
   Anything confusing?

Will be in this thread for the next 8 hours. AMA.
```

**Topics to attach:** Developer Tools, Open Source, GitHub, AI, Productivity

**Logo:** the orange shield icon at 240x240 (already in `landing/index.html` SVG; export it).

**Gallery images** (in this order):

1. `<pr-comment-screenshot>` the PR comment that lands on every PR
2. `<pdf-screenshot>` the branded PDF report's first page
3. `<dashboard-screenshot>` `/orgs/<id>/scans` showing trends + history
4. The pricing grid screenshot (3 tiers from `/orgs/<id>/billing` or the landing)
5. `<demo-gif>` the 30-second install to PR to comment loop

**Posting tips:**

- PH timing is 00:01 PT, when the day's listings reset. Schedule for that exact moment.
- Hunters with audiences can submit on your behalf, but for a small launch a self-submission is fine.
- Stay online for the first 4 hours. Reply to every comment within 30 minutes.

---

## 5. Posting calendar (5F-7 references this)

**Tuesday morning, ET timezone.** Proven to outperform Mon/Fri for technical-audience launches.

| Time | Platform | Action |
|---|---|---|
| 00:01 PT | Product Hunt | Listing goes live |
| 06:00 PT | Indie Hackers | Submit launch post |
| 08:00 ET | Hacker News | Submit Show HN |
| 08:00 ET | X / Twitter | Post the thread |
| 09:00 ET | Reddit r/programming | Cross-post the HN URL with a brief context paragraph |
| Ongoing | Email + Slack | Stay reachable; respond within 30 min for first 8 hours |

The intent is to crest as many launch waves as the same day allows without
spreading attention so thin that you can't respond to comments. Eight hours of
focused presence beats 24 hours of half-attention.

---

## 6. After-launch follow-up (first 7 days)

Write these **after** you see what stuck:

- **Day 2 retro thread on X**: "24 hours of Fixor: what surprised me." Numbers if good, lessons if not.
- **Day 5 IH update post**: "First 100 sign-ups: what they've installed Fixor on." Honest cohort breakdown.
- **Day 7 GitHub release notes**: `v0.1.0` tag with a CHANGELOG that pulls the Phase 4 to Phase 5 highlights.

Don't write any of these in advance. They only land authentically with real numbers. The hooks are pre-recorded; the data isn't.
