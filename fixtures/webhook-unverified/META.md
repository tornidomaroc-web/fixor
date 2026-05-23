# webhook-unverified fixtures

## Phase F locked merge gate (2026-05-23)

Fixtures 14 and 15 (both positive and negative) are the symmetric-anchor pairs for the two Phase D inbox-zero FP classes:

- **Class (c) — cross-file verifier helper:** positive/14 + negative/14 anchor the Phase F prompt rule that recognizes a `verify*Payload` / `verify*Signature` / `verify*Webhook` / `validate*Webhook` / `check*Signature` helper imported and awaited from a non-stdlib path. Positive/14 has NO such call (must FLAG HIGH); negative/14 has the call (must route to MEDIUM/review-queue: isVulnerable=true, confidence=medium, NOT skip, NOT HIGH).
- **Class (d) — non-HMAC shared-secret challenge:** positive/15 + negative/15 anchor the Phase F prompt rule that recognizes a body field read + env-derived compare + unauthorized status on mismatch. Positive/15 reads the field with no compare (must FLAG HIGH); negative/15 compares to `process.env.GRAPH_CLIENT_STATE` and 403s on mismatch (must route to MEDIUM/review-queue).

The Phase F merge gate (enforced in `src/test/test-webhook-unverified.ts`) requires:

