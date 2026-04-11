import { spawnSync } from "child_process";

export function isSemgrepAvailable(): boolean {
  const r = spawnSync("semgrep", ["--version"], { encoding: "utf-8" });
  return r.status === 0;
}

/**
 * Runs Semgrep on a local directory and returns JSON output (same shape as `semgrep scan --json`).
 */
export function runSemgrepScan(repoAbsPath: string): {
  ok: boolean;
  json?: string;
  error?: string;
} {
  const args = [
    "scan",
    "--config",
    "auto",
    "--json",
    "--quiet",
    repoAbsPath,
  ];
  const r = spawnSync("semgrep", args, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });

  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    return {
      ok: false,
      error: "semgrep executable not found (install from https://semgrep.dev or use precomputed JSON).",
    };
  }

  if (r.status !== 0) {
    return {
      ok: false,
      error: (r.stderr || r.stdout || `semgrep exited ${r.status}`).trim(),
    };
  }

  const out = (r.stdout || "").trim();
  if (!out) {
    return { ok: false, error: "semgrep produced empty stdout" };
  }

  return { ok: true, json: out };
}
