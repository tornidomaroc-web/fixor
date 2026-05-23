# App Router coverage plan (honesty + capability)

**Status:** approved 2026-05-23, awaiting fresh-session execution.
**Owner:** Claude Code (fresh session). No operator action required for either track.
**Hold pattern:** Track 1 (docs) ships standalone. Track 2 (code) halts at Phase A decision gate for review before further commitment.

## Background

Fixor ships six business-logic detectors, scoped in `docs/detector-capabilities.md`. The route-shape sub-claims (auth-bypass missing-middleware, admin-check missing-admin-gate, webhook-unverified URL-name prefilter) rely on a shared `EXPRESS_ROUTE_DEF_RE` regex defined in `src/analysis-engine/detectors/shared/route-def-pattern.ts`. That regex matches router-method-call syntax: `\b(?:router|app|api|...App|...Api)\.(?:get|post|put|delete|patch|use|all)\s*\(`.

A real-world readiness scan of `inbox-zero/apps/web/app/api/` (228 Next.js App Router files) on 2026-05-23 produced **0 findings** across all 6 detectors in 14m22s. Investigation confirmed the cause: 154 of those files use `export const POST = withX(...)` or `export async function GET(...)` (App Router file-system-routed handlers), and 0 use the `router.METHOD(...)` syntax the prefilter requires. The route-shape detectors silently skip the entire file-system-routed paradigm.

The webhook-unverified detector's URL-name prefilters (5 of its 11 patterns) also miss App Router because they look for the URL string literal inside file content; App Router puts URL routing in the file path. Verified against `apps/web/app/api/lemon-squeezy/webhook/route.ts` which DOES correctly verify HMAC SHA256 with `crypto.timingSafeEqual` — Fixor never saw the file because no prefilter pattern fired.

**The gap is precise and bounded:**
- **2 of 9 sub-claims hard-broken on file-system-routed frameworks:** auth-bypass missing-middleware, admin-check missing-admin-gate.
- **1 sub-claim (webhook-unverified) bifurcated:** content patterns (lib imports, anti-patterns like `WEBHOOK_VERIFY=off` and non-timing-safe signature compares) still fire on App Router; URL-name patterns do not. DIY-HMAC handlers without webhook-lib imports are invisible.
- **3 of 6 detectors work by design on App Router:** IDOR has an explicit `nextjs_destructured` prefilter pattern (`idor.detector.ts` SOURCE_PATTERNS, search for `params\s*:\s*\{`); env-exposure is route-shape independent; secrets-exposure includes Next.js-aware `NEXT_PUBLIC_*` patterns.

**Critical caveat to carry into execution:** the 3 detectors that work "by design" on App Router were NOT verified on a live App Router scan with planted vulnerabilities. inbox-zero produced 0 findings because inbox-zero is well-secured. "Designed to work" is not "verified working." Track 2 Phase A measures this.

The current public claims (README, mintlify, detector-capabilities.md) imply App Router coverage that does not exist for the 2.5 broken sub-claims. This is a credibility landmine of the same silent-fail class as the dashboard allowlist bug fixed in PR #56. Customer installs Fixor on App Router repo → sees 0 findings on vulnerable diff → believes code is clean.

This plan has two tracks. Track 1 corrects the claims (no code). Track 2 lifts the gap (real code, with a load-bearing verification step first).

---

## Track 1 — Honesty (claims alignment, ~30-60 min, ships standalone)

### Goal

Public claims match measured reality. Today's claims imply App Router coverage that does not exist for 2.5 sub-claims. This eliminates a credibility landmine before Track 2 even starts.

### Why ships independently of Track 2

Track 2 might never happen, or might happen in 6 months. The honesty problem is live today and shipped to customers via README and `docs.fixor.dev` (mintlify-rendered). Truth-telling first, capability expansion second.

### Work items (4 files, ~9 specific edits, in dependency order)

