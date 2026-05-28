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
- 17-remix-bare-action-destructive.ts: Remix v2 bare `export const action` at app/routes/api.subscriptions.$id.cancel.ts performing destructive cancel with no wrapper and no inline auth — parallel to App Router AB-P1 transposed to Remix (Phase E, AB-P17)
- 18-remix-loader-with-logging-destructive.ts: Remix v2 `export const action` at app/routes/api.users.$id.delete.ts wrapped in withLogging (non-auth HOC) performing db.user.delete — parallel to App Router AB-P1 generic-non-auth shape (Phase E, AB-P18)
- 19-remix-action-with-session-analytics.ts: Remix v2 `export const action` at app/routes/api.invoices.$id.destroy.ts wrapped in withSessionAnalytics (session-substring HOC that does NOT enforce auth) — parallel to App Router AB-P3 A3 class transposed to Remix (Phase E, AB-P19)
- 20-fastapi-bare-delete-getdb.py: FastAPI `@router.delete("/users/{user_id}")` destructive op whose ONLY dependency is `Depends(get_db)` (a DB session, NOT auth) and no inline check — Python's looks-guarding-but-isn't adversarial; the non-auth dependency must NOT clear it (Python slice 1, AB-P20)
- 21-fastapi-noauth-tier-change.py: FastAPI `@router.post("/billing/tier")` sensitive billing mutation with no dependencies and no inline auth — bare unguarded route (Python slice 1, AB-P21)
- 22-flask-bare-route-no-auth.py: Flask `@app.route("/users/<int:user_id>", methods=["DELETE"])` destructive delete with no @login_required and no current_user/g.user/session check; imports show Flask (Flask slice, AB-P22)

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
- 17-remix-loader-require-user-from-remix-auth.ts: Remix v2 `export const loader` at app/routes/account.profile.ts using `requireUser` from remix-auth (the conventional auth-suggesting pattern) plus body uses returned user.id for scoped read — two gating signals (Phase E, AB-N17) (Category B — context)
- 18-remix-action-inline-session-auth.ts: Remix v2 `export const action` at app/routes/api.posts.$id.update.ts with no HOC but explicit inline `getServerSession` + 401 on no session + scope filter keyed on session.user.id — inline auth check gates per prompt case 3 (Phase E, AB-N18) (Category B — context)
- 19-remix-loader-factory-utility-module.ts: Remix v2 UTILITY module at app/lib/loader-factory.server.ts exporting `loader`/`action` as generic factory functions — outside app/routes/, the Phase E path-aware filter (isRemixRoutePath) must drop the REMIX_HANDLER_DEF_RE match so this file is NOT routed to the LLM (Phase E over-match anchor, AB-N19) (Category A — location)
- 20-fastapi-depends-current-user.py: FastAPI `@router.delete("/account")` destructive op gated by `Depends(get_current_user)` in the signature — auth-suggesting dependency by name convention; scoped to the authenticated principal (Python slice 1, AB-N20) (Category B — context)
- 21-fastapi-security-current-user.py: FastAPI `@router.post("/teams/{team_id}/delete")` destructive op gated by `Security(get_current_active_user)` — Security() auth dependency by name convention, ownership enforced in the service on user.id (Python slice 1, AB-N21) (Category B — context)
- 22-flask-login-required.py: Flask `@app.route("/account/delete", methods=["POST"])` destructive op gated by `@login_required` (flask_login) operating on the authenticated current_user's own account (Flask slice, AB-N22) (Category B — context)
- 23-flask-shorthand-login-required.py: DISAMBIGUATION ANCHOR — Flask `@app.post` 2.0 SHORTHAND (shared with FastAPI) but flask/flask_login imports => Flask rubric; @login_required + current_user ownership gates. Must NOT be misjudged by the FastAPI rubric (which would demand Depends and flag) (Flask slice, AB-N23) (Category B — context)
