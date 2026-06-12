/**
 * Command-injection fix generator — LLM-based rewrite of shell-form
 * child_process usage into argv-array forms.
 *
 * Detection is handled upstream by the central LLM analyzer; this service
 * is invoked only when CommandInjectionDetector dispatches a finding of
 * type `command_injection_risk`.
 */

import type {
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../analysis-engine/detector.types";
import { deriveFindingId } from "../analysis-engine/detector.types";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { cachedSystem, callClaude } from "../analysis-engine/anthropic-client";
import { CLAUDE_MODELS } from "../config/models";

const DETECTOR_ID = "command-injection-js-ts";

/** Values returned by the `emit_cmdi_fix` tool (stored sink differs slightly). */
export type CmdiToolSink =
  | "exec"
  | "execSync"
  | "spawn-shell"
  | "spawnSync-shell"
  | "execFile"
  | "other";

const CMDI_FIX_SYSTEM_PROMPT = `You rewrite a single Node.js / TypeScript snippet
that risks OS command injection into a safe argv-array style.

Rules
- Replace shell-form \`child_process.exec(...)\` with argv-form
  \`execFile(cmd, [args])\` (or \`util.promisify(execFile)\` when the code
  uses async/await on exec).
- Replace \`spawn(cmd, { shell: true })\` with \`spawn(cmd, [args])\` (array
  form, no shell).
- Replace \`execSync\` with \`execFileSync\` and an argv array.
- Never concatenate user input into a shell command string. No
  \`bash -c "\${user}"\`-style patterns.
- Preserve callback vs Promise return shape (callback stays callback;
  promisified stays promisified).
- Return only the rewritten code via the emit_cmdi_fix tool. No prose,
  no markdown fences, no commentary.`;

const EMIT_CMDI_FIX_TOOL: Tool = {
  name: "emit_cmdi_fix",
  description:
    "Emit the rewritten safe code plus sink classification and argv-form flag.",
  input_schema: {
    type: "object",
    properties: {
      fixed_code: {
        type: "string",
        description:
          "The rewritten safe code snippet (no markdown fences, no commentary).",
      },
      sink: {
        type: "string",
        enum: [
          "exec",
          "execSync",
          "spawn-shell",
          "spawnSync-shell",
          "execFile",
          "other",
        ],
        description:
          "Primary vulnerable sink in the original snippet (before rewrite).",
      },
      argv_form_applied: {
        type: "boolean",
        description:
          "True when shell-style invocation was replaced with argv-array form.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "'high' for textbook argv conversions; 'low' when control flow is ambiguous.",
      },
    },
    required: ["fixed_code", "sink", "argv_form_applied", "confidence"],
  },
};

function buildUserPrompt(finding: NormalizedFinding): string {
  return [
    `Vulnerable snippet (as-is from the repo, ${finding.file}:${finding.startLine}):`,
    finding.originalCode,
    "",
    "Rewrite it safely and call emit_cmdi_fix with the result.",
  ].join("\n");
}

export function fallbackSuggestion(
  finding: NormalizedFinding
): NormalizedFixSuggestion {
  return {
    findingId: deriveFindingId(finding),
    detectorId: DETECTOR_ID,
    findingType: "command_injection_risk",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode:
      "// Auto-rewrite unavailable. Prefer argv-array forms — example:\n" +
      "// const { execFile } = require('child_process');\n" +
      "// execFile('git', ['status', '--porcelain'], { cwd: repoRoot }, (err, stdout) => { ... });",
    explanation:
      "LLM rewrite unavailable. Replace exec/execSync/spawn-with-shell with execFile/execFileSync/spawn(cmd, args) and never pass user input through a shell.",
    confidence: "low",
    patchQuality: "low",
    patchWarnings: [
      "Automatic rewrite failed; migrate off shell-form child_process APIs manually.",
    ],
    metadata: {
      type: "command_injection_risk",
    },
  };
}

export function coerceConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

/**
 * Maps tool sink labels onto FindingMetadata.command_injection_risk.sink.
 * "spawn-shell" / "spawnSync-shell" become spawn / spawnSync; "other" omits sink.
 */
export function coerceCmdiSinkForMetadata(
  raw: unknown
): "exec" | "execSync" | "spawn" | "spawnSync" | "execFile" | "shell" | undefined {
  if (raw === "exec") return "exec";
  if (raw === "execSync") return "execSync";
  if (raw === "spawn-shell") return "spawn";
  if (raw === "spawnSync-shell") return "spawnSync";
  if (raw === "execFile") return "execFile";
  if (raw === "other") return undefined;
  return undefined;
}

export function coerceArgvFormApplied(raw: unknown): boolean {
  return raw === true;
}

/**
 * Static check: still using shell-form exec/execSync, shell:true, or obvious
 * string concatenation into a command. Avoids wide negated char-class
 * patterns that catastrophically backtrack on whitespace-heavy inputs.
 */
export function residualCmdiRisk(fixedCode: string): string | null {
  if (/\bexecSync\s*\(/.test(fixedCode)) {
    return "Fixed code still calls execSync (use execFileSync with argv array)";
  }
  if (/\bexec\s*\(/.test(fixedCode)) {
    return "Fixed code still calls exec (use execFile with argv array)";
  }
  if (/shell\s*:\s*true/.test(fixedCode)) {
    return "Fixed code still sets shell: true";
  }
  if (/\bexecFileSync\s*\([^)]*\+/.test(fixedCode)) {
    return "Fixed code concatenates with + inside execFileSync arguments";
  }
  if (/\bexecFile\s*\([^)]*\+/.test(fixedCode)) {
    return "Fixed code concatenates with + inside execFile arguments";
  }
  if (/\bspawn\s*\([^)]*\+/.test(fixedCode)) {
    return "Fixed code concatenates with + inside spawn arguments";
  }
  if (/\bspawnSync\s*\([^)]*\+/.test(fixedCode)) {
    return "Fixed code concatenates with + inside spawnSync arguments";
  }
  if (/\bbash\s+-c\s*[`'"]/.test(fixedCode)) {
    return "Fixed code still invokes bash -c (shell injection surface)";
  }
  return null;
}

/**
 * Produces a safe rewrite for one normalized command-injection finding, or a
 * low-quality fallback when the LLM call fails.
 */
export async function generateCmdiFix(
  finding: NormalizedFinding
): Promise<NormalizedFixSuggestion> {
  const result = await callClaude({
    coverage: "auxiliary",
    model: CLAUDE_MODELS.REASONING,
    system: cachedSystem(CMDI_FIX_SYSTEM_PROMPT),
    tool: EMIT_CMDI_FIX_TOOL,
    messages: [{ role: "user", content: buildUserPrompt(finding) }],
  });

  if (!result.ok) return fallbackSuggestion(finding);

  const input = result.toolInput as
    | {
        fixed_code?: unknown;
        sink?: unknown;
        argv_form_applied?: unknown;
        confidence?: unknown;
      }
    | undefined;

  const fixedCode =
    typeof input?.fixed_code === "string" ? input.fixed_code.trim() : "";
  if (!fixedCode) return fallbackSuggestion(finding);

  const metaSink = coerceCmdiSinkForMetadata(input?.sink);
  const argvFormApplied = coerceArgvFormApplied(input?.argv_form_applied);
  const confidence = coerceConfidence(input?.confidence);

  const warnings: string[] = [];
  let patchQuality: "high" | "medium" | "low" =
    confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low";

  const residual = residualCmdiRisk(fixedCode);
  if (residual) {
    warnings.push(`Static check: ${residual}`);
    patchQuality = "low";
  }

  warnings.push(
    "LLM-generated command-injection rewrite; verify argv ordering, cwd/env options, and that the process still receives the intended arguments."
  );

  return {
    findingId: deriveFindingId(finding),
    detectorId: DETECTOR_ID,
    findingType: "command_injection_risk",
    file: finding.file,
    line: finding.startLine,
    originalCode: finding.originalCode,
    fixedCode,
    explanation:
      "Replaced shell-form child_process usage with argv-array APIs. Review argument lists and error handling.",
    confidence,
    patchQuality,
    patchWarnings: warnings,
    metadata: {
      type: "command_injection_risk",
      ...(metaSink ? { sink: metaSink } : {}),
      argvFormApplied,
    },
  };
}
