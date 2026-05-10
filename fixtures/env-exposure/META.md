# env-exposure fixtures

## Positive (real vulnerabilities)
- 01-debug-env-route.ts: GET /api/debug/env returns full process.env in JSON
- 02-error-handler-leaks-env.ts: errorHandler appends process.env to 500 responses
- 03-fastify-logs-env.ts: health endpoint logs JSON.stringify(process.env)
- 04-admin-runtime-no-prod-check.ts: /admin/runtime returns env, dev-only guard removed
- 05-healthz-config.js: /healthz response body includes process.env
- 06-diagnostics-send.js: /api/v1/diagnostics calls res.send(process.env)
- 07-error-includes-env.js: per-request error path returns process.env in JSON body
- 08-flask-diagnostics.py: Flask /api/diagnostics returns dict(os.environ)
- 09-fastapi-runtime.py: FastAPI /internal/runtime returns dict(os.environ)
- 10-go-env-dump.go: Go EnvDump handler iterates os.Environ and emits as JSON

## Negative (looks similar, actually safe)
- 01-admin-env-gated.ts: /admin/env requires admin AND production check, returns subset (Category B — context)
- 02-public-config.ts: /api/config returns hand-picked typed PublicConfig (Category B — context)
- 03-fastify-redacted-logs.ts: env logged but routed through pino redact list (Category B — context)
- 04-dev-env-keys-only.ts: dev route returns env KEYS only, 404 in prod (Category B — context)
- 05-healthz-specific-fields.js: /healthz returns only region/version/uptime (Category B — context)
- 06-logger-only-env.js: process.env passed only to redacting logger, not response (Category B — context)
- 07-redacted-diagnostics.js: regex-redacts SECRET/KEY/TOKEN before responding (Category B — context)
- 08-flask-env-keys-only.py: Flask returns sorted env key names without values (Category B — context)
- 09-fastapi-runtime-specific.py: FastAPI returns specific allowlisted env values (Category B — context)
- 10-go-public-env.go: Go handler returns predefined safeKeys subset only (Category B — context)
