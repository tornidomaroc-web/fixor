import type {
  NormalizedSqlInjectionFinding,
  PatchQuality,
  SqlDialect,
  SqlInjectionFixSuggestion,
} from "../types/vulnerability.types";
import {
  ANTHROPIC_API_VERSION,
  CLAUDE_MODELS,
  MODEL_DEFAULTS,
} from "../config/models";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = CLAUDE_MODELS.REASONING;
const LLM_TIMEOUT_MS = MODEL_DEFAULTS[CLAUDE_MODELS.REASONING].timeoutMs;

function buildAnthropicUserPrompt(
  finding: NormalizedSqlInjectionFinding,
  dialect: SqlDialect
): string {
  return [
    "You are fixing a SQL injection vulnerability in a Node.js application.",
    `SQL dialect for placeholders: ${dialect} (use ? for mysql, $1 $2 ... for postgres as appropriate).`,
    "",
    "Original vulnerable code:",
    finding.originalCode,
    "",
    "Return ONLY the fixed code as a single code snippet.",
    "Do not add explanation, markdown fences, backticks, or commentary.",
  ].join("\n");
}

function extractAssistantTextFromAnthropic(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const o = block as { type?: unknown; text?: unknown };
      if (o.type === "text" && typeof o.text === "string") {
        parts.push(o.text);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function stripMarkdownFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines.length >= 2) {
      lines.shift();
      if (lines.length && lines[lines.length - 1].trim() === "```") {
        lines.pop();
      }
      t = lines.join("\n").trim();
    }
  }
  return t;
}

/**
 * Async LLM fallback when regex-based rewrites do not apply.
 * On missing key, HTTP error, timeout, or parse failure, returns {@link fallbackSuggestion}.
 */
export async function llmFallbackSuggestion(
  finding: NormalizedSqlInjectionFinding,
  dialect: SqlDialect
): Promise<SqlInjectionFixSuggestion> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return fallbackSuggestion(finding, dialect);
  }

  try {
    const prompt = buildAnthropicUserPrompt(finding, dialect);
    const signal =
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(LLM_TIMEOUT_MS)
        : undefined;

    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MODEL_DEFAULTS[CLAUDE_MODELS.REASONING].maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });

    const rawBody = await res.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      return fallbackSuggestion(finding, dialect);
    }

    if (!res.ok) {
      return fallbackSuggestion(finding, dialect);
    }

    const extracted = extractAssistantTextFromAnthropic(parsed);
    if (!extracted?.trim()) {
      return fallbackSuggestion(finding, dialect);
    }

    const fixedCode = stripMarkdownFences(extracted);
    if (!fixedCode) {
      return fallbackSuggestion(finding, dialect);
    }

    return {
      type: "SQL_INJECTION",
      file: finding.file,
      line: finding.startLine,
      originalCode: finding.originalCode,
      fixedCode,
      parameterValues: [],
      dialect,
      explanation:
        "Claude-generated fix suggestion. Verify against your driver, schema, and parameters before applying.",
      confidence: "medium",
      patchQuality: "medium",
      patchWarnings: [
        "LLM-generated code; review for correctness and alignment with your query API.",
      ],
    };
  } catch {
    return fallbackSuggestion(finding, dialect);
  }
}

const SQLISH =
  /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|INTO|VALUES|SET)\b/i;

function placeholderForIndex(dialect: SqlDialect, index: number): string {
  return dialect === "postgres" ? `$${index}` : "?";
}

const PAT_SINGLE_TRIPLET =
  /('(?:[^'\\]|\\.)*')\s*\+\s*([^+]+?)\s*\+\s*('(?:[^'\\]|\\.)*')/g;
const PAT_DOUBLE_TRIPLET =
  /("(?:[^"\\]|\\.)*")\s*\+\s*([^+]+?)\s*\+\s*("(?:[^"\\]|\\.)*")/g;

/** Binary: `"…SQL…" + expr` or `'…SQL…' + expr` before delimiter. */
const PAT_SINGLE_BINARY =
  /('(?:[^'\\]|\\.)*')\s*\+\s*([a-zA-Z_$][\w$.\[\]]*)/g;
const PAT_DOUBLE_BINARY =
  /("(?:[^"\\]|\\.)*")\s*\+\s*([a-zA-Z_$][\w$.\[\]]*)/g;

function isQuotedStringLiteral(middle: string, openQuote: string): boolean {
  if (openQuote === "'") return /^'(?:[^'\\]|\\.)*'$/.test(middle.trim());
  return /^"(?:[^"\\]|\\.)*"$/.test(middle.trim());
}

type TripletPhaseResult = {
  working: string;
  params: string[];
  count: number;
  nextPh: number;
};

