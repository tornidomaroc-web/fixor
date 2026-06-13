# idor-tenant fixtures (H5, Phase H Tier 1)

Tenant-scoping (orgId / tenantId across users) IDOR — DISTINCT from the
object-ownership (userId owns the row) IDOR the shipping detector already
claims. Kept in a SEPARATE directory from `fixtures/idor/` so the
existing 18/18 object-ownership baseline stays clean; these run under
their own K-of-N (`npm run test:idor-tenant`, added in H5 Phase 2). The
prompt's HIGH definition already names `organization_id` / `tenant_id`
as ownable axes; H5 measures whether the LLM actually flags unscoped
cross-tenant reads AND clears correctly-scoped ones, or whether
tenant-scoping stays a DOES-NOT-CLAIM row.

The axis under test: a resource owned by an ORG, legitimately shared by
many users in that org. The vuln is a user in org A reading org B's
resource — missing `organizationId == session.org` scoping. The correct
fix is org-scoping, NOT userId-scoping (multiple users in the org should
access it). No fixture here uses userId-ownership scoping, so a pass
proves something new.

Honesty rules (per docs/detector-test-rules.md F1): scanned files carry
NO safety-asserting comments. Expected verdicts are pinned here only.
Each fixture's org axis is signalled IN-FILE (a scoped sibling route, or
a create that sets the tenant key) so the LLM has the org-ownership
evidence without a model file — single-file-diff realistic.

## Positive (real cross-tenant IDOR — should flag HIGH, >=4/5)

- **01-express-prisma-query-scope.ts** (express_params + prisma_find_unique → HIGH): Express+Prisma. `GET /:id` does `invoice.findUnique({ where: { id: req.params.id } })` with NO organizationId filter. The sibling `GET /` scopes `findMany` to `organizationId: req.user.organizationId`, proving Invoice is org-owned and req.user.organizationId is the tenant key — the get-by-id forgot it. Any authenticated user reads any org's invoice.
- **02-express-prisma-membership.ts** (express_params + prisma_find_unique → HIGH): Express+Prisma. `GET /:id` does `project.findUnique({ where: { id } })` with no org filter and no membership check. The sibling `POST /` sets `organizationId: req.user.organizationId` on create, proving Project is org-scoped. Cross-tenant read of any project.
- **03-fastapi-sqlalchemy-postfetch.py** (fastapi_typed_path_param + sqlalchemy_query_get → HIGH): FastAPI+SQLAlchemy. `GET /{report_id}` does `db.query(Report).get(report_id)` with no org filter and no post-fetch org check. The sibling list scopes `Report.org_id == current_user.org_id`. Cross-tenant read of any report.

## Negative (correctly tenant-scoped — should NOT flag, 5/5 clear)

Three DISTINCT safe mechanisms, each safe for a reason a reader can point to:

- **01-express-prisma-query-scope.ts** (QUERY-FILTER mechanism): same as POS-01 but `GET /:id` uses `findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })`. Safe because the query itself requires organizationId == the caller's org; a cross-tenant id returns null from the DB. The tenant key is bound into the WHERE clause.
- **02-express-prisma-membership.ts** (MEMBERSHIP-TABLE CHECK — the hard one): same as POS-02 but after fetching the project it queries `membership.findFirst({ where: { userId: req.user.id, organizationId: project.organizationId } })` and 403s if absent. Safe because access is gated on the caller having a membership row linking them to the resource's org. NOTE: this references `req.user.id` (a userId) inside what is a TENANT check — the detector must not mistake it for a (missing) userId-ownership filter; the userId is the membership lookup key, not the resource-ownership key.
- **03-fastapi-sqlalchemy-postfetch.py** (POST-FETCH FIELD GUARD): same as POS-03 but after the fetch, `if report.org_id != current_user.org_id: raise 403`. Safe because the fetched resource's org_id is compared to the caller's org and rejected on mismatch before return.

## Frameworks / ORMs / mechanisms covered

- Languages: TypeScript (Express) + Python (FastAPI).
- ORMs: Prisma + SQLAlchemy.
- Safe mechanisms (negatives): query-filter scoping, membership-table check, post-fetch field guard — so a CLAIMS row would not overclaim a single safe shape.

## In-scope vs out-of-scope (single-file diff boundary)

- **In-scope** (these fixtures): in-file query-level org filter, in-file post-fetch org guard, in-file membership lookup.
- **Out-of-scope** (a diff can't see it — stays DOES-NOT-CLAIM): tenant
  middleware that swaps in a pre-scoped client in another file (the
  existing `tenantPrisma`/$extends exception already covers this), RLS
  tenant policies in migration files (existing RLS sidecar exception), a
  base repository/query class that auto-injects the org filter defined
  elsewhere. H5 claims only what a single file proves.

## Fingerprint

Measured at the SYSTEM_PROMPT fingerprint recorded in the saved run log
(test-output/, H5 Phase 2). No prompt change is made unless calibration
requires it (R10/R11: between runs only), in which case the full
`fixtures/idor/` 18-suite is re-baselined at the same fingerprint to
confirm no regression.
