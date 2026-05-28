/**
 * Shared route-definition regexes + whole-file payload helper.
 *
 * Used by detectors that need to reason about *absence* of authorization
 * in a route file. The pre-filter sentinel approach (matching individual
 * suspicious strings) is blind by construction to the "no auth wired up
 * at all" shape — there is no sentinel to match. Adding a route-def
 * trigger fixes that blind spot at the cost of routing every route file
 * to the LLM, where a per-detector prompt judges the specific concern.
 *
 * Three regex constants exported, one per framework shape:
 *   - EXPRESS_ROUTE_DEF_RE     — router-style: `router.METHOD(path, ...)`.
 *   - APP_ROUTER_ROUTE_DEF_RE  — file-system-routed Next.js App Router
 *                                HTTP-method-named exports: `export const
 *                                POST = ...` or `export async function
 *                                GET(...)`, etc.
 *   - REMIX_HANDLER_DEF_RE     — Remix v2 file-system-routed handler
 *                                exports: `export const loader = ...`,
 *                                `export const action = ...`, etc. Added
 *                                in Phase E; sibling to APP_ROUTER_ROUTE_DEF_RE
 *                                so consumers can apply the Remix-only
 *                                path-aware filter `isRemixRoutePath`
 *                                without perturbing the Next.js behavior.
 *
 * Currently consumed by:
 *   - auth-bypass.detector.ts (Phase 1: missing-middleware, all shapes)
 *   - admin-check.detector.ts (Phase 2: missing-admin-gate, all shapes)
 *   - webhook-unverified.detector.ts (file-system-routed handlers)
 *   - cli/scan.ts (route-shape pre-count for cost estimation)
 */

/**
 * Catches an HTTP route declaration on a router-like identifier: literal
 * `router`, `app`, `api`, or any identifier ending in `Router|App|Api`
 * (e.g. `adminRouter`, `teamRouter`, `apiRouter`). The required
 * `\s*\(\s*["'`]` tail (a string for path literals) excludes most
 * non-route callsites such as `db.user.delete(id)` or
 * `axios.post(url, body)` where the first arg isn't a string literal.
 *
 * Detectors using this should keep the sentinel id stable as
 * `"express_route_def"` so test diagnostics and analyzeFile post-
 * filtering remain symmetric.
 */
