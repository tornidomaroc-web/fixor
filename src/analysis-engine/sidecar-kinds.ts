/**
 * Canonical sidecar-kind names.
 *
 * Sidecars are companion files next to a fixture (or, in production,
 * adjacent files in the repo) that carry safety signal living outside
 * the file under review: Prisma schemas, RLS policies, middleware
 * definitions, config conventions.
 *
 * Single source of truth for the kind strings used as keys in
 * `DetectorContext.sidecarsByPath` and as file-extension → kind
 * mappings in the stability harness. Detectors that consume sidecars
 * should import `SIDECAR_KINDS` and read via the named constants
 * rather than inline string literals, so TypeScript catches typos
 * at compile time instead of runtime.
 *
 * Adding a new kind is a capability extension (rule R7 in
 * docs/detector-test-rules.md): add the constant here, the
 * extension mapping below, the detector's read site, the addendum
 * paragraph, and the user-message render. Co-locate all five
 * changes in one commit.
 */

export const SIDECAR_KINDS = {
  PRISMA_SCHEMA: "prisma-schema",
  RLS_POLICY: "rls-policy",
  MIDDLEWARE: "middleware",
  CONFIG: "config",
  /**
   * Cross-file parent-layout auth guard for Remix / React Router v7
   * file-system routes (Phase G, 2026-05-28). Body is the resolved
   * ancestor `_layout.tsx` loader excerpt(s) plus a per-guard structural
   * coverage label (PROVEN / UNVERIFIED). Lets auth-bypass / admin-check
   * recognize that a route's auth gate lives in a parent layout loader
   * rather than in-file, suppressing the cross-file false positive.
   * Resolver: detectors/shared/route-guard-resolver.ts. Injection points:
   * cli/scan.ts (local scans) and the GitHub App; harness mirror via the
   * `.route-guard.ts` companion-file extension below.
   */
  ROUTE_GUARD: "route-guard",
} as const;

export type SidecarKind = (typeof SIDECAR_KINDS)[keyof typeof SIDECAR_KINDS];

/**
 * File-extension → kind mapping used by the harness loader to read
 * companion files. Production deployment (e.g. the GitHub App) uses
 * its own convention for discovering sidecars in a repo; this map
 * exists only for the single-file fixture harness.
 */
export const SIDECAR_EXT_TO_KIND: Readonly<Record<string, SidecarKind>> = {
  ".schema.prisma": SIDECAR_KINDS.PRISMA_SCHEMA,
  ".policy.sql": SIDECAR_KINDS.RLS_POLICY,
  ".middleware.ts": SIDECAR_KINDS.MIDDLEWARE,
  ".config.ts": SIDECAR_KINDS.CONFIG,
  ".route-guard.ts": SIDECAR_KINDS.ROUTE_GUARD,
};

export const SIDECAR_EXTS = Object.keys(SIDECAR_EXT_TO_KIND);
