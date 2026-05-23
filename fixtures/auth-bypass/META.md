# auth-bypass fixtures

## Positive (real vulnerabilities)
- 01-anon-bypass-delete.ts: anonymous string skips user_id WHERE clause in DELETE
- 02-role-or-true.ts: admin-only middleware with `|| true` shortcut left in for demo day
- 03-jwt-verify-swallowed.ts: JWT verify try/catch downgrades invalid tokens to a fake "anon" user
- 04-role-fallback-admin.ts: missing role coerced to "admin" via `|| "admin"` fallback
- 05-missing-middleware.js: cancel-subscription route missing requireAuth, takes userId from body
- 06-default-user-fallback.js: anonymous DELETE falls back to founder's user_id (1)
- 07-flask-anon-skip.py: Flask DELETE skips user_id filter when session user is "anonymous"
- 08-jwt-verify-false.py: JWT decode with verify_signature=False
- 09-go-anon-delete.go: Go handler skips owner_id WHERE clause for "anonymous" header
- 10-rb-admin-fallback.rb: Rails owner_id falls back to "admin" when params[:user_id] missing
- 11-admin-router-mixed-guards.ts: admin router with two requireAuth-guarded routes plus a destructive /users/delete missing its middleware (mirrors fixor-demo admin.ts at 4270a02)
- 12-app-router-with-logging-destructive.ts: Next.js App Router POST wrapped in withLogging (observability HOC, no auth substring) performing db.user.delete — generic-non-auth HOC does not gate (Phase C, AB-P1)
- 13-app-router-with-route-deceptive-generic.ts: Next.js App Router DELETE wrapped in generic-named withRoute performing db.account.deactivate — generic-named wrappers treated as ungated by default (Phase C, AB-P2)
- 14-app-router-with-session-analytics.ts: Next.js App Router POST wrapped in withSessionAnalytics setting a tracking cookie + analytics event + destructive db.invoice.delete — session-substring HOC that does NOT enforce auth, the load-bearing A3 false-negative class (Phase C, AB-P3)

## Negative (looks similar, actually safe)
- 01-anon-public-data.ts: anonymous returns public feed only (intended design) (Category B — context)
- 02-internal-dev-tool.ts: admin string check in non-HTTP CLI seed script (Category A — location)
- 03-defense-in-depth-role.ts: role re-check after upstream middleware already enforced it (Category B — context)
- 04-jwt-verify-rethrows.js: JWT verify catch returns 401 instead of downgrading (Category B — context)
- 05-default-id-in-seed.js: DEFAULT_USER_ID hardcoded only in local seed script (Category A — location)
- 06-flask-anon-static.py: anonymous returns static homepage payload (no auth needed) (Category B — context)
- 07-jwt-verify-false-tests.py: verify=False inside pytest helper, not runtime (Category A — location)
- 08-go-anon-healthcheck.go: anonymous allowed only on /healthz for the load balancer (Category B — context)
- 09-rb-admin-migration.rb: hardcoded admin emails inside one-shot migration only (Category A — location)
- 10-token-public-readonly.ts: token === 'public' permits read-only feed access by design (Category B — context)
- 11-router-properly-guarded.ts: every router.post/.get destructive route has requireAuth as first arg; proves missing-middleware broadening doesn't fire on correctly-guarded code (Category B — context)
- 12-app-router-with-auth-wrapper.ts: Next.js App Router POST wrapped in withAuth with body-level session-keyed scope filter for deleteMany — auth-suggesting HOC name + body proof (Phase C, AB-N1) (Category B — context)
- 13-app-router-with-session-for-auth.ts: Next.js App Router PUT wrapped in withSession where the body USES session for an authorization decision (401 on no session) and for scoping (where id = session.user.id) — symmetric session-FOR-AUTH true-negative anchor for the A3 fixture above (Phase C, AB-N2) (Category B — context)
- 14-app-router-bare-public-readonly.ts: Next.js App Router bare GET returning published blog posts — public-content read, no destructive op (Phase C, AB-N3) (Category B — context)
