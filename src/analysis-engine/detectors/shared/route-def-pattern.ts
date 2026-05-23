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
 * Two regex constants exported, one per framework shape:
 *   - EXPRESS_ROUTE_DEF_RE     — router-style: `router.METHOD(path, ...)`.
 *   - APP_ROUTER_ROUTE_DEF_RE  — file-system-routed: `export const POST = ...`
 *                                or `export async function GET(...)`, etc.
 *
 * Currently consumed by:
 *   - auth-bypass.detector.ts (Phase 1: missing-middleware, both shapes)
 *   - admin-check.detector.ts (Phase 2: missing-admin-gate, both shapes)
 *   - webhook-unverified.detector.ts (App Router file-system-routed handlers)
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
 * Catches a file-system-routed handler export in Next.js App Router /
 * Remix style: `export const POST = ...`, `export async function GET(...)`,
 * `export function PUT(...)`, `export default function POST(...)`, or any
 * combination with `async` / `default`. The trailing HTTP-method capture
 * group `(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b` is the structural
 * defense against over-matching common Next.js config exports — `export
 * const dynamic`, `export const revalidate`, `export const runtime`,
 * `export const fetchCache`, `export const preferredRegion`, `export
 * const maxDuration`, `export const generateStaticParams` — none of
 * which use HTTP-method-named identifiers and therefore none match.
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
