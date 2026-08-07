/**
 * Admin-check detector.
 *
 * Mirrors Phase 5b (env-exposure) architecture: path/import + regex
 * pre-filter (full-content scan), then per-file LLM call via callClaude
 * with a tool that enforces the verdict JSON shape.
 * HIGH and MEDIUM verdicts are both EMITTED, carrying the model's own
 * confidence on the finding; LOW is dropped silently. MEDIUM used to be
 * discarded to a logger.warn nothing consumed — the emit-policy decision
 * of 2026-08-07 ended that. Severity is unchanged by confidence: severity
 * answers "how bad if real", confidence answers "is it real".
 *
 * Filter order:
 *   1. shouldSkipPath
 *   2. hasServerOnlyMarker
 *   3. prefilterRegex   (full-content scan; multi-line aware)
 *   4. LLM call
 *
 * Note: the role_string_compare pattern (P9) is intentionally broad — it
 * matches both vulnerable (string-only) and safe (DB-then-string-check)
 * cases. The LLM's job, per the prompt's reject rules, is to distinguish
 * "role from DB / JWT / RBAC middleware" (safe) from "role from hardcoded
 * string only" (vulnerable).
 */

import { createHash } from "node:crypto";

import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import type {
  Detector,
  DetectorContext,
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../detector.types";
import { deriveFindingId } from "../detector.types";
import { callClaude, cachedSystem } from "../anthropic-client";
import { CLAUDE_MODELS } from "../../config/models";
import { logger } from "../../lib/logger";
import { resolveMediumVerdict } from "../verdict-escalation";
import { parseDiff, remapFindingLines } from "./shared/diff-parser";
import {
  APP_ROUTER_ROUTE_DEF_RE,
  EXPRESS_ROUTE_DEF_RE,
  REMIX_HANDLER_DEF_RE,
  FASTAPI_ROUTE_DEF_RE,
  FLASK_ROUTE_DEF_RE,
  buildFunctionCodePayload,
  isRemixRoutePath,
  isPythonPath,
  resolveRouteAnchorLine,
  extractReportSnippet,
} from "./shared/route-def-pattern";
import { SIDECAR_KINDS } from "../sidecar-kinds";

const DETECTOR_ID = "admin-check-multi";

const SUPPORTED_LANGS = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "go",
  "rb",
  "java",
  "kt",
] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

interface PrefilterHit {
  patternId: string;
  patternText: string;
  line: number;
}

interface LlmVerdict {
  isVulnerable: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  suggestedFix?: string | null;
  /** Method+path of the single route this verdict concerns, copied verbatim
   *  by the LLM, used to anchor the finding at that route (not the first
   *  route in the file). Optional; absent → fall back to the trigger line. */
  vulnerableRoute?: string | null;
}

interface FileDiagnostic {
  file: string;
  preFilterReason?: string;
  triggerCount: number;
  verdict?: LlmVerdict | null;
  flagged: boolean;
}
interface PrefilterPattern {
  id: string;
  re: RegExp;
  /**
   * Pattern classification for Option G bypass eligibility (see D8 in
   * docs/detector-test-rules.md "Detector ≠ pattern set").
   *
   * - "literal": regex match IS the bug. Bypass safe when llmValidation
   *   is false; emit finding directly from `explanation`.
   * - "judgment": regex matches a shape requiring context to
   *   disambiguate (LLM does real discrimination). Always keeps LLM
   *   in the loop regardless of llmValidation setting.
   *
   * Defaults to "judgment" conservatively when omitted.
   */
  tier?: "literal" | "judgment";
  /**
   * Hand-authored finding explanation used when this pattern bypasses
   * LLM. Required for literal-tier patterns; ignored for judgment-tier
   * (LLM produces reasoning). Format: identify class + attack surface +
   * remediation. NEVER quotes matched source content (see D8).
   */
  explanation?: string;
}

