# webhook-unverified fixtures

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
