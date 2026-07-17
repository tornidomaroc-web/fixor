/**
 * SHADOW of the idor prefilter + pairing stage, for corpus-scale counting.
 *
 * WHY A SHADOW AT ALL. Driving the real `analyzeFile` over 13 repos would throw
 * ReplayFixtureMissing on every file that reaches the model, which is fine, but
 * it is minutes of subprocess time to answer a question that is pure regex
 * arithmetic. The shadow answers it in one pass. The price is that a shadow can
 * DRIFT from the detector it copies, and a drifted shadow reports confident
 * nonsense.
 *
 * SO THE SHADOW IS NOT TRUSTED — IT IS VALIDATED. `validateShadow` (called by
 * the rig BEFORE any corpus count is emitted) drives a sample of real corpus
 * files through the real detector under the zero-spend lock, harvests the REAL
 * candidate block, and requires the shadow to predict it pair-for-pair: same
 * count, same source line, same sink line, same order. A single mismatch fails
 * the run and no count is reported.
 *
 * A NOTE ON WHAT "shadow == real" CAN MEAN. The harvested block shows only the
 * NEAREST source per sink, not every source hit. So the shadow cannot be
 * validated by comparing a raw source-hit count to the block — those are
 * different quantities. What CAN be compared, and what is compared here, is the
 * PAIRS: the block is the detector's own pairing output, and the shadow
 * reproduces the whole path (patterns -> hits -> pairs) that produced it.
 * Matching pairs exercises both copied regex arrays and the copied pairing
 * logic, because a wrong source pattern moves a source line and a wrong sink
 * pattern moves or deletes a pair.
 *
 * EVERYTHING BELOW IS COPIED VERBATIM FROM idor.detector.ts (the line refs are
 * the source of truth). Do not "improve" it: any divergence is a bug, and
 * `validateShadow` is what catches it.
 */