function rewriteTripletsPhase(
  working: string,
  pattern: RegExp,
  dialect: SqlDialect,
  startPh: number
): TripletPhaseResult {
  pattern.lastIndex = 0;
  const params: string[] = [];
  let phIndex = startPh;
  let count = 0;
  let w = working;
  let guard = 0;
  let searchFrom = 0;

  while (guard++ < 64) {
    pattern.lastIndex = searchFrom;
    const match = pattern.exec(w);
    if (!match) break;

    const open = match[1][0];
    const middle = match[2].trim();
    if (isQuotedStringLiteral(middle, open)) {
      searchFrom = match.index + 1;
      continue;
    }

    const segment = `${match[1]} + ${match[2]} + ${match[3]}`;
    if (!w.includes(segment)) break;

    const ph = placeholderForIndex(dialect, phIndex);
    const replacement = `${match[1].slice(0, -1)}${ph}${match[3].slice(1)}`;
    w = w.replace(segment, replacement);
    params.push(middle);
    count++;
    phIndex++;
    searchFrom = 0;
  }

  pattern.lastIndex = 0;
  return { working: w, params, count, nextPh: phIndex };
}

type BinaryPhaseResult = {
  working: string;
  params: string[];
  count: number;
  nextPh: number;
};

function rewriteBinaryPhase(
  working: string,
  pattern: RegExp,
  dialect: SqlDialect,
  startPh: number
): BinaryPhaseResult {
  pattern.lastIndex = 0;
  const params: string[] = [];
  let phIndex = startPh;
  let count = 0;
  let w = working;
  let guard = 0;
  let searchFrom = 0;

  while (guard++ < 64) {
    pattern.lastIndex = searchFrom;
    const match = pattern.exec(w);
    if (!match) break;

    const strLit = match[1];
    const expr = match[2];
    if (!SQLISH.test(strLit)) {
      searchFrom = match.index + 1;
      continue;
    }

    const segment = `${strLit} + ${expr}`;
    if (!w.includes(segment)) break;

    const ph = placeholderForIndex(dialect, phIndex);
    const replacement = `${strLit.slice(0, -1)}${ph}${strLit.slice(-1)}`;
    w = w.replace(segment, replacement);
    params.push(expr);
    count++;
    phIndex++;
    searchFrom = 0;
  }

  pattern.lastIndex = 0;
  return { working: w, params, count, nextPh: phIndex };
}

type ConcatRewrite = {
  fixedCode: string;
  parameterValues: string[];
  confidence: "high" | "medium";
};

function tryRewriteConcatenation(
  code: string,
  dialect: SqlDialect
): ConcatRewrite | null {
  const trimmed = code.trim();
  if (!SQLISH.test(trimmed) || !trimmed.includes("+")) return null;

  let working = trimmed;
  const parameterValues: string[] = [];
  let phIndex = 1;
  let total = 0;

  for (;;) {
    const before = working;
    const r1 = rewriteTripletsPhase(working, PAT_SINGLE_TRIPLET, dialect, phIndex);
    working = r1.working;
    parameterValues.push(...r1.params);
    phIndex = r1.nextPh;
    total += r1.count;

    const r2 = rewriteTripletsPhase(working, PAT_DOUBLE_TRIPLET, dialect, phIndex);
    working = r2.working;
    parameterValues.push(...r2.params);
    phIndex = r2.nextPh;
    total += r2.count;

    if (working === before) break;
  }

  const b1 = rewriteBinaryPhase(working, PAT_SINGLE_BINARY, dialect, phIndex);
  working = b1.working;
  parameterValues.push(...b1.params);
  phIndex = b1.nextPh;
  total += b1.count;

  const b2 = rewriteBinaryPhase(working, PAT_DOUBLE_BINARY, dialect, phIndex);
  working = b2.working;
  parameterValues.push(...b2.params);
  total += b2.count;

  if (total === 0) return null;

  const confidence: "high" | "medium" =
    total >= 2 || /query\s*\(|\.query\s*\(/i.test(working)
      ? "high"
      : "medium";

  return {
    fixedCode: working.trim(),
    parameterValues,
    confidence,
  };
}

type TemplateRewrite = {
  fixedCode: string;
  parameterValues: string[];
  confidence: "high" | "medium";
};

function tryRewriteTemplateLiteral(
  code: string,
  dialect: SqlDialect
): TemplateRewrite | null {
  const trimmed = code.trim();
  if (!trimmed.includes("`") || !/\$\{[^}]+\}/.test(trimmed)) return null;
  if (!SQLISH.test(trimmed)) return null;

  const parameterValues: string[] = [];
  let index = 1;
  const fixed = trimmed.replace(/\$\{([^}]+)\}/g, (_, inner: string) => {
    const ph = placeholderForIndex(dialect, index);
    index++;
    parameterValues.push(inner.trim());
    return ph;
  });

  if (fixed === trimmed) return null;

  return {
    fixedCode: fixed.trim(),
    parameterValues,
    confidence: parameterValues.length >= 2 ? "high" : "medium",
  };
}

