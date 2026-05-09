# secrets-exposure fixtures

## Positive (real vulnerabilities)
- 01-supabase-service-role-client.tsx: SERVICE_ROLE_KEY referenced in a "use client" component
- 02-next-public-openai.ts: NEXT_PUBLIC_OPENAI_API_KEY bundled into client JS
- 03-firebase-admin-in-component.tsx: firebase-admin private key embedded in a component
- 04-stripe-secret-hardcoded.ts: sk_live_ Stripe key inline in source
- 05-anthropic-key-fallback.ts: hardcoded sk-ant-api03 fallback when env var missing
- 06-aws-keys-hardcoded.js: AWS access + secret key strings in module scope
- 07-config-route-leaks-service-role.ts: /api/config returns SUPABASE_SERVICE_ROLE_KEY
- 08-postgres-password-client.ts: production DB password in client-imported lib
- 09-slack-webhook-hardcoded.py: full Slack incoming webhook URL in source
- 10-jwt-secret-const.go: JWT signing key as a Go const

## Negative (looks similar, actually safe)
- 01-supabase-service-role-server-only.ts: SERVICE_ROLE_KEY behind "server-only" import (Category B — context)
- 02-public-config-vars.ts: NEXT_PUBLIC_ values that are legitimately public (anon key, site URL) (Category B — context)
- 03-firebase-admin-server-lib.ts: firebase-admin in src/lib/server with env-loaded creds (Category B — context)
- 04-stripe-in-getserverside.tsx: STRIPE_SECRET_KEY only in getServerSideProps (Category B — context)
- 05-stripe-test-keys-fixtures.ts: pk_test_/sk_test_ keys in a *.test.ts fixture (Category A — location)
- 06-aws-keys-from-env.js: AWS creds read from process.env at boot, fail-fast if missing (Category B — context)
- 07-anthropic-server-only.ts: Anthropic client initialized in a "server-only" module (Category B — context)
- 08-secrets-decrypted-from-kms.ts: secrets read encrypted at rest, decrypted via KMS at boot (Category B — context)
- 09-slack-webhook-from-env.py: SLACK_OPS_WEBHOOK loaded from os.environ (Category B — context)
- 10-jwt-secret-from-env.go: JWT signing key initialized from env in init() (Category B — context)
