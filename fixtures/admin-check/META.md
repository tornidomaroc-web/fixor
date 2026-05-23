# admin-check fixtures

## Day 8 — per-pattern Option G mitigation (2026-05-15)

**Production-default admin-check runs with per-pattern tier bypass.** Literal-tier pattern matches (11 of 12 patterns) emit findings using hand-authored explanations without invoking the LLM. The single judgment-tier pattern (`role_string_compare`) keeps LLM in the loop because the regex cannot distinguish bug cases (hardcoded admin grant) from safe cases (DB-backed role lookup, verified JWT claim).

Background: the Day 7 cross-detector audit found admin-check LLM reasoning quotes internal employee emails (`founder@acme.app`), user IDs (`u_founder_001`), and domain suffixes (`@acme.app`) into PR comment output (MEDIUM-risk leak per D8). The Day 8 mitigation uses the per-pattern tier shape (not wholesale bypass) because admin-check is a mixed-tier detector: wholesale bypass would have produced 6 FPs on the cognitive negatives that all match the single judgment-tier pattern.

- Pattern tier inventory: 11 literal-tier (admin-pattern-literals like `DEFAULT_ADMIN_ID`, `ADMIN_EMAILS`, email comparison shapes, `role ?? 'admin'`, `req.body.role`) + 1 judgment-tier (`role_string_compare` — `role === 'admin'` shape that's safe when role is DB-backed).
- LLM mode is preserved as opt-in via `FIXOR_ADMIN_CHECK_LLM_OPT_IN=true` env var or `{ llmValidation: true }` constructor option.
- Day 8 stability run: 20/20 in both modes, zero verdict changes, LLM calls cut 80 → 30 (62% reduction). The 6 cognitive negatives matching judgment-tier all preserved SKIP under the new default.

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