**1.1 — `docs/detector-capabilities.md`** (source of truth — do this FIRST, the others reference it)

- Add explicit "Next.js App Router and Remix file-system-routed handlers" line to the **auth-bypass DOES NOT CLAIM** section. Distinguish: sentinel sub-claim still works on App Router file content (content-based regex), missing-middleware sub-claim does not (requires `EXPRESS_ROUTE_DEF_RE` which doesn't match `export const POST = ...`).
- Mirror the addition in the **admin-check DOES NOT CLAIM** section. Same distinction: hardcoded-admin sub-claim works, missing-admin-gate sub-claim does not.
- In the **webhook-unverified "Critical scope limitation"** paragraph, expand from one limitation to two:
  - (a) URL is matched in file content not file path, so App Router/Remix handlers at `app/api/<provider>/webhook/route.ts` are invisible to URL-name prefilter
  - (b) DIY-HMAC handlers without webhook-lib imports are invisible to content prefilter. Cite the inbox-zero Lemon Squeezy example: `apps/web/app/api/lemon-squeezy/webhook/route.ts` correctly verifies with `crypto.timingSafeEqual`, never reached the LLM
- Update the **"Out of scope across the board"** section: replace "Express-family today" framing with precise sub-claim scoping. Route-shape sub-claims are router-style only (Express/Fastify/Koa/Hono/Flask/Rails/Go HTTP routers). Content-based sub-claims (sentinel strings, IDOR source/sink with explicit `nextjs_destructured` support, env-exposure, secrets-exposure including `NEXT_PUBLIC_*` Next.js-aware patterns) work normally on file-system-routed frameworks.

**1.2 — `README.md`** (4 edits)

- The webhook capability row currently says: `🪝 Unverified webhook handlers — incoming webhook routes that skip signature verification (Stripe / GitHub / Twilio / Slack / Lemon Squeezy / custom-HMAC)`. The provider list implies provider-recognition; the prefilter is URL-name + lib-import + anti-pattern, not provider-name. Rewrite to describe mechanism (URL-name prefilter on router-style frameworks, plus lib-import / anti-pattern content prefilter on any framework). The provider list moves to "Provider fixtures:" framing.
- Insert a new framework-scoping row before the language rows in the capability table. One row that says: route-shape detection is router-style only; content-based detection works on file-system-routed frameworks (Next.js App Router, Remix). Mark 🟡 Partial.
- The comparison-table Languages cell currently says: `JS/TS full · partial Python/Go/Ruby`. Tighten "JS/TS full" to acknowledge reduced coverage on App Router. Cell length is the constraint; the new framework-scoping row above carries the precision.
- Existing capability rows for auth-bypass and admin-check enumerate sentinel sub-claims only (which DO work on App Router). No change — they don't false-claim.

**1.3 — `docs/mintlify/detectors.mdx`** (3 edits, mirror detector-capabilities.md)

- Auth-bypass section "Explicitly not covered" list — add the Next.js App Router/Remix line with the same sentinel-vs-missing-middleware distinction.
- Admin-check section "Explicitly not covered" — same addition.
- Webhook-unverified "Critical scope limitation" paragraph — expand to two limitations as in 1.1.

**1.4 — `docs/mintlify/languages.mdx`** (1 edit)

- Add a framework caveat paragraph after the per-detector-per-language table. JS/TS coverage is full only for router-style frameworks; file-system-routed frameworks have reduced route-shape coverage but full content-based coverage. Link to `detector-capabilities.md` for per-sub-claim scope.

### What's NOT in Track 1

- `landing/terms.html` — verified clean (no framework claims; Section 1 describes detector classes generically, Section 7 carries warranty weight detection-class-agnostic).
- `docs/mintlify/{introduction.mdx, quickstart.mdx, faq.mdx, api-reference.mdx}` — verified clean (no framework-specific claims).
- Dashboard files (`detectors.ts`, `tiers.ts`, `trends-chart.tsx`, etc.) — no framework claims.
- Any code change. Track 1 is pure docs.

### Track 1 execution

- One single PR titled exactly: `docs: scope route-shape detector claims to router-style frameworks (App Router gap)`
- PR body explains: detection gap surfaced by inbox-zero scan (228 App Router files, 0 findings), corrections align public claims with measured behavior, no code change.
- Effort: 30-60 min focused work. One sub-session of one fresh session.
- Owner: fresh session (Claude Code).

---

## Track 2 — Capability (real code, App Router route-shape coverage)

### Goal

Make auth-bypass missing-middleware, admin-check missing-admin-gate, and webhook-unverified detectors fire on Next.js App Router and Remix file-system-routed handlers. Verify with a planted-vuln fixture, then re-confirm on the live inbox-zero scan that motivated this plan.

### The architectural question — answered

**Track 2 is a prefilter extension, not a cross-file architectural change. Estimated ~1 week of focused work in a fresh session.**

Evidence (read `apps/web/utils/middleware.ts` in inbox-zero, ~720 lines):

A real App Router route file looks like:
```
import { withAdmin } from "@/utils/middleware";
export const GET = withAdmin("scope", async () => { ... });
```

To judge whether this route is admin-gated, Fixor needs to:
1. See the route file (already does — whole-file context post-PR #53)
2. See the import: `import { withAdmin } from "@/utils/middleware"` (already does — imports are in the file)
3. Recognize that `withAdmin(...)` is an auth-suggesting HOC by name convention (an LLM-stage judgment, same shape as today's "is `requireAuth` in the middleware list" judgment for Express)

**No cross-file analysis required for the common case.** The HOC import + call expression both live in the route file. The judgment is the same shape as Express's existing missing-middleware logic, adapted for `export const POST = withX(...)` syntax instead of `router.post(handler, withX)` syntax.

**Where this fails:** customer uses a generic-named HOC like `withRoute()` or `appWrapper()` that hides auth invisibly. Same documented limitation as Express's `router.use(authMiddleware)` in a different file (already out-of-scope per current detector-capabilities.md). No new architectural debt.

### Phase A — Verification fixture FIRST (no detector code yet)

**Why first:** the inbox-zero scan only proved "Fixor produces 0 findings on App Router." It did NOT prove the 3 detectors that should work on App Router (IDOR, env-exposure, secrets-exposure) actually fire end-to-end — they got 0 findings because inbox-zero is well-secured, indistinguishable from "never fired." Phase A measures this before committing Phase B effort.

**Work items:**

1. **Build `fixor-demo-app-router/`** — a small Next.js App Router-shaped repo mirroring the structure of the existing `fixor-demo/` (located at `D:/RAGHAD JAD/fixor-demo` per prior session work). Plant exactly one vulnerability per detector:

   - **Auth-bypass missing-middleware**: `app/api/admin/users/delete/route.ts` with `export async function POST(req)` that calls `db.user.delete(req.body.userId)` and is NOT wrapped in any HOC, where a sibling route at `app/api/admin/users/route.ts` IS wrapped in `withAdmin(...)`.
   - **Admin-check missing-admin-gate**: `app/api/admin/settings/route.ts` privileged route with `export async function PUT(req)` and no admin wrapper.
   - **IDOR**: `app/api/orders/[id]/route.ts` with `export async function GET(req, { params }: { params: { id: string } })` and `prisma.order.findUnique({ where: { id: params.id } })` no ownership filter. **Critical: this tests the existing `nextjs_destructured` IDOR prefilter pattern, which exists at `src/analysis-engine/detectors/idor.detector.ts` in SOURCE_PATTERNS.** Confirms it actually fires on real App Router syntax including Next.js 15 async-params variants.
   - **Env-exposure**: `app/api/debug/env/route.ts` with `return NextResponse.json(process.env)`.
   - **Secrets-exposure**: `app/api/config/route.ts` with a hardcoded literal like `const openai = "sk-ant-api03-fake-token-for-test..."` or a `NEXT_PUBLIC_OPENAI_KEY = "sk-..."` assignment.
   - **Webhook-unverified**: `app/api/stripe/webhook/route.ts` DIY-HMAC handler with `export async function POST(req)` that does NOT import any webhook lib, does NOT call `timingSafeEqual`, and does NOT verify the signature.

2. **Run Fixor against `fixor-demo-app-router/`** with current main (no detector changes). Use `npm run scan -- D:/RAGHAD\ JAD/fixor-demo-app-router --yes`. Capture the full output. **Document which of the 6 detectors fire and which silently skip.** This is the ground-truth baseline for Track 2.

**Expected Phase A baseline (prediction, to be measured):**

| Detector | Predicted Phase A result |
|---|---|
| auth-bypass (missing-middleware) | Does NOT fire (hard gap) |
| admin-check (missing-admin-gate) | Does NOT fire (hard gap) |
| IDOR | **Likely fires** via `nextjs_destructured` pattern — but uncertain because Next.js 15 changed `params` to `Promise<...>`, may not match the regex |
| env-exposure | **Predicted fires** (content-based, route-shape independent) |
| secrets-exposure | **Predicted fires** (content-based, Next.js-aware patterns) |
| webhook-unverified | Does NOT fire (DIY-HMAC handler, no webhook-lib import) |

**Phase A effort:** ~3-4 hours focused (fixture authoring + one scan + documentation). Cost: ~$0.50.

**Phase A is the load-bearing risk reduction.** If the IDOR `nextjs_destructured` pattern doesn't fire (Next.js 15 async-params regression), the gap is wider than predicted and Track 2 scope grows beyond 1 week.

**Phase A decision gate:** report the result and HALT. Do NOT begin Phase B until the gap is reviewed and continuation explicitly approved. If Phase A reveals the gap matches predictions (2 hard misses + 1 bifurcated + 3 working), proceed to Phase B as planned. If Phase A reveals wider gaps (e.g. IDOR also broken on App Router), regroup before committing more.

### Phase B — Prefilter extension for route-shape detectors (~1-1.5 days)

**Conditional on Phase A approval.**

**Work items, in order:**

1. **Shared App Router prefilter pattern** — new exported constant in `src/analysis-engine/detectors/shared/route-def-pattern.ts` alongside the existing `EXPRESS_ROUTE_DEF_RE`. Match shape (regex equivalent of): `export\s+(?:const|(?:async\s+)?function|default\s+(?:async\s+)?function)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b`. Plus a variant for the assignment form `export const POST = withX(...)`. Document the new constant with the same rigor as `EXPRESS_ROUTE_DEF_RE`'s existing doc-comment.

2. **Wire pattern into 3 detectors** — add the new pattern to `PREFILTER_PATTERNS` in:
   - `src/analysis-engine/detectors/auth-bypass.detector.ts`
   - `src/analysis-engine/detectors/admin-check.detector.ts`
   - `src/analysis-engine/detectors/webhook-unverified.detector.ts`
   Use the existing `tier: "judgment"` mechanism and whole-file context selection (already implemented per PR #53 / PR #54). The new pattern entries should be sibling additions, not replacements.

3. **Extend system prompts** — three prompt edits to teach the LLM that App Router handlers are wrapped in HOCs by convention. Add guidance specifically:
   - Recognize common auth-HOC naming patterns: `withAuth`, `withAdmin`, `requireAuth`, `requireAdmin`, `withSession`, `protect`, `secure`, `authMiddleware`, `withMiddleware(auth, ...)`.
   - Explicit guidance: "if the exported handler is wrapped in a higher-order function whose NAME suggests auth/admin enforcement, treat as gated unless surrounding context contradicts. If the wrapper's name does NOT suggest auth (`withLogging`, `withCors`, `withRateLimit`, `withTrace`), do NOT assume gating."
   - For webhook-unverified specifically, also add: "App Router webhook handlers can be identified by file path containing `/webhook/` or `/hooks/` (caller will provide path metadata in the prompt context) OR by handler importing `node:crypto` with HMAC operations. Treat these as in-scope even without webhook-lib imports."

4. **Update `docs/detector-capabilities.md` CLAIMS rows** — promote the auth-bypass missing-middleware sub-claim to include "Next.js App Router and Remix" coverage. Same for admin-check. Same for webhook-unverified. Track 1's DOES-NOT-CLAIM additions get correspondingly tightened (the App Router exclusion gets removed once we cover it).

**Phase B effort: 1-1.5 days focused work.** Medium uncertainty: prompt-tuning iteration could expand if the LLM mis-judges HOC names on first calibration.

### Phase C — App Router fixtures + baseline (~1-1.5 days)

**Work items:**

1. Add positive + negative App Router fixtures for each of the 3 detectors. Target ~3 positive + ~3 negative per detector = ~18 new fixtures. Mirror the existing Express fixture patterns at `fixtures/<detector>/positive/*` and `fixtures/<detector>/negative/*`, but in `export const POST = withX(...)` shape with realistic HOC wrappers.

2. **Critical fixtures to include** (covers the hardest-technical-risk cases):
   - Positive: route wrapped in `withLogging(...)` (generic HOC, NOT auth) → must still flag as missing-middleware.
   - Positive: route wrapped in `withRoute(handler)` (deceptive generic name that hides auth in implementation) → must flag (we can't verify cross-file; documented limitation).
   - Negative: route wrapped in `withAuth(...)` → must skip (LLM recognizes name convention).
   - Negative: route wrapped in `withAdmin(...)` → must skip.

3. Run baselines, tune prompts on any miscalibration, save logs to `test-output/` following the established naming convention.

4. Update `docs/detector-capabilities.md` to cite the new baseline log paths.

**Phase C effort: ~1-1.5 days focused.** Fixture authoring is mechanical but time-consuming; calibration tuning is the variable.

### Phase D — Re-verification on real OSS (~half day)

**Work items:**

1. **Re-scan `D:/RAGHAD JAD/inbox-zero/inbox-zero/apps/web/app/api/`** with the extended detectors. Compare to the 0-findings baseline from the 2026-05-23 session. Expected: some findings (HOC-name-convention judgments), the LLM correctly classifying most as safe (inbox-zero IS well-secured), maybe 0-3 actual flags. Document the new finding count and qualitative read.

2. **Repeat on `D:/RAGHAD JAD/Trigger.dev/trigger.dev/apps/webapp/app/routes/`** as a Remix-style file-system-routed test. May or may not be covered by the same prefilter patterns. If Remix uses different export conventions, scope a Phase E follow-up.

3. **Update README + mintlify** to reflect the now-shipping coverage (this REVERSES some of the Track 1 honesty additions — Track 1 said "App Router not covered," Track 2 lifts that to "App Router covered for auth-bypass / admin-check / webhook-unverified missing-middleware sub-claims"). Do NOT delete the Track 1 additions; modify them to be precise about the now-shipping state.

**Phase D effort: ~half day.**

### Hardest technical risk in Track 2

**The HOC-name-convention gamble.** Phase B's system prompt extension teaches the LLM to judge gating by HOC name (`withAuth`, `withAdmin`, etc.). This works if customers use convention-named HOCs (true for most real codebases). It fails if:

- Customer uses a generic-named HOC like `withRoute()` or `appWrapper()` that hides auth invisibly → we false-positive (flag a route as unguarded when the generic wrapper does enforce auth).
- Customer uses a deceptively-named HOC like `withAuth()` that does NOT actually enforce auth → we false-negative.

**Both failure modes already exist for Express today** — `router.use(authMiddleware)` in a different file is the equivalent gap, documented as out-of-scope. The App Router version is "HOC wrapper not visibly named for auth" — same shape, document the same way.

**Pre-Phase-C mitigation:** the App Router fixture set in Phase C MUST include both convention-named positives (`withAuth` → safe) and ambiguous-name negatives (`withLogging` → still missing-middleware). If the LLM mis-judges these in baseline runs, the prompt needs revision before claiming coverage. If the prompt cannot be tuned to distinguish reliably within Phase B's effort budget, Track 2 halts and we ship the narrower Track-1-aligned claim instead.

### Phased effort summary (honest ranges with uncertainty named)

| Phase | What | Effort | Uncertainty |
|---|---|---|---|
| A | Verification fixture + baseline scan | 3-4 hours | Low — straightforward scaffolding |
| B | Prefilter + prompt extensions | 1-1.5 days | Medium — prompt-tuning iteration could expand if LLM mis-judges HOC names |
| C | App Router fixtures + baselines | 1-1.5 days | Medium — fixture authoring mechanical; baseline calibration variable |
| D | Re-scan inbox-zero + Trigger.dev + claim re-tightening | half day | Low |
| **Total** | **3-4 days focused** | Realistic 5 days if Phase B prompt-tuning iterates more than expected |

### Track 2 estimate, honest summary

**Realistic: 1 week of focused work in a fresh session.** Not weeks-plural. Not a month.

**If Phase A reveals the gap is wider than predicted** (especially the IDOR `nextjs_destructured` pattern not firing on Next.js 15 async params, OR HOC patterns too diverse for convention-based recognition), **scope grows to 1.5-2 weeks** for cross-file-analysis fallback. Phase A's purpose is to detect this before committing larger investment.

### Track 2 owner

Fresh session (Claude Code). No operator action required.

---

## Recommended sequence

**1 → 2A → DECISION GATE → 2B → 2C → 2D**

1. **Track 1 first.** 30-60 min. Ships truth immediately, independent of Track 2. Eliminates the credibility landmine.
2. **Track 2 Phase A** (verification fixture). Half day. Measures the actual baseline. **HALT after Phase A. Decision gate: review the Phase A result and explicitly approve Phase B continuation.**
3. **Track 2 Phases B → C → D** sequentially. ~1 week total.

Alternatives considered and rejected:

- **Track 2 first without Track 1:** leaves the credibility landmine alive for 1-2 weeks while Track 2 builds. Wrong tradeoff.
- **Skip Phase A and go straight to Phase B:** imports the "everything is ready" failure mode this plan exists to prevent. Phase A is half-day insurance against a 5-day mistake.
- **Skip Track 2 entirely, narrow the public claim permanently:** defensible but leaves a real prospect-value gap. Next.js App Router is huge. Worth one focused week if Phase A doesn't reveal blockers.

---

## What we are explicitly NOT doing in either track

- **Building cross-file analysis** (reading `middleware.ts` from a route file to verify what `withAdmin` does). Phase A measures whether HOC-name-convention is sufficient; cross-file is the fallback if it isn't.
- **Building `.fixorignore`** or `--include-dir` override flags. Out of scope.
- **Re-baselining the existing 6 detectors.** Existing baselines (post-PR-#57) stay; Track 2 adds NEW App Router baselines as additional files.
- **Touching the dashboard or any UI surface.** Phase D might want a "framework coverage" badge eventually; not in this plan.
- **Building Remix-specific prefilters separately.** Phase A and B treat Next.js App Router and Remix as the same shape (file-system-routed `export METHOD` handlers). If Phase D's Trigger.dev scan reveals Remix shape differs meaningfully, scope a Phase E follow-up.
- **Building additional OSS readiness scans** (Cal.com, Documenso, Plane, etc.). The inbox-zero result + Track 2 Phase A fixtures are sufficient signal. More OSS scans = scope creep without new information.
- **Implementing the deferred `feat(api)`** for pdfUrl/sarifUrl/cost in v1 scan response. Still deferred. Unrelated to App Router coverage.
- **Phase C launch material rewrites** (`LAUNCH-POSTS.md`, lead drafts). Send-time triggers; not part of this plan.

---

## What this plan does NOT promise

- Track 2 may produce a calibration result we don't like (high FP or FN rate on the new App Router fixtures). The plan assumes Phase B prompt-tuning gets us to acceptable accuracy in 1-1.5 days; if it doesn't, scope grows.
- Track 2 does NOT promise coverage on every Next.js paradigm. Pages Router (still widely deployed) might need its own prefilter pass — out of scope for v1.
- Track 2 does NOT promise the inbox-zero re-scan in Phase D will produce non-zero findings. inbox-zero is genuinely well-secured. A clean re-scan would be a TRUE NEGATIVE, not a failure. Phase D's point is to confirm detectors fire end-to-end on App Router, not to find bugs in inbox-zero.

---

## Reference points for the fresh session

The fresh session should be able to execute this plan without re-reading the conversation that produced it. Key references:

- **Detector source code:** `src/analysis-engine/detectors/{auth-bypass,admin-check,idor,env-exposure,secrets-exposure,webhook-unverified}.detector.ts`. Each has a `PREFILTER_PATTERNS` constant near the top of the file.
- **Shared route-def pattern:** `src/analysis-engine/detectors/shared/route-def-pattern.ts` (defines `EXPRESS_ROUTE_DEF_RE` + `buildFunctionCodePayload` helper). New `APP_ROUTER_ROUTE_DEF_RE` constant goes here.
- **Scope contract:** `docs/detector-capabilities.md`. Authoritative; if a public surface contradicts it, the public surface is the bug.
- **Existing test pattern:** `src/test/test-*.ts` files. Each detector has a fixture suite at `fixtures/<detector>/positive/*` and `fixtures/<detector>/negative/*`. Run via `npm run test:<detector>`.
- **Real-world App Router auth pattern:** `D:/RAGHAD JAD/inbox-zero/inbox-zero/apps/web/utils/middleware.ts` defines `withAuth`, `withAdmin`, `withError`, `withEmailAccount`, `withEmailProvider` as the HOC convention. Route files import these and wrap exports. Read the first ~50 lines for the type signatures, then `withAdmin` at the bottom for the simplest example.
- **The 0-findings inbox-zero baseline:** `test-output/inbox-zero-api-scan.md` and `test-output/inbox-zero-api-scan.stdout.log` (created 2026-05-23). 228 files, 0 findings, 14m22s runtime.
- **Existing PRs that established the shared infrastructure** Track 2 builds on: PR #53 (auth-bypass missing-middleware + whole-file context), PR #54 (webhook-unverified promoted), PR #55 (capability contract), PR #56 (admin-check + SHIPPING_DETECTOR_IDS + scan-time suppression), PR #57 (--yes flag + re-baselines), PR #58 (trends-chart colors + docs link removed), PR #59 (terms.html), PR #60 (mintlify rewrite), PR #61 (file-walker default skips + structured WalkResult).

---

## Fresh-session brief (copy-pasteable)

Use this verbatim to start the fresh session that executes this plan:

> Execute `docs/APP-ROUTER-COVERAGE-PLAN.md` starting with Track 1 (single docs PR titled `docs: scope route-shape detector claims to router-style frameworks (App Router gap)`, ~30-60 min). After Track 1 ships, begin Track 2 Phase A: build `fixor-demo-app-router/` planted-vuln repo as specified in the plan, scan with current main, document which of the 6 detectors fire end-to-end on App Router. Report the Phase A baseline and HALT. Do not begin Phase B until I review and explicitly approve continuation. If Phase A reveals the gap is wider than the plan predicts (especially the IDOR `nextjs_destructured` pattern not firing on Next.js 15 async params), report scope-growth honestly rather than absorbing silently. Track 2 Phases B-D execute only after Phase A approval. The plan's "What we are NOT doing" section is the scope boundary — do not exceed it.