/** VERBATIM: idor.detector.ts:204-205 */
const SKIP_PATH_RE =
  /(^|\/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(\/|$)/i;

/** VERBATIM: idor.detector.ts:207 */
const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

/** VERBATIM: idor.detector.ts:215 */
const PROXIMITY_THRESHOLD = 200;

/** VERBATIM: idor.detector.ts:222 */
const MAX_PAIRS_PER_FILE = 12;

export type ShadowLang =
  | "js" | "jsx" | "ts" | "tsx" | "py" | "go" | "rb" | "java" | "kt";

interface ShadowPattern {
  id: string;
  re: RegExp;
  lang?: ShadowLang[];
}

/** VERBATIM: idor.detector.ts:112-166 */
export const SHADOW_SOURCE_PATTERNS: ShadowPattern[] = [
  { id: "express_params",          re: /\breq\.params\.\w+/ },
  { id: "express_query",           re: /\breq\.query\.\w+/ },
  { id: "express_body_id",         re: /\breq\.body\.\w*[iI]d\b/ },
  { id: "koa_ctx_params",          re: /\bctx\.params\.\w+/ },
  { id: "hono_param",              re: /\bc\.req\.param\s*\(/ },
  { id: "nestjs_param",            re: /@Param\s*\(\s*['"][^'"]+['"]\s*\)/ },
  { id: "nextjs_destructured",     re: /\bparams\s*:\s*(?:Promise\s*<\s*)?\{\s*\w+\s*:\s*string/ },
  { id: "trpc_input_access",       re: /\binput\.\w+/ },
  { id: "fastapi_path_params",     re: /\brequest\.path_params\[/ },
  { id: "fastapi_path_params_alt", re: /\bpath_params\s*\[\s*['"]/ },
  {
    id: "fastapi_typed_path_param",
    re: /\bdef\s+\w+\s*\([^)]*?\b(?:id|[A-Za-z0-9]+_id|[a-z0-9]+Id)\s*:\s*(?:int|str|float|UUID|uuid\.UUID)\b/,
    lang: ["py"],
  },
  { id: "django_kwargs_id",        re: /\bkwargs\.get\s*\(\s*['"]\w*id/i },
  { id: "django_request_get",      re: /\brequest\.GET\.get\s*\(\s*['"]\w*id/i },
  { id: "rails_params_sym",        re: /\bparams\[:\w+\]/ },
  { id: "lambda_path_params",      re: /\bevent\.pathParameters\b/ },
  { id: "go_chi_urlparam",         re: /\bchi\.URLParam\s*\(/ },
  { id: "go_mux_vars",             re: /\bmux\.Vars\s*\(/ },
];

/** VERBATIM: idor.detector.ts:173-202 */
export const SHADOW_SINK_PATTERNS: ShadowPattern[] = [
  { id: "prisma_find_unique",      re: /\.findUnique\s*\(/ },
  { id: "prisma_find_first",       re: /\.findFirst\s*\(/ },
  { id: "orm_find_one",            re: /\.findOne\s*\(/ },
  { id: "orm_find_by_id",          re: /\.findById\s*\(/ },
  { id: "sequelize_find_by_pk",    re: /\.findByPk\s*\(/ },
  { id: "sqlalchemy_query_get",    re: /\.query\.get\s*\(/ },
  { id: "sqlalchemy_filter_by_id", re: /\.filter_by\s*\(\s*\w*id\s*=/ },
  { id: "sqlalchemy_session_get",  re: /\b(?:session|db)\.get\s*\(\s*[A-Z]\w*/, lang: ["py"] },
  { id: "django_objects_get",      re: /\.objects\.get\s*\(/ },
  { id: "django_objects_filter",   re: /\.objects\.filter\s*\(\s*\w*id\s*=/ },
  { id: "rails_find_by",           re: /\.find_by\s*\(/ },
  { id: "rails_class_find",        re: /\b[A-Z]\w*\.find\s*\(/, lang: ["rb"] },
  { id: "node_pg_query",           re: /\b(?:pool|client|db)\.query\s*\(/ },
  { id: "go_db_queryrow",          re: /\b(?:db|tx)\.(?:QueryRow|Query|Exec)(?:Context)?\s*\(/ },
  { id: "raw_sql_where_id",        re: /\bSELECT\b[\s\S]{0,200}?\bWHERE\s+\w*[iI][dD]\s*=/i },
];

/** VERBATIM: idor.detector.ts:446-458 */
const EXT_TO_LANG: Record<string, ShadowLang> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  py: "py", go: "go", rb: "rb", java: "java", kt: "kt",
};

/** VERBATIM: idor.detector.ts:460-465 */
export function shadowLanguageForPath(path: string): ShadowLang | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

/** VERBATIM: idor.detector.ts:982-985 */
export function shadowShouldSkipPath(filePath: string): boolean {
  return SKIP_PATH_RE.test(filePath.replace(/\\/g, "/"));
}

/** VERBATIM: idor.detector.ts:987-989 */
export function shadowHasServerOnlyMarker(content: string): boolean {
  return SERVER_ONLY_RE.test(content);
}

export interface ShadowHit {
  patternId: string;
  patternText: string;
  line: number;
}

/** VERBATIM: idor.detector.ts:487-494 */
function countLinesBefore(content: string, idx: number): number {
  let count = 0;
  const stop = Math.min(idx, content.length);
  for (let i = 0; i < stop; i++) if (content[i] === "\n") count++;
  return count;
}

/** VERBATIM: idor.detector.ts:500-523 */
export function shadowFindPatternHits(
  content: string,
  patterns: ShadowPattern[],
  lang: ShadowLang,
): ShadowHit[] {
  const lines = content.split(/\r?\n/);
  const hits: ShadowHit[] = [];
  for (const p of patterns) {
    if (p.lang && !p.lang.includes(lang)) continue;
    const flags = p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g";
    const globalRe = new RegExp(p.re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(content)) !== null) {
      if (m.index === undefined) break;
      const line = countLinesBefore(content, m.index) + 1;
      const lineText = lines[line - 1] ?? "";
      hits.push({ patternId: p.id, patternText: lineText.trim().slice(0, 200), line });
      if (m.index === globalRe.lastIndex) globalRe.lastIndex++;
    }
  }
  return hits;
}

export interface ShadowPair {
  source: ShadowHit;
  sink: ShadowHit;
  distance: number;
}

/** VERBATIM: idor.detector.ts:540-570 */
export function shadowEnumerateSinkPairs(
  sourceHits: ShadowHit[],
  sinkHits: ShadowHit[],
): { pairs: ShadowPair[]; truncated: number } {
  const pairs: ShadowPair[] = [];
  const seenSinkLines = new Set<number>();
  for (const sink of sinkHits) {
    if (seenSinkLines.has(sink.line)) continue;
    let best: ShadowHit | null = null;
    let bestDist = Infinity;
    for (const source of sourceHits) {
      const distance = Math.abs(source.line - sink.line);
      if (distance > PROXIMITY_THRESHOLD) continue;
      if (distance < bestDist) {
        bestDist = distance;
        best = source;
      }
    }
    if (best) {
      seenSinkLines.add(sink.line);
      pairs.push({ source: best, sink, distance: bestDist });
    }
  }
  pairs.sort((a, b) => a.sink.line - b.sink.line);
  let truncated = 0;
  if (pairs.length > MAX_PAIRS_PER_FILE) {
    truncated = pairs.length - MAX_PAIRS_PER_FILE;
    pairs.length = MAX_PAIRS_PER_FILE;
  }
  return { pairs, truncated };
}

/** Full shadow of the pre-model stage for one file. */
export function shadowAnalyze(
  path: string,
  content: string,
  lang: ShadowLang,
): { sourceHits: ShadowHit[]; sinkHits: ShadowHit[]; pairs: ShadowPair[]; reachesModel: boolean } {
  const sourceHits = shadowFindPatternHits(content, SHADOW_SOURCE_PATTERNS, lang);
  const sinkHits = shadowFindPatternHits(content, SHADOW_SINK_PATTERNS, lang);
  if (sourceHits.length === 0 || sinkHits.length === 0) {
    return { sourceHits, sinkHits, pairs: [], reachesModel: false };
  }
  const { pairs } = shadowEnumerateSinkPairs(sourceHits, sinkHits);
  return { sourceHits, sinkHits, pairs, reachesModel: pairs.length > 0 };
}
