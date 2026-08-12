# env-exposure fixtures

## Owner scope ruling (2026-08-12): names-only is OUT of env-exposure's lane. NOTHING HERE CHANGED.

An unguarded, complete enumeration of environment variable NAMES, with no values returned, is a
real but LOW-severity reconnaissance disclosure and is OUT of this detector's lane. Values leaving
the process is env-exposure's lane; a missing guard on a route is auth-bypass's lane. Closes L-016
in `docs/REMEDIATION-PROGRESS.md`, where the full grounds and the measured evidence live.

**THIS IS NOT A THIRD R6 MOVE, AND NO FILE IN THIS DIRECTORY WAS TOUCHED.** The two R6 moves
recorded below both leaked VALUES, and in both the description in THIS file was factually WRONG
about its own code, which is what let them stand - stated explicitly for `negative/03` above.
`negative/08-flask-env-keys-only.py` leaks no value, and its line under "Negative" - "Flask returns
sorted env key names without values" - is exactly true. A relabel would have been the first in this
corpus performed on an accurate description: not correcting an error, but changing a scope rule by
moving a file. The corpus was right; the PROMPT was defective, and the prompt is what was amended.
`SYSTEM_PROMPT_FINGERPRINT` moves `d2ca2f022d99` to `0872c970ef2f`.

**Portfolio unchanged: 12 positives + 8 negatives.** `negative/04` (guarded) and `negative/08`
(unguarded) are both still negatives, and both are now rejected on the SAME ground - no value
leaves - instead of on two different ones. Removing that split is the whole content of the ruling.
The old reject clause made the production guard load-bearing for the names-only shape; it is
deleted, because names-only is a strict subset of no-value-leaves.

**The disagreement, for a reader who wants it rather than its resolution.** Live run
`31435865020` flagged `negative/08` `vuln/medium` on 5 of 5 runs and EMITTED all five under option
C, while the frozen n=1 recording `b8e6785891d5` (2026-07-04) returned `isVulnerable:false @ low`
on the identical canonical request, reasoning that the missing guard aids reconnaissance "but does
not constitute a direct env-value exposure vulnerability per the defined criteria". The model has
rendered BOTH verdicts on this input. That is why relabelling was refused: it would have promoted
one of the two to ground truth on the strength of which one happened to land inside a paid run.

**Untested, deliberately stated here.** That the amended words actually move the model is NOT
established by the amendment. The recorder's class assertion is what will test it: this file stays
in `negative/`, so a re-record that still flags it fails rather than freezing a wrong verdict.

## R6 reclassification #2 (2026-08-07): negative/03 → positive/12

`negative/03-fastify-redacted-logs.ts` is now `positive/12-fastify-redacted-logs.ts`. **The LLM was right and the fixture was mislabeled.** This is the SECOND R6 case in this corpus, the same failure mode as `negative/07` → `positive/11` on Day 5.

**The code.** `redactedEnv()` iterates the whole of `process.env` and redacts a hardcoded allowlist of exactly four keys (`DATABASE_URL`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `JWT_SECRET`). Everything else — `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `REDIS_URL`, `SMTP_PASSWORD`, `SENTRY_DSN`, `CLOUDINARY_API_SECRET` — is returned in plaintext from `GET /api/health`, which is unauthenticated. That is a real vulnerability.

**Where the authoring went wrong.** The fixture was built as the Fastify twin of `negative/06-logger-only-env.js`. It is not. `negative/06` does `logger.info({ env: process.env })` and then `res.json({ ok: true })` — the response body contains nothing from env, and it is correctly safe. `negative/03` does `return { ok: true, env: redactedEnv() }`. The env goes into the RESPONSE, through a separate and much weaker allowlist. The `logger: { redact: [...] }` block that makes it *look* like `negative/06` governs log output only and has no bearing on the returned object.

**The description in this file was wrong about the code**, and that is what let it stand. It read *"env logged but routed through pino redact list (Category B — context)"*. The env is not only logged; it is returned.

**The model applied the shipped rubric correctly — it did not get lucky.** The system prompt defines MEDIUM as *"Subset returned but includes potentially sensitive keys (DATABASE_URL, AUTH, KEY, SECRET, TOKEN patterns)"*, which is this fixture exactly. Its question 5 asks *"Is `process.env` passed only to a redacting logger (pino redact list, etc.) rather than to an HTTP response?"* — the precise distinction this file got backwards. The recorded reasoning names it: *"The Fastify logger's `redact` list is separate and only applies to log output — it does not protect the `redactedEnv()` return value."* `medium` was the specified answer for this shape, not a hedge.

**Evidence.** Paid run `30903038957` (env-exposure, 85 calls): `isVulnerable:true @ medium`, unanimous 5/5. Recording `452869ba3d64…json`, fingerprint `d2ca2f022d99`.

**Why it survived so long.** The confidence ladder discards MEDIUM, so the detector emitted nothing, and the old emission-based scorer counted "emitted nothing on a negative" as `correctly-skipped 5/5 PASS`. The suppression hid a corpus defect as well as a finding. No amount of extra sampling would have surfaced it; only reading the recorded reasoning did.

**Key preservation, deliberate.** The `// ASSUMED-PATH:` header still reads `src/app/handlers/env-exposure/03-fastify-redacted-logs.ts` and the file body is byte-identical. The replay key hashes the prompt, the prompt path comes from that header, so the recording still matches and **no re-record was needed and nothing was spent**. `positive/11` still reads `07-…` for the same reason. Do not "tidy" these headers to match their filenames — doing so moves the key and forces a paid re-record.

