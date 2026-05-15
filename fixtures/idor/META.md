# idor fixtures

## Fingerprint history

- (pre-audit) — Phase 5d initial detector through tRPC SOURCE addition. Single-pass "16/16 PASS" was on the original fixture set with documented heavy leakage on 7 of 8 negatives. **Numbers are not load-bearing**; replaced by Day 4 audit run.
- **`<new>` (audit Day 3, 2026-05-15)** — capability extension. Added two paragraphs to SYSTEM_PROMPT for `.policy.sql` and `.middleware.ts` sidecar consumption, mirroring the Mass-Assignment "Verified Prisma schema" pattern. This is **not a calibration iteration** (rule R7, see docs/detector-test-rules.md): the trigger is production parity — the GitHub App reads migration files / middleware definitions from the repo in deployment — not an observed FP. The "no prompt tuning in Phase 1a" rule remains in force for FP-driven edits. Sidecar conventions: `<fixture>.policy.sql` and `<fixture>.middleware.ts` next to the fixture file, loaded by the shared stability harness and injected via `DetectorContext.sidecarsByPath`.

## Positive (real vulnerabilities)
- 01-nextjs-app-router.ts (nextjs_destructured + prisma_find_unique → HIGH): App Router GET/PATCH /api/posts/[id] does prisma.post.findUnique with no ownership filter; auth check is session-only. The most common Western SaaS IDOR shape.
- 02-express.ts (express_params + orm_find_one → HIGH): Express GET/PATCH /orders/:id under requireAuth middleware that authenticates but does not enforce ownership. Covers the dominant Node.js back-end pattern.
- 03-fastapi.py (fastapi_path_params + sqlalchemy_query_get → HIGH): FastAPI /invoices/{invoice_id} reads the path param via request.path_params and queries with SQLAlchemy db.query(Invoice).get(...); ownership unchecked. Most common Python B2B SaaS pattern.
- 04-rails.rb (rails_params_sym + rails_find_by → HIGH): Rails ProjectsController show/update uses Project.find_by(id: params[:id]); authenticate_user! is role-only. Standard Rails IDOR.
- 05-hono.ts (hono_param + prisma_find_first → HIGH): Hono /documents/:id with JWT middleware; c.req.param("id") flows to prisma.document.findFirst with no ownership filter. Modern edge-runtime pattern.
- 06-nestjs.ts (express_params + orm_find_by_id → HIGH): NestJS CustomersController with @UseGuards(JwtAuthGuard); handler uses @Req() to read req.params.id and calls Mongoose customerModel.findById; ownership unchecked.
- 07-go-chi-raw-sql.go (go_chi_urlparam + go_db_queryrow + raw_sql_where_id → HIGH): Go chi handler reads chi.URLParam(r, "id") and runs a raw SQL SELECT/UPDATE WHERE id with no created_by/owner filter. Covers Go + raw SQL in one fixture.
- 08-trpc.ts (trpc_input_access + prisma_find_unique → HIGH): tRPC router with protectedProcedure where input.id flows to prisma.document.findUnique with no ctx-based ownership filter. The canonical T3-stack IDOR shape.

## Negative (looks similar, actually safe)
- 01-public-resource-no-owner.ts (nextjs_destructured + prisma_find_unique → LOW): Public blog post; the Post model has no userId/authorId field. Pre-filter fires; LLM should reject because the resource is intentionally public.
- 02-admin-via-middleware.ts (express_params + orm_find_one → LOW): Express admin/orders router gated by requireAdmin middleware that verifies role via the user_roles table. Admins are intentionally permitted to inspect any order.
- 03-postgres-rls.ts (express_params + node_pg_query + raw_sql_where_id → LOW): Plain Postgres with `SET LOCAL app.current_user_id` + RLS policy filtering rows on the notes table at the DB layer. Sidecar: `03-postgres-rls.policy.sql` (rebuilt Day 3, leakage stripped).
- 04-supabase-policy.ts (express_params + node_pg_query + raw_sql_where_id → LOW): Supabase-managed Postgres with `SET LOCAL request.jwt.claims` + RLS policy on projects. Authorization enforced at the DB layer via Supabase JWT. Sidecar: `04-supabase-policy.policy.sql` (rebuilt Day 3, leakage stripped).
- 05-admin-via-decorator.ts (nestjs_param + orm_find_by_id → LOW): NestJS admin controller decorated with `@Roles('admin')` + RolesGuard. Endpoint restricted to admin role; cross-tenant access is intentional.
- 06-role-check-in-handler.ts (nextjs_destructured + prisma_find_unique → LOW): Next.js App Router admin route with inline `if (session.user.role !== 'admin') return 403` before any DB access. Admins are intentionally permitted cross-tenant access.
- 07-rls-via-prisma-extension.ts (express_params + prisma_find_unique → LOW): Express handler uses a `tenantPrisma` client built with `$extends` that auto-injects `where: { organizationId }` on every operation. Sidecar: `07-rls-via-prisma-extension.middleware.ts` (rebuilt Day 3, leakage stripped).
- 08-trpc-with-ctx-scoping.ts (trpc_input_access + orm_find_first → LOW): tRPC router with `where: { id: input.id, userId: ctx.session.user.id }` — explicit ownership filter on the query. The correctly-scoped version of the canonical T3 IDOR shape.
