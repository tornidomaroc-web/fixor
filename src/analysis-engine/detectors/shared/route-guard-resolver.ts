/**
 * Cross-file parent-layout guard resolver (Phase G, 2026-05-28).
 *
 * Remix / React Router v7 file-system routes commonly enforce auth in a
 * PARENT pathless layout (`_authenticated+/_layout.tsx` whose `loader`
 * throws a redirect), not in each child route. The auth-bypass /
 * admin-check detectors run on a single file and cannot see that sibling
 * layout, so they false-positive on every layout-guarded child route.
 *
 * This resolver walks the route file's ancestor directory chain, finds
 * ancestor `_layout.*` files, extracts their `loader` excerpt, and emits a
 * `route-guard` sidecar body that the detectors inject into the LLM
 * context. The LLM then judges the parent guard with the SAME rigor it
 * applies to an in-file guard (block-on-failure, not session-read).
 *
 * SCOPE (locked fences, see project_fixor_layout_auth_suppression_design):
 *   - Remix / RR v7 only. App Router layouts are NOT covered (a
 *     `layout.tsx` does not wrap `route.ts` handlers; Next discourages
 *     layout authz) — they are a named limitation, handled in a later
 *     cross-file phase. This resolver only fires for paths under
 *     `/routes/` (the Remix flat-routes convention).
 *   - Asymmetric default: a guard is labelled PROVEN coverage ONLY when
 *     the route nests under the layout via an unbroken `+`-folder chain
 *     with no trailing-underscore opt-out. Anything else is UNVERIFIED.
 *     The detector prompt may suppress only on PROVEN+blocking guards;
 *     UNVERIFIED caps at the review queue (medium), never suppress.
 *   - A parent layout exposes a `loader`, which in the Remix lifecycle
 *     gates READS (loaders) but NOT a child route's `action` (actions run
 *     before parent loaders). The detector prompt scopes suppression to
 *     read concerns accordingly; this resolver only surfaces the loader.
 */

import { dirname, basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const LAYOUT_BASENAMES = [
  "_layout.tsx",
  "_layout.ts",
  "_layout.jsx",
  "_layout.js",
];

/** Injected filesystem so the resolver is unit-testable and works in both
 *  the CLI (node:fs) and the GitHub App (repo-tree-backed). */
export interface GuardFs {
  exists(absPath: string): boolean;
  read(absPath: string): string | null;
}

export const nodeGuardFs: GuardFs = {
  exists: (p) => existsSync(p),
  read: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
};

interface ResolvedGuard {
  /** Path relative to the routes root, for human/LLM readability. */
  path: string;
  /** True only when unbroken +-folder nesting proves the layout covers
   *  this route (no non-+ folder, no trailing-underscore opt-out). */
  coverageProven: boolean;
  /** Imports + `loader` function excerpt of the layout (or a note that it
   *  has no loader, i.e. no server-side gate). */
  excerpt: string;
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/** ".../app/routes" prefix of a normalized path, or null if not under routes. */
function findRoutesRoot(normPath: string): string | null {
  const m = normPath.match(/^(.*\/routes)(\/|$)/);
  return m ? m[1]! : null;
}

function extractImports(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "") continue;
    if (/^(import|export\s+\*|export\s+\{)/.test(trimmed)) {
      out.push(lines[i]!);
    } else if (out.length > 0 && /^[a-z_$]/i.test(trimmed)) {
      break;
    }
  }
  return out.join("\n");
}

/** Capture a brace-balanced function body starting at or after `from`.
 *  Skips the parameter list so the opening brace is the function BODY brace,
 *  not a `({ destructured })` parameter brace — otherwise the gate's
 *  redirect/throw (which lives in the body) would be cut from the excerpt. */
function captureBalanced(content: string, from: number, cap = 4000): string {
  const parenClose = content.indexOf(")", from);
  const searchFrom = parenClose >= 0 ? parenClose : from;
  const open = content.indexOf("{", searchFrom);
  if (open < 0) {
    // Arrow with implicit body or const assignment without a block — take
    // the line.
    const eol = content.indexOf("\n", from);
    return content.slice(from, eol < 0 ? content.length : eol);
  }
  let depth = 0;
  for (let i = open; i < content.length && i < from + cap; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.slice(from, i + 1);
    }
  }
  return content.slice(from, Math.min(content.length, from + cap));
}

/** Imports + the `loader` export of a layout file (the server-side gate). */
function extractLoaderExcerpt(content: string): string {
  const imports = extractImports(content);
  const re =
    /export\s+(?:const|(?:async\s+)?function|default\s+(?:async\s+)?function)\s+loader\b/;
  const m = re.exec(content);
  if (!m || m.index === undefined) {
    return (
      (imports ? imports + "\n\n" : "") +
      "// (this layout has no `loader` export — no server-side auth gate here)"
    );
  }
  const fn = captureBalanced(content, m.index);
  return (imports ? imports + "\n\n" : "") + fn;
}

