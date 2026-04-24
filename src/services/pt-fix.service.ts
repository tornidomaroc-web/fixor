/**
 * Path-traversal fix generator — LLM-based rewrite that canonicalizes paths
 * and enforces a base-directory containment check before fs I/O.
 *
 * Detection is handled upstream by the central LLM analyzer; this service
 * is invoked only when PathTraversalDetector dispatches a finding of type
 * `path_traversal_risk`.
 */

import type {
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../analysis-engine/detector.types";
import { deriveFindingId } from "../analysis-engine/detector.types";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { cachedSystem, callClaude } from "../analysis-engine/anthropic-client";
import { CLAUDE_MODELS } from "../config/models";

const DETECTOR_ID = "path-traversal-js-ts";

const PT_FIX_SYSTEM_PROMPT = `You rewrite a single Node.js / TypeScript snippet
that risks path traversal into a safe pattern.

Rules
- For fs.readFile / writeFile / appendFile / createReadStream / promises
  variants / *Sync forms that take a user-controlled path:
  1. const resolved = path.resolve(BASE_DIR, userInput);
  2. if (!resolved.startsWith(BASE_DIR + path.sep)) { throw new Error("path outside base"); }
     (or return 403 in Express handlers)
  3. Then call fs.* on \`resolved\`.
- For Express res.sendFile: use the \`root\` option, e.g.
  res.sendFile(name, { root: BASE_DIR }).
- Never pass path.join(base, userInput) straight to fs without first
  resolving and verifying containment under BASE_DIR.
- Preserve async/await vs callback style.
- Return only the rewritten code via the emit_pt_fix tool. No prose,
  no markdown fences, no commentary.`;

const EMIT_PT_FIX_TOOL: Tool = {
  name: "emit_pt_fix",
  description:
    "Emit the rewritten safe code, chosen base directory constant, and containment flag.",
  input_schema: {
    type: "object",
    properties: {
      fixed_code: {
        type: "string",
        description:
          "The rewritten safe code snippet (no markdown fences, no commentary).",
      },
      base_dir: {
        type: "string",
        description:
          "Identifier for the safe root directory (e.g. BASE_DIR, __dirname + '/data').",
      },
      containment_check_applied: {
        type: "boolean",
        description:
          "True when the fix adds path.resolve plus startsWith (or sendFile root:) containment.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "'high' when resolve+startsWith or sendFile root is clearly present; 'low' when ambiguous.",
      },
    },
    required: [
      "fixed_code",
      "base_dir",
      "containment_check_applied",
      "confidence",
    ],
  },
};

function buildUserPrompt(finding: NormalizedFinding): string {
  return [
    `Vulnerable snippet (as-is from the repo, ${finding.file}:${finding.startLine}):`,
    finding.originalCode,
    "",
    "Rewrite it safely and call emit_pt_fix with the result.",
  ].join("\n");
}

export function fallbackSuggestion(
  finding: NormalizedFinding
): NormalizedFixSuggestion {
  return {
    findingId: deriveFindingId(finding),
    detectorId: DETECTOR_ID,
    findingType: "path_traversal_risk",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode:
      "// Auto-rewrite unavailable. Apply canonicalization + containment — example:\n" +
      "// const resolved = path.resolve(BASE_DIR, userInput);\n" +
      "// if (!resolved.startsWith(BASE_DIR + path.sep)) throw new Error('invalid path');\n" +
      "// await fs.promises.readFile(resolved, 'utf8');",
    explanation:
      "LLM rewrite unavailable. Resolve user segments under a fixed base directory and verify with startsWith before any fs access; for Express, prefer res.sendFile(name, { root: BASE_DIR }).",
    confidence: "low",
    patchQuality: "low",
    patchWarnings: [
      "Automatic rewrite failed; add path.resolve + startsWith containment (or sendFile root) manually.",
    ],
    metadata: {
      type: "path_traversal_risk",
    },
  };
}

export function coerceConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

export function coerceBaseDir(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}

export function coerceContainmentApplied(raw: unknown): boolean {
  return raw === true;
}

/**
 * Static check for obvious traversal surfaces left in the rewrite.
 * Uses bounded, line-oriented patterns — avoids wide negated char classes
 * that catastrophically backtrack on whitespace-heavy inputs.
 */
export function residualPtRisk(fixedCode: string): string | null {
  const hasResolve = /\bpath\.resolve\b/.test(fixedCode);
  const hasStartsWith = /\.startsWith\s*\(/.test(fixedCode);
  const hasSendFileRoot = /\bres\.sendFile\s*\([^)]*\broot\s*:/.test(
    fixedCode
  );
  const containmentOk =
    (hasResolve && hasStartsWith) || hasSendFileRoot;

  if (
    /\bfs\.(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream|promises\.readFile|promises\.writeFile)\s*\(\s*req\./.test(
      fixedCode
    )
  ) {
    return "Filesystem call still passes req.* directly as the path";
  }

  if (/\bpath\.join\s*\(\s*\w+\s*,\s*\w+/.test(fixedCode) && !containmentOk) {
    return "path.join with dynamic segments but no resolve+startsWith containment";
  }

  if (/\bfs\.(?:readFile|readFileSync)\s*\([^)]*\.\.[\/\\]/.test(fixedCode)) {
    return "Filesystem read still references a literal parent-directory segment";
  }

  if (/\bres\.sendFile\s*\(/.test(fixedCode) && !hasSendFileRoot) {
    return "res.sendFile without { root: ... } option";
  }

  if (
    /\bfs\.(?:readFile|readFileSync|writeFile|writeFileSync)\s*\(/.test(
      fixedCode
    ) &&
    !containmentOk
  ) {
    return "Filesystem call without path.resolve + startsWith or sendFile root guard";
  }

  return null;
}

/**
 * Produces a safe rewrite for one normalized path-traversal finding, or a
 * low-quality fallback when the LLM call fails.
 */
export async function generatePtFix(
  finding: NormalizedFinding
): Promise<NormalizedFixSuggestion> {
  const result = await callClaude({
    model: CLAUDE_MODELS.REASONING,
    system: cachedSystem(PT_FIX_SYSTEM_PROMPT),
    tool: EMIT_PT_FIX_TOOL,
    messages: [{ role: "user", content: buildUserPrompt(finding) }],
  });

  if (!result.ok) return fallbackSuggestion(finding);

  const input = result.toolInput as
    | {
        fixed_code?: unknown;
        base_dir?: unknown;
        containment_check_applied?: unknown;
        confidence?: unknown;
      }
    | undefined;

  const fixedCode =
    typeof input?.fixed_code === "string" ? input.fixed_code.trim() : "";
  if (!fixedCode) return fallbackSuggestion(finding);

  const baseDir = coerceBaseDir(input?.base_dir);
  const containmentApplied = coerceContainmentApplied(
    input?.containment_check_applied
  );
  const confidence = coerceConfidence(input?.confidence);

  const warnings: string[] = [];
  let patchQuality: "high" | "medium" | "low" =
    confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low";

  if (containmentApplied === false) {
    warnings.push(
      "Tool reported containment_check_applied=false; verify the path is constrained before merge."
    );
    patchQuality = "low";
  }

  const residual = residualPtRisk(fixedCode);
  if (residual) {
    warnings.push(`Static check: ${residual}`);
    patchQuality = "low";
  }

  warnings.push(
    "LLM-generated path traversal rewrite; verify BASE_DIR matches deployment layout and that normalization handles symlinks as intended."
  );

  return {
    findingId: deriveFindingId(finding),
    detectorId: DETECTOR_ID,
    findingType: "path_traversal_risk",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode,
    explanation:
      "Added canonical path resolution and a base-directory containment check (or sendFile root) before filesystem access.",
    confidence,
    patchQuality,
    patchWarnings: warnings,
    metadata: {
      type: "path_traversal_risk",
      ...(baseDir ? { baseDir } : {}),
    },
  };
}