function countPlaceholders(fixedCode: string, dialect: SqlDialect): number {
  if (dialect === "postgres") {
    const m = fixedCode.match(/\$[1-9]\d*/g);
    return m ? m.length : 0;
  }
  const m = fixedCode.match(/\?/g);
  return m ? m.length : 0;
}

/**
 * True when a placeholder sits inside a SQL string literal (e.g. LIKE '%?%'),
 * not when `?` is the normal positional marker in the outer query string.
 */
function placeholderInsideSqlStringLiteral(fixedCode: string): boolean {
  if (/'%[^']*\?[^']*'/.test(fixedCode)) return true;
  if (/"%[^"]*\?[^"]*"/.test(fixedCode)) return true;
  if (/'%[^']*\$[1-9]\d*[^']*'/.test(fixedCode)) return true;
  if (/"%[^"]*\$[1-9]\d*[^"]*"/.test(fixedCode)) return true;
  if (/\bLIKE\s+(['"`])(?:(?!\1).)*\?(?:(?!\1).)*\1/i.test(fixedCode))
    return true;
  return false;
}

function residualRiskyConcat(fixedCode: string): boolean {
  return /['"]\s*\+\s*[^+]+\s*\+\s*['"]/.test(fixedCode);
}

function computePatchMeta(
  mode: "concat" | "template" | "fallback",
  _originalCode: string,
  fixedCode: string,
  parameterValues: string[],
  dialect: SqlDialect,
  fixConfidence: "high" | "medium" | "low"
): { patchQuality: PatchQuality; patchWarnings: string[] } {
  const warnings: string[] = [];

  if (mode === "fallback") {
    warnings.push(
      "Automatic rewrite failed; suggestion is illustrative—replace with your real SQL and bound parameters."
    );
    return { patchQuality: "low", patchWarnings: warnings };
  }

  const phCount = countPlaceholders(fixedCode, dialect);
  if (phCount > 0 && parameterValues.length > 0 && phCount !== parameterValues.length) {
    warnings.push(
      "Placeholder count does not match extracted parameter expressions; verify binding order manually."
    );
  }

  if (placeholderInsideSqlStringLiteral(fixedCode)) {
    warnings.push(
      "Placeholder sits inside a quoted SQL fragment (e.g. LIKE); bind the whole pattern as one parameter when needed."
    );
  }

  if (residualRiskyConcat(fixedCode)) {
    warnings.push(
      "Remaining string concatenation in suggested code; you may need to adjust the surrounding execution call."
    );
  }

  if (/\bLIKE\b/i.test(fixedCode) && mode === "template") {
    warnings.push(
      "LIKE patterns with embedded placeholders usually require binding the full search string as a single value."
    );
  }

  let patchQuality: PatchQuality = "high";

  if (fixConfidence === "low") {
    patchQuality = "low";
  } else if (warnings.length > 0) {
    patchQuality = "medium";
  } else if (mode === "template" && parameterValues.length === 1) {
    patchQuality = "medium";
  } else if (
    mode === "concat" &&
    phCount > 0 &&
    phCount === parameterValues.length
  ) {
    patchQuality = "high";
  } else if (mode === "concat") {
    patchQuality = "medium";
  } else if (mode === "template" && parameterValues.length >= 2) {
    patchQuality = "high";
  }

  return { patchQuality, patchWarnings: warnings };
}

/**
 * Infer dynamic expressions from concatenation / template snippets for fallback examples.
 */
function inferBoundExpressions(code: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (/^["'`]/.test(t)) return;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  const triS =
    /'(?:[^'\\]|\\.)*'\s*\+\s*([^+]+?)\s*\+\s*'(?:[^'\\]|\\.)*'/g;
  let m: RegExpExecArray | null;
  while ((m = triS.exec(code)) !== null) add(m[1]);

  const triD =
    /"(?:[^"\\]|\\.)*"\s*\+\s*([^+]+?)\s*\+\s*"(?:[^"\\]|\\.)*"/g;
  while ((m = triD.exec(code)) !== null) add(m[1]);

  const binS = /'(?:[^'\\]|\\.)*'\s*\+\s*([a-zA-Z_$][\w$.\[\]]*)/g;
  while ((m = binS.exec(code)) !== null) add(m[1]);

  const binD = /"(?:[^"\\]|\\.)*"\s*\+\s*([a-zA-Z_$][\w$.\[\]]*)/g;
  while ((m = binD.exec(code)) !== null) add(m[1]);

  const tmpl = /\$\{([^}]+)\}/g;
  while ((m = tmpl.exec(code)) !== null) add(m[1]);

  return out;
}

function fallbackSuggestion(
  finding: NormalizedSqlInjectionFinding,
  dialect: SqlDialect
): SqlInjectionFixSuggestion {
  const inferred = inferBoundExpressions(finding.originalCode);
  const ph = placeholderForIndex(dialect, 1);
  const bindList =
    inferred.length > 0 ? `[${inferred.join(", ")}]` : "/* values */ []";

  const fixedCode =
    dialect === "postgres"
      ? `await pool.query('SELECT * FROM users WHERE id = ${ph}', ${bindList});`
      : `await connection.query('SELECT * FROM users WHERE id = ?', ${bindList});`;

  const warnings: string[] = [
    "Automatic rewrite failed; suggestion shows placeholder shape only—substitute your real SQL and bind every user-controlled expression.",
  ];
  if (inferred.length === 0) {
    warnings.push(
      "Could not infer variable names from the snippet; fill the parameter array manually."
    );
  }

  return {
    type: "SQL_INJECTION",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode,
    parameterValues: inferred.slice(),
    dialect,
    explanation:
      "Avoid building SQL by concatenating or embedding user-controlled values in strings or template literals. " +
      "Use the driver's parameterized query API so values are sent separately from the SQL text.",
    confidence: "low",
    patchQuality: "low",
    patchWarnings: warnings,
  };
}

export interface SqlFixOptions {
  dialect?: SqlDialect;
}

function buildFix(
  finding: NormalizedSqlInjectionFinding,
  dialect: SqlDialect,
  fixedCode: string,
  parameterValues: string[],
  confidence: "high" | "medium" | "low",
  explanation: string,
  mode: "concat" | "template" | "fallback"
): SqlInjectionFixSuggestion {
  const { patchQuality, patchWarnings } = computePatchMeta(
    mode,
    finding.originalCode,
    fixedCode,
    parameterValues,
    dialect,
    confidence
  );
  return {
    type: "SQL_INJECTION",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode,
    parameterValues,
    dialect,
    explanation,
    confidence,
    patchQuality,
    patchWarnings,
  };
}

const RE_VERIFY_SQL_KW = /\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b/i;
const RE_VERIFY_SQL_CONCAT =
  /[`'"]\s*\+\s*\w+|\w+\s*\+\s*[`'"]/;
const RE_VERIFY_SQL_TEMPLATE = /`[^`]*\$\{[^}]+\}[^`]*`/;

function verifyFixedCode(originalCode: string, fixedCode: string): {
  stillVulnerable: boolean;
  reason: string;
} {
  void originalCode;
  const hasSqlKw = RE_VERIFY_SQL_KW.test(fixedCode);
  if (hasSqlKw && RE_VERIFY_SQL_CONCAT.test(fixedCode)) {
    return {
      stillVulnerable: true,
      reason: "Fixed code still contains string concatenation",
    };
  }
  if (hasSqlKw && RE_VERIFY_SQL_TEMPLATE.test(fixedCode)) {
    return {
      stillVulnerable: true,
      reason: "Fixed code still contains template literal interpolation",
    };
  }
  return { stillVulnerable: false, reason: "" };
}

/**
 * Produces a Node.js-oriented fix suggestion for one normalized SQL injection finding.
 */
export async function generateSqlInjectionFix(
  finding: NormalizedSqlInjectionFinding,
  options?: SqlFixOptions
): Promise<SqlInjectionFixSuggestion> {
  const dialect: SqlDialect = options?.dialect ?? "mysql";
  const code = finding.originalCode.trim();

  const finalize = (result: SqlInjectionFixSuggestion) => {
    const verification = verifyFixedCode(finding.originalCode, result.fixedCode);
    if (verification.stillVulnerable) {
      result.confidence = "low";
      result.patchQuality = "low";
      result.patchWarnings = [
        ...result.patchWarnings,
        `Static check: ${verification.reason}`,
      ];
    }
    return result;
  };

  if (code.length > 0) {
    const concat = tryRewriteConcatenation(code, dialect);
    if (concat) {
      return finalize(
        buildFix(
          finding,
          dialect,
          concat.fixedCode,
          concat.parameterValues,
          concat.confidence,
          "Replaced dynamic string concatenation with placeholders. " +
            "Pass `parameterValues` in order as the driver's bound-parameter array (second argument to query).",
          "concat"
        )
      );
    }

    const tmpl = tryRewriteTemplateLiteral(code, dialect);
    if (tmpl) {
      return finalize(
        buildFix(
          finding,
          dialect,
          tmpl.fixedCode,
          tmpl.parameterValues,
          tmpl.confidence,
          "Replaced template literal interpolations with placeholders. " +
            "Bind `parameterValues` in order instead of embedding expressions in the SQL string.",
          "template"
        )
      );
    }
  }

  return finalize(await llmFallbackSuggestion(finding, dialect));
}