1. Combined accuracy stays at 24/30 or better (no regression below the pre-Phase-F 24/26 floor).
2. Positives 14 and 15 FLAG (HIGH-emit path).
3. Negatives 14 and 15 land at MEDIUM/review-queue (verdict.confidence === "medium" AND verdict.isVulnerable === true). NOT skip (which would mean LOW or isVulnerable=false — silenced), NOT HIGH (which would mean the tune didn't take).

A negative that routes to LOW is a silencing regression, not a Phase F success. The locked gate enforces MEDIUM specifically.

## Positive (real vulnerabilities)
- 01-stripe-no-sig.ts: Stripe webhook handler reads body without constructEvent
- 02-github-no-sig.ts: GitHub webhook handler ignores X-Hub-Signature-256
- 03-custom-no-hmac.ts: custom usage-event webhook accepts any JSON body
- 04-stripe-verify-toggle.js: Stripe verify skipped when STRIPE_WEBHOOK_VERIFY=off
- 05-lemon-no-sig.js: Lemon Squeezy order_created processed without verification
- 06-twilio-no-sig.js: Twilio inbound SMS webhook missing X-Twilio-Signature check
- 07-flask-stripe-no-sig.py: Flask Stripe handler reads JSON without construct_event
- 08-flask-github-no-sig.py: Flask GitHub handler doesn't verify X-Hub-Signature-256
- 09-go-stripe-no-hmac.go: Go Stripe handler decodes JSON, no HMAC validation
- 10-go-github-eq-compare.go: Go GitHub handler uses != string compare (timing leak)
- 11-app-router-stripe-no-sig.ts: Next.js App Router POST at app/api/stripe/webhook/route.ts processes events with no signature verification (Phase C, path-signal positive)
- 12-app-router-lemon-diy-hmac-stub.ts: Next.js App Router POST at app/api/hooks/lemon/route.ts imports node:crypto, computes an HMAC `expected` value, but never reads any incoming signature header and never compares — half-finished DIY-HMAC refactor (Phase C)
- 13-app-router-custom-url-sig-header-no-verify.ts: Next.js App Router POST at app/api/billing/events/route.ts (no /webhook/ segment) reads `x-webhook-signature` header but never compares — header-read-alone webhook-recognition anchor (Phase C, WH-P3 symmetric TP for W1)
- 14-app-router-apple-cross-file-no-call.ts: Next.js App Router POST at app/api/apple/webhook/route.ts processes events with NO verification at all — no helper call, no inline timingSafeEqual, no signature-header read (Phase F, WH-P14 symmetric POSITIVE anchor to negative/14 class-c cross-file-verifier-helper; must FLAG HIGH so the Phase F MEDIUM-routing rule does NOT over-generalize to "skip everything in /apple/webhook/")
- 15-app-router-graph-clientstate-no-compare.ts: Next.js App Router POST at app/api/outlook/webhook/route.ts reads `notification.clientState` but performs NO compare against any expected value — handler trusts the notification and processes it (Phase F, WH-P15 symmetric POSITIVE anchor to negative/15 class-d shared-secret-challenge; must FLAG HIGH so the Phase F MEDIUM-routing rule does NOT over-generalize to "any route that reads notification.clientState is verified")
- 16-remix-action-stripe-no-sig.ts: Remix v2 `export const action` at app/routes/webhook.stripe.ts processing Stripe events with no signature verification — no constructEvent, no HMAC, no timing-safe compare (Phase E, WH-P16)
- 17-remix-action-github-no-hmac.ts: Remix v2 `export const action` at app/routes/api.webhook.github.ts reading x-hub-signature-256 header but never comparing it to an HMAC of the body — handler dispatches on event type and writes to DB (Phase E, WH-P17)

## Negative (looks similar, actually safe)
- 01-stripe-construct-event.ts: Stripe webhook calls stripe.webhooks.constructEvent properly (Category B — context)
- 02-github-timing-safe-equal.ts: GitHub handler verifies via crypto.timingSafeEqual (Category B — context)
- 03-custom-strict-hmac.ts: custom webhook validates HMAC + body length match before dispatch (Category B — context)
- 04-stripe-verify-middleware.js: Stripe sig verified in dedicated middleware, raw body raw'd (Category B — context)
- 05-github-octokit-webhooks.js: uses @octokit/webhooks for end-to-end verification (Category B — context)
- 06-twilio-validate-request.js: uses twilio.validateRequest helper before processing (Category B — context)
- 07-flask-stripe-construct-event.py: Flask Stripe handler uses stripe.Webhook.construct_event (Category B — context)
- 08-flask-github-compare-digest.py: Flask GitHub handler uses hmac.compare_digest (Category B — context)
- 09-go-subtle-constant-time.go: Go GitHub handler uses subtle.ConstantTimeCompare (Category B — context)
- 10-go-slack-hmac-equal.go: Go Slack handler uses hmac.Equal (constant-time) for v0 sig (Category B — context)
- 11-app-router-cache-key-hashing.ts: Next.js App Router POST at app/api/feed/route.ts hashes the request body to a cacheKey via node:crypto createHash, then flows into cache.get/cache.set — not a webhook (Phase C, W1 mandatory FP-class anchor; load-bearing for the tightened "non-signature sink → not a webhook" rule) (Category B — context)
- 12-app-router-stripe-construct-event-proper.ts: Next.js App Router POST at app/api/stripe/webhook/route.ts uses stripe.webhooks.constructEvent with try/catch returning 400 on invalid signature (Phase C, library-verify proper) (Category B — context)
- 13-app-router-content-addressed-storage.ts: Next.js App Router POST at app/api/uploads/route.ts hashes the buffer to a fileHash via node:crypto createHash, then flows into storage.put for content-addressed storage — not a webhook (Phase C, WH-N3 OVERFIT-GUARD easy-negative; a pass here is NOT calibration evidence — WH-N1 carries the load) (Category B — context)
- 14-app-router-apple-cross-file-verifier-helper.ts: Next.js App Router POST at app/api/apple/webhook/route.ts imports `verifyApplePayload` from `@/lib/apple/verify`, awaits it on `payload.signedPayload`, and returns 401 on failure. Verifier implementation lives cross-file and cannot be confirmed from the route file alone, but the import + await + `verify*Payload` name-convention is strong enough signal that HIGH would be a false positive (Phase F, WH-N14 symmetric NEGATIVE anchor to positive/14 class-c; must route to MEDIUM/review-queue: isVulnerable=true, confidence=medium — NOT skip, NOT HIGH). Locked merge-gate fixture. (Category B — context)
- 15-app-router-graph-clientstate-challenge.ts: Next.js App Router POST at app/api/outlook/webhook/route.ts reads `notification.clientState`, compares it against `process.env.GRAPH_CLIENT_STATE`, and returns 403 on mismatch (the documented Microsoft-Graph subscription-validation shared-secret challenge). The mechanism is not HMAC but IS verification; cross-file env value cannot be confirmed but the body-field-compare-against-env-and-403-on-mismatch shape is strong enough signal that HIGH would be a false positive (Phase F, WH-N15 symmetric NEGATIVE anchor to positive/15 class-d; must route to MEDIUM/review-queue: isVulnerable=true, confidence=medium — NOT skip, NOT HIGH). Locked merge-gate fixture. (Category B — context)
- 16-remix-action-stripe-construct-event.ts: Remix v2 `export const action` at app/routes/webhook.stripe.ts using stripe.webhooks.constructEvent (library-based verification) with try/catch returning 400 on invalid signature (Phase E, WH-N16) (Category B — context)
- 17-remix-action-github-timing-safe-equal.ts: Remix v2 `export const action` at app/routes/api.webhook.github.ts computing HMAC-SHA256 over body and comparing to x-hub-signature-256 via crypto.timingSafeEqual (Phase E, WH-N17) (Category B — context)
- 18-remix-action-factory-utility-module.ts: Remix v2 UTILITY module at app/utils/webhook-action-factory.server.ts exporting `action` as a generic factory function — outside app/routes/, the Phase E path-aware filter must drop the REMIX_HANDLER_DEF_RE match so this file is NOT routed to webhook LLM. The file contains "webhook" in its filename (over-match anchor for the URL-shape patterns too) but only `remix_handler_def` would match content, and the path filter drops it (Phase E over-match anchor, WH-N18) (Category A — location)