const PREFILTER_PATTERNS: PrefilterPattern[] = [
  {
    id: "email_eq_literal",
    re: /\bemail\s*===?\s*['"][^'"@]+@/i,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded email comparison. The code grants admin privileges when the authenticated user's email exactly matches a literal string in source. This trusts the email value (which may come from session, JWT payload, or request body — any of which can be spoofed if not server-signed and verified) instead of consulting an authoritative role store. Move admin role assignment to a database table (`user_roles`, `org_members`, or similar), look up the role from there using the authenticated user ID, and remove the hardcoded comparison.",
  },
  // THE `/i` FLAG BELOW IS LOAD-BEARING. DO NOT REMOVE IT.
  //
  // This one pattern covers BOTH spellings of the call. The regex body is
  // written camelCase for JS/TS (`email.endsWith`), and the `/i` is the only
  // reason it also matches Python's `email.endswith` — plus any other casing
  // (`ENDSWITH`, `EnDsWiTh`). Drop the `/i` and admin-check silently stops
  // detecting the hardcoded-domain-suffix admin grant in EVERY Python file,
  // which is the language where `email.endswith("@corp.com")` is the idiomatic
  // spelling. Silently: there is no error, the finding simply never appears.
  //
  // What catches it: `fixtures/admin-check/positive/08-flask-endswith-domain.py`
  // contains `email.endswith("@acme.app")` and is pinned in BYPASS_EXPECTED
  // (src/test/test-admin-check-prefilter.ts) to THIS pattern id. Without `/i`
  // that fixture matches no pattern at all, so it drops pre-model instead of
  // bypassing, and `npm run test:admin-check-prefilter` fails loudly. That
  // fixture is the standing guard on this invariant; do not delete it either.
  //
  // History: a separate `py_email_endswith_at` pattern used to sit directly
  // below this one, holding the identical regex in Python casing — also `/i`,
  // therefore accepting exactly the same strings at exactly the same index.
  // Because `prefilterRegex` breaks ties with a strict `<`, the earlier entry
  // always won and the Python twin was unreachable by any input. It was dead
  // code, not coverage, and was deleted (PR C2) rather than lang-gated: its
  // explanation was a strictly poorer paraphrase of this one, and gating would
  // have changed the emitted ruleId on Python findings, breaking the
  // ruleId-keyed SARIF fingerprint and re-opening already-triaged alerts.
  {
    id: "email_endswith_at",
    re: /\bemail\.endsWith\s*\(\s*['"]\s*@/i,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded domain suffix check. The code grants admin or elevated privileges to any user whose email ends with a specific domain. This is trivially bypassable: an attacker who can register an email on that domain (any public provider with the matching suffix, or any subdomain the attacker controls) is granted admin, and the email value itself may be spoofable if not from a verified source. Replace with a database-backed role lookup keyed on the authenticated user ID, or with a verified JWT claim from a trusted issuer.",
  },
  {
    id: "email_includes_admin",
    re: /\bemail\.includes\s*\(\s*['"](?:admin|owner|founder|root|superuser)/i,
    tier: "literal",
    explanation:
      "Admin grant via email substring match on privileged keywords ('admin', 'owner', 'founder', 'root', 'superuser'). Trivially bypassable — any user can register an email like 'notanadmin@evil.com' or 'realfounder@attacker.com' and pass the check. Replace with a database-backed role lookup keyed on authenticated user ID, or with a verified JWT claim. (Note: if this `includes` check is used for non-grant purposes such as blocking admin-themed signups or audit logging, the regex over-fired; review and reclassify the pattern.)",
  },
  {
    id: "strings_hassuffix_email",
    re: /strings\.HasSuffix\s*\(\s*\w*email\w*\s*,\s*['"]@/i,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded domain suffix check (Go `strings.HasSuffix`). The code grants admin privileges to any user whose email ends with a specific domain. Bypassable by registering or spoofing an email on the matching domain. Replace with a database-backed role lookup keyed on authenticated user ID, or with a verified JWT claim from a trusted issuer.",
  },
  {
    id: "default_admin_id",
    re: /\bDEFAULT_ADMIN_ID\b/,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded `DEFAULT_ADMIN_ID` fallback. The code falls back to a hardcoded user ID with admin privileges when the authenticated user is missing or unparseable, granting admin access to any unauthenticated or partially-authenticated request. Remove the fallback entirely: unauthenticated requests should fail with 401 (no default identity), and the route must require an authenticated session plus a database-backed admin role check before any privileged operation.",
  },
  {
    id: "default_admin_email",
    re: /\bDEFAULT_ADMIN_EMAIL\b/,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded `DEFAULT_ADMIN_EMAIL` fallback. Same shape as DEFAULT_ADMIN_ID: when no authenticated email is present, the code falls back to a constant value used to determine admin status, granting admin to unauthenticated callers. Remove the fallback; unauthenticated requests should fail with 401, never receive a default identity.",
  },
  {
    id: "admin_emails_array",
    re: /\b(?:ADMIN_EMAILS|admin_emails)\s*=\s*\[/,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded email allowlist (`ADMIN_EMAILS` array or similar). Membership in a literal array of email strings determines admin privileges. Hardcoded admin identity in source code is visible to anyone with repository access, requires a redeploy to revoke or add admins, is invisible to runtime configuration audits, and bypasses any standard audit-log-of-admin-changes pattern. Move admin role assignment to a database table managed via admin UI or migration, and look up the role at request time.",
  },
  {
    id: "role_string_compare",
    re: /\b(?:userRole|user\.role|role|claims\.role)\s*(?:===?|!==?)\s*['"](?:admin|owner|superadmin|root)['"]/i,
    tier: "judgment",
    // No explanation — judgment-tier patterns keep LLM in the loop and
    // use LLM-generated reasoning. The regex matches `role === "admin"`
    // which appears in BOTH bug cases (client-supplied role) and safe
    // cases (DB-backed role lookup, verified JWT claim); only the LLM
    // can read data flow to discriminate. Bypassing LLM here would FP
    // on every legitimate DB-backed role check (6 cognitive negatives
    // in Day 4 admin-check audit).
  },
  {
    id: "role_fallback_admin",
    re: /\brole\s*\?\?\s*['"](?:admin|owner)['"]/i,
    tier: "literal",
    explanation:
      "Admin grant via nullish-coalescing fallback to `'admin'`. The expression `role ?? 'admin'` evaluates to `'admin'` whenever `role` is undefined or null — which is the case for unauthenticated requests. Any caller without a session is silently granted admin privileges. Remove the fallback: unauthenticated requests should fail with 401, and authenticated requests should have their role looked up from a trusted source (DB or verified JWT), never default to admin.",
  },
  {
    id: "body_role_check",
    re: /req\.(?:body|query|params)\.\w*[Rr]ole\b/,
    tier: "literal",
    explanation:
      "Admin grant via client-supplied role from request body, query string, or path params. The code reads `role` directly from the HTTP request and uses it for an authorization decision. The request is fully attacker-controlled — any client can supply `{ \"role\": \"admin\" }` to bypass the check. Replace with a server-side role lookup keyed on the authenticated session or JWT user ID; never trust role values supplied by the client.",
  },
  {
    id: "admin_email_const",
    re: /\b(?:ADMIN_EMAIL|admin_email)\s*=\s*['"][^'"]*@/i,
    tier: "literal",
    explanation:
      "Admin grant via hardcoded `ADMIN_EMAIL` constant compared to user email. Admin identity is determined by string equality with a single email literal embedded in source. Same problems as hardcoded admin arrays: source-embedded admin identity is hard to revoke (requires redeploy), invisible to runtime audits, exposed to anyone with repository access. Move admin role assignment to a database table managed via admin UI or migration, and look up the role at request time.",
  },
  // Express-family route definition (Phase 2 missing-admin-gate
  // remediation, mirrors the Phase 1 auth-bypass broadening). The
  // sentinel-string prefilter is blind by construction to the
  // "privileged route with NO admin check anywhere" shape — there is
  // no sentinel to match when the bug is the absence of authorization
  // code. The route-def trigger forces every Express routes file to
  // the LLM, where the prompt judges whether the route performs a
  // privileged action without an admin gate.
  //
  // tier=judgment: the LLM MUST disambiguate (e.g. a public router by
  // design vs. a sensitive route with the admin gate forgotten).
  // Bypassing the LLM here would either flag every routes file or
  // none. Pattern lives in detectors/shared/route-def-pattern.ts so
  // auth-bypass and admin-check stay in sync.
  {
    id: "express_route_def",
    re: EXPRESS_ROUTE_DEF_RE,
    tier: "judgment",
  },
  // File-system-routed framework handlers (Next.js App Router, Remix).
  // Sibling addition to express_route_def. Same tier=judgment semantics:
  // every App Router route file reaches the LLM for missing-admin-gate
  // judgment. The HOC-name-convention check happens in the LLM stage.
  {
    id: "app_router_route_def",
    re: APP_ROUTER_ROUTE_DEF_RE,
    tier: "judgment",
  },
  // Remix v2 `loader` / `action` exports (Phase E, 2026-05-23). Sibling
  // to app_router_route_def with the same tier=judgment semantics and
  // the same whole-file payload downstream. The prefilter applies
  // isRemixRoutePath to bound REMIX_HANDLER_DEF_RE over-match on
  // utility modules outside `app/routes/` — see analyzeFile.
  {
    id: "remix_handler_def",
    re: REMIX_HANDLER_DEF_RE,
    tier: "judgment",
  },
  // FastAPI / Flask-2.0 route decorators (Python slice 1b, 2026-05-28).
  // Shares FASTAPI_ROUTE_DEF_RE with auth-bypass (added slice 1). Lang-
  // gated to `.py` in prefilterRegex. tier=judgment: the LLM judges
  // whether the decorated route performs an ADMIN op without an admin
  // gate (admin-suggesting Depends/decorator/inline check). SYSTEM_PROMPT
  // case 4 (FastAPI). In-file Depends name-convention only this slice.
  {
    id: "fastapi_route_def",
    re: FASTAPI_ROUTE_DEF_RE,
    tier: "judgment",
  },
  // Flask classic `@app.route(..., methods=[...])` (Python Flask slice,
  // 2026-05-28). Lang-gated to `.py`. tier=judgment: the LLM judges
  // whether the Flask route performs an ADMIN op without an admin gate
  // (@admin_required / is_admin / role check). @login_required alone is
  // NOT sufficient for admin-check. SYSTEM_PROMPT case 6 (Flask).
  {
    id: "flask_route_def",
    re: FLASK_ROUTE_DEF_RE,
    tier: "judgment",
  },
];

const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

const SYSTEM_PROMPT = `You are a security auditor analyzing a code change for admin-check
vulnerabilities.

Admin-check vulnerability shapes you must detect:

1. Hardcoded-admin shapes: administrator privileges granted via hardcoded
   email comparison, domain suffix matching, hardcoded email allowlist
   array, hardcoded DEFAULT_ADMIN_ID/_EMAIL fallback, nullish-coalescing
   to the admin literal, client-supplied role read from req.body/query/
   params, or string-based role check on a client-controlled value
   instead of proper RBAC backed by a database table or server-signed
   JWT claims.

2. Missing-admin-gate shapes: a sensitive/privileged route declared on
   an Express-family router (router.post/.get/.put/.delete/.patch etc.)
   that performs an administrative action (role/tier change, user
   management, billing settings, account management, /admin/* paths,
   privileged toggles) and has NO admin authorization check anywhere
   — neither in the route's argument list as a middleware (requireAdmin,
   isAdmin, adminOnly, verifyAdmin) nor inline in the handler body
   (role lookup against an authoritative source, allowlist check, etc.).
   Strong tell: sibling routes on the SAME router pass an admin
   middleware (requireAdmin or similar) but this route does not. If
   every route on the router is unguarded, it is more likely a public
   router by design — be cautious and prefer medium/low confidence
   unless the route is unambiguously administrative.

3. Missing-admin-HOC-wrapper shapes on file-system-routed frameworks
   (Next.js App Router, Remix): a sensitive/privileged route exported
   as \`export const PUT = ...\`, \`export async function POST(...)\`,
   or \`export default function DELETE(...)\` that performs an
   administrative action (same destructive shapes as case 2) AND is
   NOT wrapped in a higher-order function whose NAME convention
   suggests admin enforcement, AND has no inline admin authorization
   check in the handler body.
   - Treat as GATED (NOT vulnerable) when wrapped in any of:
     \`withAdmin\`, \`requireAdmin\`, \`adminOnly\`, \`isAdmin\`,
     \`verifyAdmin\`, \`withAdminAuth\`, \`withRole("admin", ...)\`,
     \`withMiddleware(requireAdmin, ...)\`, or any HOC identifier
     containing "admin" as a substring of its name.
   - General auth HOCs (\`withAuth\`, \`requireAuth\`, \`withSession\`,
     \`protect\`) are NOT sufficient on their own for admin-check —
     they enforce authentication, not admin authorization. A
     \`withAuth(...)\` wrapped admin-action route is still admin-gate-
     vulnerable unless the body adds an admin-role check (e.g.,
     \`if (user.role !== "admin") return 403\`).
   - Do NOT assume gating for non-admin HOCs: \`withLogging\`,
     \`withCors\`, \`withRateLimit\`, \`withTrace\`, \`withErrorBoundary\`,
     \`withMetrics\`, \`withDb\`, \`withCache\`. Effectively unguarded.
   - Generic-named wrappers like \`withRoute(...)\` or \`appWrapper(...)\`
     are ambiguous — treat as UNgated by default (documented
     out-of-scope limitation analogous to Express's cross-file gap).
   - Inline admin checks in the handler body (e.g., a call to
     \`getServerSession()\` followed by \`if (session.user.role !==
     "admin") return Response.json({}, { status: 403 })\`, or an
     explicit RBAC lookup against a DB role) DO count as gating.
   - An admin-suggesting helper call invoked in the handler body
     BEFORE the privileged operation counts as gating, by the same
     name-convention discipline as the HOC wrapper rule above:
     helper-function identifiers like \`requireAdmin\`,
     \`requireAdminRole\`, \`assertAdmin\`, \`assertAdminRole\`,
     \`checkAdmin\`, \`enforceAdminRole\`, \`verifyAdminAccess\`, or
     any helper-function identifier containing "admin" as a
     substring of its name. The helper's NAME must suggest admin
     enforcement; non-admin-suggesting helper calls invoked before
     the privileged operation (e.g., \`logAccess()\`,
     \`recordEvent()\`, \`trackRequest()\`, \`auditTrail()\`,
     \`withRateLimit()\`, \`captureMetric()\`) do NOT count as
     gating — the route is still admin-gate-vulnerable. The same
     out-of-scope limitation applies as for HOC wrappers: a
     deceptively-named helper that hides admin enforcement under a
     non-admin name, or a generic-named helper that does enforce
     admin internally, cannot be resolved without cross-file
     analysis.

4. Cross-file PARENT-LAYOUT admin guard (Remix / React Router v7 only):
   when a "PARENT ROUTE GUARDS" block is present in the context below, it
   holds the loader(s) of this route's ancestor layout route(s), resolved
   from the file system. Judge them with the SAME rigor as an in-file
   admin gate:
   - GATES only if the layout loader performs an ADMIN authorization check
     (e.g. \`isAdmin(user)\`, a role lookup against an authoritative store,
     \`user.role !== "admin"\`) AND BLOCKS on failure (throw redirect /
     401 / 403). A layout loader that only enforces AUTHENTICATION (a
     plain session check / redirect to signin) is NOT an admin gate — the
     same rule as \`withAuth\` being insufficient for admin-check. A loader
     that merely reads the session without blocking is not a gate at all.
   - COVERAGE: a guard may CLEAR this route (isVulnerable=false) ONLY when
     its "Structural coverage" is PROVEN. If coverage is UNVERIFIED you
     MUST NOT clear the route: set isVulnerable=true with confidence at
     most medium (review queue). Do NOT treat "read-only loader", "likely
     nested", or the file path as grounds to clear — only a PROVEN,
     blocking admin guard clears. Reading admin-only data without an admin
     gate is itself the vulnerability; being a read does not excuse it.
   - READ vs WRITE: a layout exposes a \`loader\` (gates read/GET access);
     it does NOT gate a child route's \`action\` (mutations run before
     parent loaders). For a destructive admin ACTION, judge its own
     authorization and ignore the parent loader.
   - When a PROVEN parent layout loader performs a blocking ADMIN check
     that covers the READ concern that triggered review, the route is NOT
     vulnerable (isVulnerable false, low): the admin gate lives in the
     ancestor layout, so the apparent missing in-file admin check is a
     false positive.
PYTHON FRAMEWORK DISAMBIGUATION (read before cases 5-6): the
\`@app.get\`/\`@app.post\` decorator SHORTHAND is shared by FastAPI and
Flask 2.0, so decide the framework from the file's IMPORTS. \`from fastapi\`
=> FastAPI, use case 5 (Depends rubric). \`from flask\` / \`from flask_login\`
=> Flask, use case 6 (decorator/current_user rubric). Flask's
\`@app.route(...)\` is Flask-only. If the file imports NEITHER framework,
you cannot attribute it in-file: do NOT apply either rubric, return
isVulnerable=false, low (cross-file, out of scope).

5. Missing-admin-gate on FastAPI: a route decorated with \`@app.METHOD\` /
   \`@router.METHOD\` in a file whose imports show FastAPI, performing an
   ADMINISTRATIVE action (user management, role/tier change, billing
   settings, \`/admin/*\` paths, instance-wide stats, privileged toggles)
   that is not admin-gated.
   - Treat as GATED (NOT vulnerable) when an ADMIN-suggesting dependency is
     in the signature by NAME convention: \`Depends(require_admin)\`,
     \`Depends(get_current_active_superuser)\`, \`Depends(get_admin_user)\`,
     \`Depends(verify_admin)\`, \`Security(require_admin)\`, or any Depends/
     Security whose function name contains "admin" or "superuser" as a
     substring; Flask \`@admin_required\`. An inline admin check in the body
     also gates: \`if not current_user.is_superuser: raise HTTPException(
     status_code=403)\`, \`if current_user.role != "admin": ...\`, or an
     explicit RBAC lookup before the privileged action.
   - A PLAIN authentication dependency is NOT sufficient for admin-check:
     \`Depends(get_current_user)\`, \`Depends(get_current_active_user)\`, a
     \`current_user: CurrentUser\` annotated-alias, or any auth-only
     dependency authenticates but does NOT authorize admin. An admin
     operation guarded ONLY by a plain-auth dependency, with no admin/
     superuser substring in the dependency name and no inline admin/
     superuser/role check in the body, is admin-gate-vulnerable — any
     authenticated (non-admin) user can perform the admin action.
   - NON-auth dependencies (\`Depends(get_db)\`, \`Depends(get_session)\`,
     \`Depends(get_settings)\`) do not gate at all.
   - What the dependency function actually does, and router-level
     \`dependencies=[...]\` declared where the APIRouter is created in
     another file, are cross-file and OUT OF SCOPE this slice — judge by
     the dependency NAME convention, exactly like the App Router HOC rule.
6. Missing-admin-gate on Flask: a route decorated with
   \`@app.route(..., methods=[...])\` or the \`@app.get\`/\`@app.post\`
   shorthand, in a file whose imports show Flask, performing an
   ADMINISTRATIVE action that is not admin-gated.
   - Treat as GATED (NOT vulnerable) when decorated with \`@admin_required\`
     or any decorator whose name contains "admin" as a substring, OR the
     body contains an inline admin check: \`if not current_user.is_admin:
     abort(403)\`, \`if current_user.role != "admin": ...\`, \`if not
     g.user.is_admin: ...\`, or an explicit RBAC lookup before the action.
   - \`@login_required\` (flask_login) is NOT sufficient for admin-check —
     it authenticates but does not authorize admin. An admin operation
     guarded ONLY by \`@login_required\` (or a plain auth decorator), with
     no \`@admin_required\` and no inline is_admin/role check, is
     admin-gate-vulnerable: any authenticated non-admin user can perform
     the admin action. This is the Flask looks-guarding-but-isn't case.
   - A custom decorator whose admin behavior is defined in another module
     is cross-file and OUT OF SCOPE — judge by decorator NAME convention.

Set confidence:
- HIGH: Hardcoded-admin shape with no DB or signed-claim verification in
  production runtime code. Missing-admin-gate: route is unambiguously
  administrative (role/tier change, user delete/promote, admin panel,
  billing settings) AND sibling routes on the same router are admin-
  gated AND there is no admin authorization signal in the handler body.
  Missing-admin-HOC-wrapper: unambiguously-administrative App Router
  handler, no admin-suggesting HOC, no inline admin check in the body.
- MEDIUM: Hybrid check (string match AS PRIMARY but DB verification
  later), partial RBAC with hardcoded fallback, or missing-admin-gate
  where the route's privileged status is plausible but not certain.
  Same shape for missing-admin-HOC-wrapper when the wrapper name is
  generic (could plausibly enforce admin) or when the action is
  privileged but not unambiguously administrative.
- LOW: RBAC clearly backed by DB lookup, server-signed JWT with issuer
  validation, RBAC middleware that consults user_roles/org_members
  tables, OR every route on the router is unguarded by design, OR the
  App Router handler is wrapped in an admin-suggesting HOC, OR the
  handler body contains an explicit admin-role check.

IMPORTANT:
- Only return findings with confidence "high" or "medium".
- Reject when role is read from a database table (user_roles, org_members,
  permissions) before granting access.
- Reject when role comes from a server-signed JWT with issuer verification.
- Reject when email match is used only to verify an invite token (grants
  member, not admin).
- Reject when hardcoded admins appear only in bootstrap/seed scripts (not
  runtime code).
- Reject when a dedicated RBAC middleware (verifyClaims, requireRole,
  requireAdmin, isAdmin) enforces the check before the route handler,
  whether passed as an argument to the route declaration or applied
  router-wide via router.use().
- For missing-admin-gate: reject when the route is unambiguously a
  non-admin read endpoint (e.g., GET on a public catalog, healthcheck)
  even if the rest of the router is admin-gated.
- For missing-admin-HOC-wrapper: a route is NOT vulnerable if it is
  wrapped in an admin-suggesting HOC by name convention, OR if the
  handler body contains an explicit admin-role check before the
  destructive action. \`withAuth\` alone is insufficient — admin
  authorization is a stricter check than authentication.
- A route is NOT vulnerable when a PROVEN parent-layout loader in the
  PARENT ROUTE GUARDS block performs a blocking ADMIN check that covers
  the READ concern that triggered review — the admin gate lives cross-file
  in the ancestor layout. A parent layout that only enforces
  authentication (not admin) does NOT clear an admin-check finding.
- For FastAPI: a route is NOT vulnerable if an admin-suggesting Depends/
  Security dependency (name contains "admin"/"superuser") is in the
  signature, OR the body contains an inline admin/superuser/role check. A
  plain-auth dependency (\`get_current_user\` / \`get_current_active_user\`
  / \`CurrentUser\`) is NOT sufficient — admin authorization is stricter
  than authentication.
- For Flask: a route is NOT vulnerable if decorated with \`@admin_required\`
  (or an admin-named decorator), OR the body has an inline
  \`current_user.is_admin\`/\`g.user.is_admin\`/role check. \`@login_required\`
  alone is NOT sufficient for admin-check. Attribute Flask vs FastAPI by
  the file's imports for the shared \`@app.get\`/\`@app.post\` shorthand.`;

/**
 * Short fingerprint of SYSTEM_PROMPT, computed once at module load.
 * Logged by the stability harness so calibration runs can be tied to
 * specific prompt versions. Bumps when SYSTEM_PROMPT changes; rule R7
 * (docs/detector-test-rules.md) governs the classification.
 */
export const SYSTEM_PROMPT_FINGERPRINT = createHash("sha256")
  .update(SYSTEM_PROMPT)
  .digest("hex")
  .slice(0, 12);

const REPORT_TOOL: Tool = {
  name: "report_admin_check_verdict",
  description:
    "Report the admin-check analysis verdict for the supplied code context.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: {
        type: "boolean",
        description: "True if this is a real admin-check vulnerability.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      reasoning: {
        type: "string",
        description: "1-2 sentences explaining your decision.",
      },
      suggestedFix: {
        type: "string",
        description:
          "1-2 sentences suggesting a fix; empty string if not vulnerable.",
      },
      vulnerableRoute: {
        type: "string",
        description:
          "The HTTP method and path of the SINGLE route your verdict concerns, copied verbatim from its decorator/definition (e.g. \"POST /users/{user_id}/role\"). Empty string if not a route-specific finding or not vulnerable.",
      },
    },
    required: ["isVulnerable", "confidence", "reasoning"],
  },
};

const EXT_TO_LANG: Record<string, SupportedLang> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "py",
  go: "go",
  rb: "rb",
  java: "java",
  kt: "kt",
};

function languageForPath(path: string): SupportedLang | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

function langDisplay(lang: SupportedLang): string {
  switch (lang) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rb":
      return "ruby";
    case "java":
      return "java";
    case "kt":
      return "kotlin";
  }
}

function countLinesBefore(content: string, idx: number): number {
  let count = 0;
  const stop = Math.min(idx, content.length);
  for (let i = 0; i < stop; i++) {
    if (content[i] === "\n") count++;
  }
  return count;
}

function extractContextWindow(content: string, lineNumber: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, lineNumber - 1 - 8);
  const end = Math.min(lines.length, lineNumber - 1 + 16);
  return lines.slice(start, end).join("\n");
}

function extractImports(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (
      /^(import|from\s+\S+\s+import|require\s*\(|const\s+\S+\s*=\s*require|package\s+\w+|@app\.|use\s+strict|"use\s+\w+")/.test(
        trimmed,
      ) ||
      /^[A-Z_].* = require\(/.test(trimmed) ||
      /^require(_relative)?\s+/.test(trimmed)
    ) {
      out.push(line);
    } else if (out.length > 0 && /^[a-z_$]/i.test(trimmed)) {
      break;
    }
  }
  return out.join("\n");
}

function buildUserMessage(params: {
  filePath: string;
  language: string;
  functionCode: string;
  imports: string;
  triggerPattern: string;
  lineNumber: number;
  routeGuard?: string | null;
}): string {
  const guardBlock = params.routeGuard
    ? `\nPARENT ROUTE GUARDS (cross-file):\n${params.routeGuard}\n`
    : "";
  return `CONTEXT:
File: ${params.filePath}
Language: ${params.language}
Function context:
\`\`\`${params.language}
${params.functionCode}
\`\`\`

Imports in file:
\`\`\`${params.language}
${params.imports}
\`\`\`
${guardBlock}
Pattern that triggered review: ${params.triggerPattern}
Triggered at line: ${params.lineNumber}

Analyze whether this is a real admin-check vulnerability. Consider:

1. Is admin granted purely by hardcoded email comparison, domain suffix
   matching, or string-based role check?
2. Is the role read from a database table (user_roles, org_members,
   permissions) before the check?
3. Does the role come from a server-signed JWT with issuer verification?
4. Is the email match used only to verify an invite token (grants member,
   not admin)?
5. Is a dedicated RBAC middleware (verifyClaims, requireRole, requireAdmin)
   applied before the route handler (passed as a route argument or via
   router.use())?
6. If the trigger is an Express route definition: is the route
   privileged/administrative (role-change, user delete/promote, billing
   settings, admin panel) AND missing an admin middleware argument AND
   missing any inline admin check in the handler body? Compare against
   sibling routes on the same router — if every other privileged sibling
   has an admin gate and only this one is missing, that is the
   missing-admin-gate vulnerability.

When the finding is a specific route (missing-admin-gate cases), set
\`vulnerableRoute\` to that route's HTTP method and path, copied verbatim from
its decorator/definition (e.g. "POST /users/{user_id}/role") — NOT a sibling
route you cite only for contrast.

Call the report_admin_check_verdict tool with your verdict.`;
}

export class AdminCheckDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Hardcoded Admin Check";
  readonly supports = ["admin_check_risk"] as const;
  readonly languages = SUPPORTED_LANGS;

  /**
   * When false (default), literal-tier pattern matches emit findings
   * directly using the pattern's hand-authored explanation. Judgment-tier
   * patterns stay on the LLM path regardless of this setting — they require
   * context discrimination the regex cannot provide. There are six of them:
   * `role_string_compare` plus the five route-def sentinels
   * (`express_route_def`, `app_router_route_def`, `remix_handler_def`,
   * `fastapi_route_def`, `flask_route_def`). The route-def five were added
   * after this comment first claimed `role_string_compare` was the only one.
   *
   * **Default flipped to false on Day 8** (2026-05-15): the LLM mode
   * quoted hardcoded internal emails, user IDs, and domain suffixes into
   * PR comment output (MEDIUM-risk leak per D8). Hand-authored explanations
   * close the leak path on literal-tier patterns. Judgment-tier patterns
   * keep LLM in the loop because the Day 4 cognitive negatives all match
   * `role_string_compare` — wholesale bypass would have produced 6 FPs.
   *
   * Resolution order: env var `FIXOR_ADMIN_CHECK_LLM_OPT_IN=true` wins
   * over constructor option (deployment override); env unset OR constructor
   * default → false (per-pattern bypass for literal-tier).
   */
  private readonly llmValidation: boolean;

  /** For test diagnostics; reset at the start of each `detect()` call. */
  public lastDiagnostics: FileDiagnostic[] = [];

  constructor(options: { llmValidation?: boolean } = {}) {
    const envValue = process.env.FIXOR_ADMIN_CHECK_LLM_OPT_IN;
    if (envValue !== undefined) {
      this.llmValidation = envValue === "true";
    } else {
      this.llmValidation = options.llmValidation ?? false;
    }
  }

  async detect(ctx: DetectorContext): Promise<NormalizedFinding[]> {
    this.lastDiagnostics = [];
    const findings: NormalizedFinding[] = [];

    for (const file of parseDiff(ctx.diff)) {
      const lang = languageForPath(file.path);
      if (!lang) {
        this.lastDiagnostics.push({
          file: file.path,
          preFilterReason: "unsupported language",
          triggerCount: 0,
          flagged: false,
        });
        continue;
      }

      if (this.shouldSkipPath(file.path)) {
        this.lastDiagnostics.push({
          file: file.path,
          preFilterReason: "path filter",
          triggerCount: 0,
          flagged: false,
        });
        continue;
      }

      if (this.hasServerOnlyMarker(file.content)) {
        this.lastDiagnostics.push({
          file: file.path,
          preFilterReason: "server-only marker",
          triggerCount: 0,
          flagged: false,
        });
        continue;
      }

      const sidecars = ctx.sidecarsByPath?.[file.path];
      const fileFindings = await this.analyzeFile(
        file.path,
        file.content,
        lang,
        sidecars,
      );
      // Real-file line translation; identity on synthetic diffs.
      findings.push(...remapFindingLines(fileFindings, file.lineMap));
    }

    return findings;
  }

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    return {
      findingId: deriveFindingId(finding),
      detectorId: DETECTOR_ID,
      findingType: "admin_check_risk",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode: finding.originalCode,
      explanation:
        finding.explanation ||
        "Hardcoded admin check detected. Replace the email/role string comparison with a database-backed RBAC lookup (user_roles or org_members table), or use a server-signed JWT claim with issuer verification.",
      confidence: finding.confidence,
      patchQuality: "low",
      patchWarnings: [
        "RBAC migration requires schema and policy decisions; no automated patch produced.",
      ],
    };
  }

  /** Public for test access; production callers should go through detect(). */
  async analyzeFile(
    filePath: string,
    content: string,
    lang: SupportedLang,
    sidecars?: Record<string, string>,
  ): Promise<NormalizedFinding[]> {
    const triggers = this.prefilterRegex(content, filePath);
    const diag: FileDiagnostic = {
      file: filePath,
      triggerCount: triggers.length,
      flagged: false,
    };

    if (triggers.length === 0) {
      diag.preFilterReason = "no regex match";
      this.lastDiagnostics.push(diag);
      return [];
    }

    const trigger = triggers[0]!;
    const matchedPattern = PREFILTER_PATTERNS.find(
      (p) => p.id === trigger.patternId,
    );

    // Per-pattern Option G bypass (Day 8): literal-tier patterns with
    // hand-authored explanations skip the LLM call. All six judgment-tier
    // patterns (role_string_compare plus the five route-def sentinels) stay
    // on the LLM path regardless of llmValidation, because the regex cannot
    // disambiguate bug vs safe usage. The route-def five were added after
    // this comment first claimed role_string_compare was the only one.
    // See D8 "Detector ≠ pattern set" in detector-test-rules.md.
    if (
      !this.llmValidation &&
      matchedPattern?.tier === "literal" &&
      matchedPattern.explanation
    ) {
      diag.verdict = {
        isVulnerable: true,
        confidence: "high",
        reasoning: matchedPattern.explanation,
      };
      diag.flagged = true;
      diag.preFilterReason = "llm-bypass";
      this.lastDiagnostics.push(diag);

      const bypassSnippet = extractReportSnippet(content, trigger.line);
      return [
        {
          detectorId: DETECTOR_ID,
          type: "admin_check_risk",
          file: filePath,
          startLine: trigger.line,
          endLine: trigger.line,
          originalCode: bypassSnippet,
          ruleId: `admin-check-${trigger.patternId}`,
          message: matchedPattern.explanation,
          explanation: matchedPattern.explanation,
          confidence: "high",
          severity: "critical",
        },
      ];
    }

    // For the missing-admin-gate case (route-def trigger) we MUST show
    // the whole file: the LLM's verdict depends on whether sibling
    // routes on the same router are admin-gated. Mirrors the Phase 1
    // auth-bypass behavior. The size cap (200 KB) falls back to the
    // window for pathologically large files. See
    // detectors/shared/route-def-pattern.ts.
    const isRouteDefTrigger =
      trigger.patternId === "express_route_def" ||
      trigger.patternId === "app_router_route_def" ||
      trigger.patternId === "remix_handler_def" ||
      trigger.patternId === "fastapi_route_def" ||
      trigger.patternId === "flask_route_def";
    const functionCode = buildFunctionCodePayload({
      content,
      anchorLine: trigger.line,
      isRouteDefTrigger,
    });

    // Cross-file parent-layout admin guard (Phase G): only for route-def
    // triggers, where a missing in-file admin check may be a false positive
    // gated by an ancestor layout loader's admin check.
    const routeGuard = isRouteDefTrigger
      ? sidecars?.[SIDECAR_KINDS.ROUTE_GUARD]
      : undefined;

    const verdict = await this.callLlm({
      filePath,
      language: langDisplay(lang),
      functionCode,
      imports: extractImports(content),
      triggerPattern: trigger.patternText,
      lineNumber: trigger.line,
      routeGuard,
    });
    diag.verdict = verdict;

    if (!verdict || !verdict.isVulnerable) {
      this.lastDiagnostics.push(diag);
      return [];
    }
    if (verdict.confidence === "low") {
      this.lastDiagnostics.push(diag);
      return [];
    }
    // The confidence the FINDING carries. A HIGH verdict, and a MEDIUM that
    // escalation promoted, emit as "high". An unescalated MEDIUM now emits as
    // "medium" instead of being discarded — the emit-policy decision of
    // 2026-08-07. Severity is unchanged: it answers "how bad if real", while
    // confidence answers "is it real", and only the latter is in doubt here.
    let emitConfidence: "high" | "medium" = "high";

    if (verdict.confidence === "medium") {
      // H8: route the MEDIUM through the shared verdict-layer escalation.
      // Flag OFF (default) → resolveMediumVerdict returns "review-queue"
      // synchronously (no call), so this branch behaves exactly as before.
      const escalation = await resolveMediumVerdict({
        detectorId: DETECTOR_ID,
        findingType: "admin_check_risk",
        filePath,
        candidateLine: trigger.line,
        originalReasoning: verdict.reasoning,
        wholeFileContent: content,
      });
      if (escalation === "drop") {
        // Escalation ADJUDICATED it clear. Reachable only with the flag ON; an
        // explicit clear still drops silently, like LOW. This is the one path
        // that still discards a MEDIUM, and it does so on a positive decision
        // rather than on the absence of one.
        this.lastDiagnostics.push(diag);
        return [];
      }
      if (escalation !== "emit-high") {
        // "review-queue". With escalation OFF — the shipped configuration —
        // this is EVERY naturally arising MEDIUM. It used to return [] and
        // write a log line nothing consumed. It now emits, at the model's own
        // confidence, so the customer sees both the finding and the doubt.
        emitConfidence = "medium";
        logger.warn(
          {
            category: "admin-check-medium-emitted",
            file: filePath,
            line: trigger.line,
            pattern: trigger.patternText,
            reasoning: verdict.reasoning,
          },
          "admin-check: medium-confidence verdict emitted at MEDIUM confidence",
        );
      } else {
        logger.warn(
          {
            category: "admin-check-escalation-promoted",
            file: filePath,
            line: trigger.line,
            pattern: trigger.patternText,
            reasoning: verdict.reasoning,
          },
          "admin-check: medium-confidence verdict promoted to HIGH by escalation",
        );
      }
    }

    diag.flagged = true;
    this.lastDiagnostics.push(diag);

    // Anchor the finding at the route the verdict actually concerns (not the
    // first route in the file, which on a multi-route file is often a safe
    // sibling). Falls back to trigger.line when the LLM reports no route or
    // the signature does not match a route definition. See resolveRouteAnchorLine.
    const anchorLine = resolveRouteAnchorLine(
      content,
      verdict.vulnerableRoute,
      trigger.line,
    );
    const snippet = extractReportSnippet(content, anchorLine);
    return [
      {
        detectorId: DETECTOR_ID,
        type: "admin_check_risk",
        file: filePath,
        startLine: anchorLine,
        endLine: anchorLine,
        originalCode: snippet,
        ruleId: `admin-check-${trigger.patternId}`,
        message: verdict.reasoning,
        explanation: verdict.reasoning,
        confidence: emitConfidence,
        severity: "critical",
      },
    ];
  }

  private shouldSkipPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    return SKIP_PATH_RE.test(normalized);
  }

  private hasServerOnlyMarker(content: string): boolean {
    return SERVER_ONLY_RE.test(content);
  }

  private prefilterRegex(content: string, filePath: string): PrefilterHit[] {
    // Full-content scan (multi-line aware) — Phase 5a fix.
    //
    // Phase E (2026-05-23): the `remix_handler_def` pattern is gated by
    // isRemixRoutePath because `export const loader` is also a Remix
    // data-fetch utility convention. A path-filtered match is not
    // considered earliest — other patterns get a chance.
    let earliest: { idx: number; patternId: string } | null = null;
    for (const p of PREFILTER_PATTERNS) {
      const m = p.re.exec(content);
      if (!m || m.index === undefined) continue;
      if (p.id === "remix_handler_def" && !isRemixRoutePath(filePath)) {
        continue;
      }
      // Python slice 1b (2026-05-28): lang-gate the route-def prefilters
      // so JS/TS and Python shapes never cross-fire. Content/hardcoded-
      // admin patterns stay cross-language (no gate).
      if (
        (p.id === "fastapi_route_def" || p.id === "flask_route_def") &&
        !isPythonPath(filePath)
      ) {
        continue;
      }
      if (
        (p.id === "express_route_def" ||
          p.id === "app_router_route_def" ||
          p.id === "remix_handler_def") &&
        isPythonPath(filePath)
      ) {
        continue;
      }
      if (earliest === null || m.index < earliest.idx) {
        earliest = { idx: m.index, patternId: p.id };
      }
    }
    if (!earliest) return [];

    const lineNumber = countLinesBefore(content, earliest.idx) + 1;
    const lines = content.split(/\r?\n/);
    const lineText = lines[lineNumber - 1] ?? "";
    return [
      {
        patternId: earliest.patternId,
        patternText: lineText.trim(),
        line: lineNumber,
      },
    ];
  }

  private async callLlm(params: {
    filePath: string;
    language: string;
    functionCode: string;
    imports: string;
    triggerPattern: string;
    lineNumber: number;
    routeGuard?: string | null;
  }): Promise<LlmVerdict | null> {
    const result = await callClaude({
      callerId: DETECTOR_ID,
      model: CLAUDE_MODELS.DETECTION,
      system: cachedSystem(SYSTEM_PROMPT),
      tool: REPORT_TOOL,
      temperature: 0,
      messages: [{ role: "user", content: buildUserMessage(params) }],
    });

    if (!result.ok) {
      logger.warn(
        { reason: result.reason, file: params.filePath },
        "admin-check: LLM call failed",
      );
      return null;
    }

    const input = result.toolInput as
      | {
          isVulnerable?: boolean;
          confidence?: string;
          reasoning?: string;
          suggestedFix?: string | null;
          vulnerableRoute?: string | null;
        }
      | undefined;
    if (
      !input ||
      typeof input.isVulnerable !== "boolean" ||
      typeof input.confidence !== "string" ||
      typeof input.reasoning !== "string"
    ) {
      logger.warn(
        { file: params.filePath, input },
        "admin-check: malformed verdict",
      );
      return null;
    }
    const conf = input.confidence.toLowerCase();
    if (conf !== "high" && conf !== "medium" && conf !== "low") {
      return null;
    }
    return {
      isVulnerable: input.isVulnerable,
      confidence: conf as LlmVerdict["confidence"],
      reasoning: input.reasoning,
      suggestedFix: input.suggestedFix ?? null,
      vulnerableRoute:
        typeof input.vulnerableRoute === "string"
          ? input.vulnerableRoute
          : null,
    };
  }
}