**Portfolio after this move: 12 positives + 8 negatives** (negatives keep their original numbers; 03 and 07 are now gaps, as intended). THREE positives sit at the MEDIUM ceiling — 03, 11, 12 — so `test:env-exposure` cannot reach 12/12 while the ladder discards MEDIUM.

## Day 5 audit notes (2026-05-15)

- **R6 reclassification**: `negative/07-redacted-diagnostics.js` moved to `positive/11-redacted-diagnostics.js`. Original classification (negative — "the redaction pattern catches sensitive keys") was contradicted by the LLM's argument that the regex `KEY|SECRET|TOKEN|PASSWORD|DSN` misses common sensitive vars (`DATABASE_URL`, `MONGO_URI`, `REDIS_URL`, `AWS_SESSION_TOKEN` variants). LLM was right; fixture was mislabeled. See R6 in `docs/detector-test-rules.md`.
- **Two medium-confidence ceiling cases identified**: positive/03-fastify-logs-env (logger module opacity) and positive/11-redacted-diagnostics (incomplete redaction regex). Both correctly identified as vulnerable by the LLM at MEDIUM confidence, suppressed by the detector's confidence ladder. Both are **logger-config sidecar candidates** (P0.5).
- **Post-reclassification portfolio**: 11 positives + 9 negatives. 9/11 positives flag at HIGH (5/5 each); 2 at 0/5 due to medium-conf ceiling. 6 cognitive negatives + 3 R4 (no-pattern-match: /01, /02, /10). Aggregate harness PASS 18/20; cognitive accuracy 15/17 (excluding 3 R4 negatives that pre-filter SKIPped). Fingerprint `d2ca2f022d99`.
  - **Superseded 2026-08-07 by R6 #2 above.** These Day-5 figures are kept as the dated record of what was believed then. Current portfolio is **12 positives + 8 negatives**, with 5 cognitive negatives + 3 R4, and three MEDIUM-ceiling positives rather than two.

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
- 11-redacted-diagnostics.js: regex-redacts SECRET/KEY/TOKEN/PASSWORD/DSN before responding, BUT the redaction pattern misses common sensitive vars (DATABASE_URL, MONGO_URI, REDIS_URL). LLM flags at MEDIUM (calibration ceiling). **Reclassified from negative/07 on Day 5 per R6.** Logger-config sidecar candidate.
- 12-fastify-redacted-logs.ts: unauthenticated `GET /api/health` returns `{ ok: true, env: redactedEnv() }`, where `redactedEnv()` redacts a hardcoded 4-key allowlist and returns every other env var in plaintext. The `logger: { redact: [...] }` block governs log output only and does not touch the response. LLM flags at MEDIUM (the rubric's own "subset returned but includes potentially sensitive keys" band). **Reclassified from negative/03 on 2026-08-07 per R6 — see the section at the top of this file.**

## Negative (looks similar, actually safe)
- 01-admin-env-gated.ts: /admin/env requires admin AND production check, returns subset (Category B — context)
- 02-public-config.ts: /api/config returns hand-picked typed PublicConfig (Category B — context)
- 04-dev-env-keys-only.ts: dev route returns env KEYS only, 404 in prod (Category B — context)
- 05-healthz-specific-fields.js: /healthz returns only region/version/uptime (Category B — context)
- 06-logger-only-env.js: process.env passed only to redacting logger, not response (Category B — context)
- 08-flask-env-keys-only.py: Flask returns sorted env key names without values (Category B — context)
- 09-fastapi-runtime-specific.py: FastAPI returns specific allowlisted env values (Category B — context)
- 10-go-public-env.go: Go handler returns predefined safeKeys subset only (Category B — context)