function relFromRoutes(absNorm: string, routesRoot: string): string {
  return absNorm.startsWith(routesRoot + "/")
    ? absNorm.slice(routesRoot.length - "routes".length)
    : absNorm;
}

/** First filename segment (before the first dot), minus extension. */
function firstSegment(fileBasename: string): string {
  const noExt = fileBasename.replace(/\.[^.]*$/, "");
  return noExt.split(".")[0] ?? noExt;
}

function renderGuardSidecar(guards: ResolvedGuard[]): string {
  const blocks = guards.map((g, i) => {
    const cov = g.coverageProven
      ? "PROVEN (unbroken +-folder nesting; this layout's loader runs for this route on read requests)"
      : "UNVERIFIED (could not prove this layout nests over the route via +-folder rules; treat as may-cover only)";
    return [
      `Guard ${i + 1}: ${g.path}`,
      `Structural coverage of this route: ${cov}`,
      "Guard type: parent layout `loader` (Remix/RR v7). Gates read/GET (loader) access only; does NOT gate this route's `action` mutations.",
      "Layout loader excerpt:",
      "```ts",
      g.excerpt,
      "```",
    ].join("\n");
  });
  return (
    "Resolved from ancestor layout route(s) on the file system. A guard " +
    "gates this route ONLY if its loader performs an auth/admin check AND " +
    "blocks on failure (throw redirect / 401 / 403). A loader that merely " +
    "reads the session without blocking is NOT a gate.\n\n" +
    blocks.join("\n\n")
  );
}

/**
 * Resolve parent-layout guards for a Remix/RR v7 route file.
 * Returns the `route-guard` sidecar body, or null when the file is not a
 * Remix route or has no ancestor layout.
 */
export function resolveRemixRouteGuard(
  absFilePath: string,
  fs: GuardFs = nodeGuardFs,
): string | null {
  const norm = normalize(absFilePath);
  if (!/(^|\/)routes\//.test(norm)) return null;
  const routesRoot = findRoutesRoot(norm);
  if (!routesRoot) return null;

  // The route file's own leading segment: a trailing underscore opts the
  // route out of its immediate parent layout (flat-routes convention).
  let coverageBroken = firstSegment(basename(norm)).endsWith("_");

  const guards: ResolvedGuard[] = [];
  let dir = dirname(norm);

  // Walk up to (and including) the routes root.
  for (let guard = 0; guard < 64; guard++) {
    const dirNorm = normalize(dir);
    for (const lb of LAYOUT_BASENAMES) {
      const candidate = join(dir, lb);
      const candidateNorm = normalize(candidate);
      if (candidateNorm === norm) continue; // never treat the file as its own guard
      if (fs.exists(candidate)) {
        const content = fs.read(candidate);
        if (content !== null) {
          guards.push({
            path: relFromRoutes(candidateNorm, routesRoot),
            coverageProven: !coverageBroken,
            excerpt: extractLoaderExcerpt(content),
          });
        }
        break; // at most one layout per directory
      }
    }
    if (dirNorm === routesRoot) break;

    // Decide whether climbing past this directory keeps +-folder nesting
    // intact. A non-+ folder, or a trailing-underscore opt-out on the
    // folder segment, breaks the structural proof for every layout ABOVE.
    const dirBase = basename(dirNorm);
    if (!dirBase.endsWith("+")) {
      coverageBroken = true;
    } else if (dirBase.slice(0, -1).endsWith("_")) {
      coverageBroken = true;
    }

    const parent = dirname(dir);
    if (normalize(parent) === dirNorm) break; // fs root guard
    dir = parent;
  }

  if (guards.length === 0) return null;

  // Fence 2, enforced deterministically (not via prompt): only
  // PROVEN-coverage guards are clearing-eligible. The LLM cannot be
  // trusted to honor a soft "UNVERIFIED caps at medium" instruction — in
  // calibration it rationalized clearing an UNVERIFIED guard as
  // "plausibly nested + read-only". So a guard we cannot structurally
  // prove covers this route is never surfaced as a basis for suppression;
  // the route is then judged as unguarded and flags at its natural
  // severity. Non-+-folder / opt-out Remix conventions therefore get no
  // suppression here (a named limitation), never a false negative.
  const proven = guards.filter((g) => g.coverageProven);
  if (proven.length === 0) return null;
  return renderGuardSidecar(proven);
}
