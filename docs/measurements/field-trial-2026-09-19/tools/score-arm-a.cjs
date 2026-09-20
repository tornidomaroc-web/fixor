// Field trial Arm A scorer. Applies the registered hit rule mechanically:
// a HIT is a finding from a detector in the case's lane family, on a target
// file, whose reported line lies within 20 lines of an old-side hunk of the
// fix diff. Every emitted finding is HIGH or MEDIUM confidence (LOW is dropped
// at the emit site), so confidence needs no filter here.
//
// Usage: node score-arm-a.cjs <corpusDir> <runDir> <dryrunDir>
//   corpusDir/known-answer/NN/<target files>, corpusDir/patches/NN.jsonl
//   runDir/NN.report.md, runDir/NN.log, runDir/NN.exit
//   dryrunDir/ka-NN.json
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const [corpus, runDir, dryDir] = process.argv.slice(2);
const WINDOW = 20;
const AC = new Set(["auth_bypass_risk", "admin_check_risk", "idor_risk"]);
const FAMILY_DETECTORS = {
  ac: new Set(["auth-bypass-multi", "admin-check-multi", "idor-multi"]),
  env: new Set(["env-exposure-multi"]),
};
const TEST_RE = /(^|\/)(test|tests|__tests__|spec|e2e|fixtures?|examples?|scripts|demo)(\/|$)|\.(test|spec)\./i;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function hunks(n) {
  const byFile = {};
  for (const line of fs.readFileSync(path.join(corpus, "patches", `${n}.jsonl`), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [file, patch] = JSON.parse(line);
    if (!CODE_RE.test(file) || TEST_RE.test(file)) continue;
    byFile[file] = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map((m) => {
      const start = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      return [start, start + Math.max(len, 1) - 1];
    });
  }
  return byFile;
}

function parseReport(p) {
  const findings = [];
  let cur = null;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const h = line.match(/^### (\S+) — (\S+) \(confidence: (\S+)\)/);
    if (h) {
      cur = { type: h[1], severity: h[2], confidence: h[3] };
      continue;
    }
    const f = line.match(/^- File: `([^`]+)`:(\d+)/);
    if (f && cur) {
      findings.push({ ...cur, file: f[1], line: Number(f[2]) });
      cur = null;
    }
  }
  return findings;
}

function logNumber(log, key) {
  const clean = log.replace(/\x1b\[[0-9;]*m/g, "");
  const m = clean.match(new RegExp(`${key}"?\\s*[:=]\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

const rows = [];
for (let i = 1; i <= 12; i++) {
  const n = String(i).padStart(2, "0");
  const family = n === "12" ? "env" : "ac";
  const inFamily = (t) => (family === "env" ? t === "env_exposure_risk" : AC.has(t));
  const h = hunks(n);
  const dry = JSON.parse(fs.readFileSync(path.join(dryDir, `ka-${n}.json`), "utf8"));
  const dryFamilyCalls = dry.callsPerFile.filter(([, d]) => FAMILY_DETECTORS[family].has(d)).length;

  // Window coverage: share of each target file's lines inside the union of windows.
  const coverage = {};
  for (const [file, hs] of Object.entries(h)) {
    const abs = path.join(corpus, "known-answer", n, file);
    const total = fs.readFileSync(abs, "utf8").split("\n").length;
    const covered = new Set();
    for (const [a, b] of hs) for (let l = Math.max(1, a - WINDOW); l <= Math.min(total, b + WINDOW); l++) covered.add(l);
    coverage[file] = `${covered.size}/${total}`;
  }

  const row = { case: n, family, dryCalls: dry.modelCalls, dryFamilyCalls, windowCoverage: coverage };
  const reportPath = path.join(runDir, `${n}.report.md`);
  if (fs.existsSync(reportPath)) {
    const log = fs.readFileSync(path.join(runDir, `${n}.log`), "utf8");
    row.exit = Number(fs.readFileSync(path.join(runDir, `${n}.exit`), "utf8").trim());
    row.calls = logNumber(log, "llmCallsAttempted");
    row.failed = logNumber(log, "llmCallsFailed");
    row.notAnalyzed = logNumber(log, "filesNotAnalyzed");
    const findings = parseReport(reportPath).map((f) => ({ ...f, file: f.file.replace(/\\/g, "/") }));
    row.findings = findings;
    const fam = findings.filter((f) => inFamily(f.type) && h[f.file]);
    const inWindow = fam.filter((f) => h[f.file].some(([a, b]) => f.line >= a - WINDOW && f.line <= b + WINDOW));
    if (inWindow.length > 0) row.verdict = "HIT";
    else if (dryFamilyCalls === 0) row.verdict = "MISS: never reached the model (no lane-family detector call)";
    else if (fam.length > 0) row.verdict = "MISS: read; lane-family finding outside the window (file-level hit, does not score)";
    else row.verdict = "MISS: read by a lane-family detector; nothing returned in the family";
    row.countMatchesDryRun = row.calls === dry.modelCalls;
  }
  rows.push(row);
}
process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
