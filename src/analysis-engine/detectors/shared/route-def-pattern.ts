/**
 * Shared Express-family route-definition regex + whole-file payload helper.
 *
 * Used by detectors that need to reason about *absence* of authorization
 * in a route file. The pre-filter sentinel approach (matching individual
 * suspicious strings) is blind by construction to the "no auth wired up
 * at all" shape — there is no sentinel to match. Adding a route-def
 * trigger fixes that blind spot at the cost of routing every Express
 * routes file to the LLM, where a per-detector prompt judges the
 * specific concern.
 *
 * Currently consumed by:
 *   - auth-bypass.detector.ts (Phase 1: missing-middleware)
 *   - admin-check.detector.ts (Phase 2: missing-admin-gate)
 *
 * Limitation by design: Express-family only. Fastify, Koa, Hono, NestJS
 * Guards, Spring @PreAuthorize, etc. are NOT covered until each grows
 * its own positive fixtures and an analogous broadening.
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