export const EXPRESS_ROUTE_DEF_RE =
  /\b(?:router|app|api|[A-Za-z_$][A-Za-z0-9_$]*(?:Router|App|Api))\.(?:get|post|put|delete|patch|use|all)\s*\(\s*["'`]/;

/**
 * Catches a file-system-routed HTTP-method-named handler export in
 * Next.js App Router style: `export const POST = ...`, `export async
 * function GET(...)`, `export function PUT(...)`, `export default
 * function POST(...)`, or any combination with `async` / `default`.
 * The trailing HTTP-method capture group `(GET|POST|PUT|DELETE|PATCH|
 * HEAD|OPTIONS)\b` is the structural defense against over-matching
 * common Next.js config exports — `export const dynamic`, `export
 * const revalidate`, `export const runtime`, `export const fetchCache`,
 * `export const preferredRegion`, `export const maxDuration`, `export
 * const generateStaticParams` — none of which use HTTP-method-named
 * identifiers and therefore none match.
 *
 * Remix `loader` / `action` exports are covered by the sibling
 * REMIX_HANDLER_DEF_RE (Phase E, 2026-05-23). Kept as a separate
 * regex rather than extending the alternation here so consumers can
 * apply the Remix-only `isRemixRoutePath` path-aware filter without
 * perturbing the Next.js App Router prefilter behavior. Next.js's
 * `app/.../route.ts` file-system convention is already implicit; Remix
 * needs the path filter because `export const loader` is also a
 * Remix data-fetch utility convention, not only a route handler.
 *
 * The `\b` boundary at the end protects against substring traps:
 * `export const POSTING = ...` and `export const POST_HANDLER = ...`
 * do not match (the next character is a word character, so no boundary).
 *
 * Limitations by design:
 *   - Re-exports do not match: `export { POST } from "./handlers"` has
 *     no `const`/`function` keyword between `export` and `POST`, so the
 *     declaration site (in `handlers.ts`) is what reaches the LLM, not
 *     the re-export site. Same shape as Express's `router.use()` in a
 *     sibling file — a cross-file gap, documented out-of-scope.
 *   - Destructured exports do not match: `export const { POST } = ...`
 *     has a `{` between `const` and `POST`. Rare in practice.
 *   - `export const POST = "string-not-a-handler"` matches the prefilter
 *     but the LLM stage trivially judges it as non-vulnerable, costing
 *     ~$0.01 per such file with no false-finding.
 *
 * Detectors using this should keep the sentinel id stable as
 * `"app_router_route_def"` so test diagnostics and analyzeFile post-
 * filtering remain symmetric with the Express counterpart.
 */
export const APP_ROUTER_ROUTE_DEF_RE =
  /\bexport\s+(?:const|(?:async\s+)?function|default\s+(?:async\s+)?function)\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/;

/**
 * Catches a Remix v2 file-system-routed handler export: `export const
 * loader = ...`, `export const action = ...`, `export async function
 * loader(...)`, `export async function action(...)`, or any combination
 * with `async` / `default`. Phase E addition (2026-05-23).
 *
 * Sibling to APP_ROUTER_ROUTE_DEF_RE rather than an extended alternation
 * because Remix `loader`/`action` exports have a different over-match
 * profile than Next.js HTTP-method-named exports: `loader` and `action`
 * are also generic Remix conventions for data-fetching and form-handling
 * utility modules, not only route handlers. Detectors using this regex
 * MUST also call `isRemixRoutePath(filePath)` to bound the over-match —
 * a utility module like `app/lib/loader-factory.ts` would match the
 * regex but is not a route handler and should not route to the LLM.
 *
 * Over-match measurement on Trigger.dev (Phase E gate):
 *   - 320/411 files under `apps/webapp/app/routes/` match this regex
 *     (~78% prefilter hit rate on Remix v2 routes).
 *   - Outside `/routes/`: exactly 1 file in the entire webapp matches
 *     (`app/root.tsx`, the Remix root layout — which IS a legitimate
 *     route handler, not a utility). Unknown Remix codebases with
 *     loose conventions may export `loader`/`action` from utility
 *     modules; the path filter is the cost-bounding defense.
 *
 * Detectors using this should keep the sentinel id stable as
 * `"remix_handler_def"` so test diagnostics and analyzeFile post-
 * filtering remain symmetric with `app_router_route_def`. Treat both
 * route-def sentinels identically downstream (whole-file payload via
 * `buildFunctionCodePayload`); the only difference is the prefilter-
 * stage path-aware filter Remix needs.
 */
export const REMIX_HANDLER_DEF_RE =
  /\bexport\s+(?:const|(?:async\s+)?function|default\s+(?:async\s+)?function)\s+(?:loader|action)\b/;

/**
 * Catches a FastAPI / Flask-2.0 route decorator: `@app.get("/x")`,
 * `@router.post("/x")`, `@app.delete("/x/{id}")`, `@router.api_route(...)`,
 * on an `app`/`router`/`api_router`/`v1`-style identifier (one or more dot
 * segments). Phase G+ (Python slice 1, 2026-05-28).
 *
 * The leading `@` is the structural defense that separates a Python route
 * DECORATOR from an Express-style `app.get(...)` call (no `@`): the Express
 * regex requires a string-literal first arg and no `@`; this one requires
 * the `@` decorator prefix. Detectors MUST also lang-gate this to `.py`
 * (see isPythonPath) so a `.ts` file containing `@something.get(` (rare,
 * e.g. a decorator-based TS framework) does not route through the Python
 * rubric, and conversely the JS route-def patterns do not fire on `.py`.
 *
 * Slice 1 scope: FastAPI `.METHOD` decorators (and Flask 2.0 `@app.get`
 * shorthand as a bonus). Flask classic `@app.route(..., methods=[...])`
 * is a later slice. Keep the sentinel id stable as `"fastapi_route_def"`.
 */
export const FASTAPI_ROUTE_DEF_RE =
  /@[A-Za-z_]\w*(?:\.\w+)*\.(?:get|post|put|delete|patch|head|options|api_route)\b\s*\(/;

/**
 * Catches a Flask CLASSIC route decorator: `@app.route("/x", methods=[...])`,
 * `@bp.route(...)`, `@blueprint.route(...)` (Python slice Flask, 2026-05-28).
 *
 * The `.route` decorator method is Flask-specific — FastAPI has no `.route`
 * decorator (it uses `.get`/`.post`/`.api_route`, covered by
 * FASTAPI_ROUTE_DEF_RE). So `.route` carries NO FastAPI overlap and needs no
 * disambiguation. The Flask 2.0 `@app.get`/`@app.post` SHORTHAND, however,
 * IS shared with FastAPI and is matched by FASTAPI_ROUTE_DEF_RE; the
 * detectors disambiguate Flask-vs-FastAPI for that shorthand in the LLM
 * stage by reading the file's imports (`from flask`/`flask_login` => Flask
 * rubric; `from fastapi` => FastAPI rubric). Lang-gated to `.py`.
 */
export const FLASK_ROUTE_DEF_RE =
  /@[A-Za-z_]\w*(?:\.\w+)*\.route\s*\(/;

/** True for Python files (route-shape lang-gating; keeps the JS and Python
 *  route-def prefilters from cross-firing on each other's files). */
export function isPythonPath(filePath: string): boolean {
  return /\.py$/i.test(filePath.replace(/\\/g, "/"));
}

/**
 * Returns true when the filepath sits in a Remix v2 route position:
 * under any `/routes/` segment (the Remix v2 file-system routing
 * convention) OR matches `app/root.tsx` (the root layout, which has
 * its own loader/action). False for utility modules that happen to
 * export `loader`/`action` from elsewhere (e.g. `app/lib/loader-factory.ts`,
 * `app/utils/action-helpers.ts`) — those should NOT route to the LLM
 * as if they were route handlers.
 *
 * Bound for the council-flagged over-match risk on REMIX_HANDLER_DEF_RE.
 * Without this filter, an unknown Remix codebase exporting `loader`/
 * `action` from utility modules would route extra files through the
 * LLM at ~$0.012 each — bounded per file but unbounded in count. With
 * this filter, prefilter signal stays local to the Remix file-system
 * convention.
 *
 * Implementation notes:
 *   - Normalizes backslashes to forward slashes so Windows-walker paths
 *     pass the same test.
 *   - `/routes/` is matched as a path SEGMENT (between separators) so
 *     `app/routes/users.tsx` matches but `app/component-routes-list.ts`
 *     does not.
 *   - `app/root.{ts,tsx}` is matched at the END of the path so nested
 *     `app/lib/app/root.ts` (hypothetical) would not match.
 */
export function isRemixRoutePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    /(^|\/)routes\//.test(normalized) ||
    /(^|\/)app\/root\.tsx?$/.test(normalized)
  );
}

/**
 * Hard upper bound on the size of file content shipped wholesale to the
 * LLM as functionCode. Above this bound we fall back to the per-trigger
 * window. 200 KB picks a defensible ceiling: a realistic Express routes
 * file is well under 10 KB; anything over 200 KB is almost certainly a
 * generated bundle, a vendored polyfill blob, or a fixture concatenated
 * for testing, none of which produce useful sibling-route signal.
 *
 * Closes the Phase 1 P2: Phase 1 shipped without a cap, which meant a
 * pathologically large routes file would have driven the LLM payload
 * (and per-call cost) without bound.
 */
export const WHOLE_FILE_PAYLOAD_CAP_BYTES = 200 * 1024;

/**
 * Default ±8 / +16 line window used by all current detectors when a
 * trigger is NOT a whole-file route-def trigger (or when the file
 * exceeds the size cap).
 */
function extractContextWindow(content: string, lineNumber: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, lineNumber - 1 - 8);
  const end = Math.min(lines.length, lineNumber - 1 + 16);
  return lines.slice(start, end).join("\n");
}

/**
 * Pick the LLM functionCode payload for a given trigger.
 *
 * - For a route-def trigger on a file ≤ size cap → whole file, so the
 *   prompt can compare the trigger route against its sibling routes.
 * - Otherwise (any other trigger OR oversize file) → the ±8/+16 window.
 *
 * `isRouteDefTrigger` is passed in (not derived) so the caller can keep
 * the patternId comparison local to its own detector.
 */
export function buildFunctionCodePayload(params: {
  content: string;
  anchorLine: number;
  isRouteDefTrigger: boolean;
}): string {
  if (
    params.isRouteDefTrigger &&
    Buffer.byteLength(params.content, "utf8") <= WHOLE_FILE_PAYLOAD_CAP_BYTES
  ) {
    return params.content;
  }
  return extractContextWindow(params.content, params.anchorLine);
}
