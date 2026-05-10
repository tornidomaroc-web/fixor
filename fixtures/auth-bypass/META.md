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
