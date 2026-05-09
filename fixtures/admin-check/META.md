# admin-check fixtures

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

## Negative (looks similar, actually safe)
- 01-db-role-lookup.ts: requireAdmin reads role from user_roles table
- 02-org-membership-rbac.ts: requires owner/admin in org_members for the URL's orgId
- 03-email-match-invite-only.ts: email match used only to verify invite, grants member role
- 04-jwt-claims-server-issued.ts: role read from server-signed JWT with issuer check
- 05-db-role-on-delete.js: role checked via DB lookup before destructive call
- 06-claims-middleware.js: dedicated verifyClaims middleware enforces requiredRole
- 07-bootstrap-admins-script.js: hardcoded admins used only by one-shot bootstrap script
- 08-flask-db-role.py: Flask before_request loads role from user_roles table
- 09-fastapi-rbac-dep.py: FastAPI dependency injection enforces DB-backed role
- 10-go-rbac-from-db.go: Go middleware checks role via db.QueryRole
