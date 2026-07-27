# admin-check fixtures

## Day 8 — per-pattern Option G mitigation (2026-05-15)

**Production-default admin-check runs with per-pattern tier bypass.** Literal-tier pattern matches (11 of 12 patterns) emit findings using hand-authored explanations without invoking the LLM. The single judgment-tier pattern (`role_string_compare`) keeps LLM in the loop because the regex cannot distinguish bug cases (hardcoded admin grant) from safe cases (DB-backed role lookup, verified JWT claim).

Background: the Day 7 cross-detector audit found admin-check LLM reasoning quotes internal employee emails (`founder@acme.app`), user IDs (`u_founder_001`), and domain suffixes (`@acme.app`) into PR comment output (MEDIUM-risk leak per D8). The Day 8 mitigation uses the per-pattern tier shape (not wholesale bypass) because admin-check is a mixed-tier detector: wholesale bypass would have produced 6 FPs on the cognitive negatives that all match the single judgment-tier pattern.

- Pattern tier inventory: 11 literal-tier (admin-pattern-literals like `DEFAULT_ADMIN_ID`, `ADMIN_EMAILS`, email comparison shapes, `role ?? 'admin'`, `req.body.role`) + 1 judgment-tier (`role_string_compare` — `role === 'admin'` shape that's safe when role is DB-backed).
- LLM mode is preserved as opt-in via `FIXOR_ADMIN_CHECK_LLM_OPT_IN=true` env var or `{ llmValidation: true }` constructor option.
- Day 8 stability run: 20/20 in both modes, zero verdict changes, LLM calls cut 80 → 30 (62% reduction). The 6 cognitive negatives matching judgment-tier all preserved SKIP under the new default.

**STATUS AS OF PR C2 (2026-07-27) — the Day 8 counts above are left as entered and are no longer current.** They were accurate on 2026-05-15; the route-def sentinels landed afterwards (Phase 2 / Phase C / Phase E / the Python slices, 2026-05-23 to 2026-05-28) and changed the inventory. Current tier inventory is **10 literal-tier + 6 judgment-tier = 16 patterns**. The judgment tier is no longer "the single `role_string_compare`": it is `role_string_compare` plus `express_route_def`, `app_router_route_def`, `remix_handler_def`, `fastapi_route_def` and `flask_route_def`.

The literal tier went 11 → 10 in PR C2, which **deleted `py_email_endswith_at`**. That pattern was unreachable by any input: it carried the identical regex to `email_endswith_at` in Python casing, and both carried `/i`, so the two accepted exactly the same strings at exactly the same index. `prefilterRegex` breaks ties with a strict `<`, so the earlier entry always won. Deleting it was verified behaviour-preserving over all 45 fixtures plus 14 synthetic shapes: zero inputs where it won, zero changes in winning pattern or match index.

Consequence for this corpus: **`positive/08-flask-endswith-domain.py` is now a load-bearing fixture.** It is Python (`email.endswith`) matched by a camelCase regex, so it is the only thing standing between a future "tidy the regex" edit and the silent loss of admin-check detection across every Python file. It is pinned to `email_endswith_at` in `BYPASS_EXPECTED`. Do not delete it, and do not relax that pin.

## Positive (real vulnerabilities)
- 01-hardcoded-admin-email.ts: requireAdmin compares against ADMIN_EMAIL constant
- 02-endswith-company-domain.ts: isInternalUser via email.endsWith("@acme.app")
- 03-email-includes-admin.ts: admin grants if email.includes("admin") || includes("founder")
- 04-default-admin-id-fallback.ts: req.user?.id ?? DEFAULT_ADMIN_ID + role ?? "admin"
- 05-admin-emails-array.js: admin set is hardcoded ADMIN_EMAILS array, no DB role
- 06-client-supplied-role.js: /api/admin/promote trusts req.body.userRole
- 07-default-admin-id-helper.js: getCurrentUser falls back to DEFAULT_ADMIN_ID with role admin
- 08-flask-endswith-domain.py: Flask before_request sets g.is_admin via email.endswith
- 09-flask-default-admin-email.py: session email defaults to DEFAULT_ADMIN_EMAIL
- 10-go-admin-domain-suffix.go: Go middleware grants admin via strings.HasSuffix(email, "@acme.app")
- 11-missing-admin-gate-role-change.ts: router with two requireAdmin-gated routes plus a /:id/tier POST whose admin gate was forgotten — the handler writes req.body.tier to the DB unchecked, allowing any authenticated caller to set themselves to the admin tier (Phase 2 missing-admin-gate; pre-Phase-2 this fires zero prefilter sentinels and was silently dropped)
- 12-app-router-bare-role-change.ts: Next.js App Router bare PUT at app/api/admin/users/[id]/role/route.ts assigns a role from the JSON body with no HOC wrapper and no inline check (Phase C missing-admin-HOC-wrapper, bare shape). Body destructured to avoid req.body.role literal pre-emption.
- 13-app-router-with-auth-only-admin-action.ts: Next.js App Router POST wrapped in withAuth promoting a user to admin role; existing prompt rule says withAuth alone is not sufficient for admin-check (Phase C, auth-only-wrapper shape).
- 14-app-router-with-route-on-admin-action.ts: Next.js App Router DELETE wrapped in generic-named withRoute performing user deletion; documented limitation treats generic wrappers as ungated by default (Phase C, generic-wrapper shape).
- 15-app-router-with-auth-plus-non-admin-helper.ts: Next.js App Router PUT wrapped in withAuth with a non-admin-suggesting helper call (logAccess) before the privileged op; the helper-call rule requires the helper NAME to suggest admin enforcement, so this fixture must FLAG (Phase C, AC-P4 symmetric positive anchor to negative/15 AC-N4).
- 16-remix-action-with-auth-only-admin-op.ts: Remix v2 `export const action` at app/routes/admin.users.$id.promote.ts wrapped in withAuth (authentication, not admin authorization) promoting a user to admin role — withAuth alone is insufficient for admin-check per prompt case 3 (Phase E, AC-P16)
- 17-remix-loader-admin-data-no-gate.ts: Remix v2 bare `export const loader` at app/routes/admin.users._index.ts reading admin-scoped user table with no HOC and no inline admin check — unambiguous admin path + admin-scoped query (Phase E, AC-P17)
- 18-remix-action-with-logging-admin-delete.ts: Remix v2 `export const action` at app/routes/admin.users.$id.delete.ts wrapped in withLogging (observability HOC, no admin substring) performing admin user-delete — generic-non-admin HOC does not gate (Phase E, AC-P18)
- 19-fastapi-auth-only-admin-delete.py: FastAPI `@router.delete("/admin/users/{user_id}")` deleting any user, guarded ONLY by `Depends(get_current_user)` (plain auth, NOT admin) with no inline superuser/role check — Python's looks-guarding-but-isn't adversarial; plain auth must NOT clear an admin op (Python slice 1b, AC-P19)
- 20-fastapi-admin-stats-no-gate.py: FastAPI `@router.get("/admin/stats")` reading instance-wide stats guarded only by `Depends(get_db)` (DB session, not auth) — admin data, no gate at all (Python slice 1b, AC-P20)
- 21-flask-login-only-admin-op.py: Flask `@app.route("/admin/users/<int:user_id>", methods=["DELETE"])` deleting ANY user, decorated ONLY by `@login_required` (auth, NOT admin) with no @admin_required and no is_admin/role check — Flask looks-guarding-but-isn't adversarial (Flask slice, AC-P21)
- 22-hardcoded-admin-email-equality.js: `email === "founder@acme.app"` grants platform-admin before a workspace purge. Added to exercise the literal-tier `email_eq_literal`, which no fixture reached: positive/01 carries an `ADMIN_EMAIL` constant that matches `admin_email_const` earlier in the file. Carries no such constant, so `email_eq_literal` is the earliest match (prefilter-coverage slice, AC-P22)
- 23-role-nullish-fallback-admin.js: `session?.user?.role ?? "admin"` makes every unauthenticated caller an admin, then the suspend op checks for exactly that role. Added to exercise the literal-tier `role_fallback_admin`, previously unreached. Uses no `role === "admin"` compare, so nothing shadows it (prefilter-coverage slice, AC-P23)
- 24-client-supplied-role-no-route-def.js: a `requireAdmin` middleware trusting `req.body.userRole`, defined but NOT registered on a router in-file. Added to exercise the literal-tier `body_role_check`, which positive/06 is named for but never fires: 06 registers `router.post("...")`, so `express_route_def` matches earlier and sends it to the LLM instead. Dropping the route definition is what lets `body_role_check` win (prefilter-coverage slice, AC-P24)

## Negative (looks similar, actually safe)
- 01-db-role-lookup.ts: requireAdmin reads role from user_roles table (Category B — context)
- 02-org-membership-rbac.ts: requires owner/admin in org_members for the URL's orgId (Category B — context)
- 03-email-match-invite-only.ts: email match used only to verify invite, grants member role (Category B — context)
- 04-jwt-claims-server-issued.ts: role read from server-signed JWT with issuer check (Category B — context)
- 05-db-role-on-delete.js: role checked via DB lookup before destructive call (Category B — context)
- 06-claims-middleware.js: dedicated verifyClaims middleware enforces requiredRole (Category B — context)
- 07-bootstrap-admins-script.js: hardcoded admins used only by one-shot bootstrap script (Category A — location)
- 08-flask-db-role.py: Flask before_request loads role from user_roles table (Category B — context)
- 09-fastapi-rbac-dep.py: FastAPI dependency injection enforces DB-backed role (Category B — context)
- 10-go-rbac-from-db.go: Go middleware checks role via db.QueryRole (Category B — context)
- 11-router-properly-admin-gated.ts: every privileged router.post/.get route has a requireAdmin middleware as first arg, and requireAdmin itself consults a DB-backed user_roles table; proves the Phase 2 missing-admin-gate broadening doesn't fire on correctly-gated routes (Category B — context)
- 12-app-router-with-admin-wrapper.ts: Next.js App Router POST wrapped in withAdmin promoting a user to admin role; admin-suggesting HOC name resolves gating (Phase C, B1 mandatory admin-wrapper shape) (Category B — context)
- 13-app-router-with-auth-plus-inline-role-check.ts: Next.js App Router PUT wrapped in withAuth with an inline `session.user.role !== 'admin'` 403 check before the destructive op (Phase C, inline-check-anchor shape) (Category B — context)
- 14-app-router-bare-non-admin-read.ts: Next.js App Router bare GET reading authenticated user's own profile (scoped on session.user.id, not admin-tier) (Phase C, non-admin-self-read shape) (Category B — context)
- 15-app-router-with-auth-plus-helper-admin-check.ts: Next.js App Router PUT wrapped in withAuth with an `await requireAdminRole()` helper call before the destructive op (Phase C, AC-N4 helper-call symmetric anchor to negative/13; tests whether the LLM trusts an admin-suggesting helper name without a visible role string comparison) (Category B — context)
- 16-remix-action-with-admin-wrapper.ts: Remix v2 `export const action` at app/routes/admin.tenants.$id.settings.ts wrapped in withAdmin (admin substring in name → gates per prompt case 3) performing tenant settings update (Phase E, AC-N16) (Category B — context)
- 17-remix-loader-db-role-check.ts: Remix v2 `export const loader` at app/routes/admin.audit-log._index.ts with no HOC but explicit DB-backed RBAC: requireUser + userRole table lookup + 403 on non-admin before privileged read (Phase E, AC-N17) (Category B — context)
- 18-remix-action-factory-utility-module.ts: Remix v2 UTILITY module at app/utils/action-helpers.server.ts exporting `action` as a generic factory function — outside app/routes/, the Phase E path-aware filter must drop the REMIX_HANDLER_DEF_RE match so this file is NOT routed to admin-check LLM (Phase E over-match anchor, AC-N18) (Category A — location)
- 19-fastapi-require-admin.py: FastAPI `@router.delete("/admin/users/{user_id}")` admin op gated by `Depends(require_admin)` (admin-suggesting dependency by name convention) — properly authorized (Python slice 1b, AC-N19) (Category B — context)
- 20-fastapi-superuser-inline.py: FastAPI admin promote op with `Depends(get_current_user)` (plain auth) BUT an explicit inline `if not current_user.is_superuser: raise HTTPException(403)` before the action — inline admin check gates; proves get_current_user + inline check clears where get_current_user alone (AC-P19) flags (Python slice 1b, AC-N20) (Category B — context)
- 21-flask-admin-required.py: Flask `@app.route("/admin/users/<int:user_id>", methods=["DELETE"])` admin delete gated by `@admin_required` (admin-suggesting decorator by name convention) on top of @login_required — properly authorized; proves @admin_required clears where @login_required alone (AC-P21) flags (Flask slice, AC-N21) (Category B — context)
