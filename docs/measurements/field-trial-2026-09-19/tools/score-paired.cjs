// Paired scorer: the registered Arm A hit rule on the vulnerable parent, plus a
// negative control on the fixed version of the same files. A DISCRIMINATING hit
// is an in-window lane-family finding at the parent (old-side hunks) AND no
// in-window lane-family finding at the fix (new-side hunks).
//
// Usage: node score-paired.cjs <corpusDir> <parentRunDir> <fixRunDir>
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const [corpus, parentDir, fixDir] = process.argv.slice(2);
const WINDOW = 20;
const AC = new Set(["auth_bypass_risk", "admin_check_risk", "idor_risk"]);
const TEST_RE = /(^|\/)(test|tests|__tests__|spec|e2e|fixtures?|examples?|scripts|demo)(\/|$)|\.(test|spec)\./i;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function hunks(n, side) {
  const re = side === "old" ? /^@@ -(\d+)(?:,(\d+))? /gm : /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? /gm;
  const byFile = {};
  for (const line of fs.readFileSync(path.join(corpus, "patches", `${n}.jsonl`), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [file, patch] = JSON.parse(line);
    if (!CODE_RE.test(file) || TEST_RE.test(file)) continue;
    byFile[file] = [...patch.matchAll(re)].map((m) => {
      const start = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      return [start, start + Math.max(len, 1) - 1];
    });
  }
  return byFile;
}

function findings(reportPath) {
  const out = [];
  let cur = null;
  for (const line of fs.readFileSync(reportPath, "utf8").split("\n")) {
    const h = line.match(/^### (\S+) — (\S+) \(confidence: (\S+)\)/);
    if (h) {
      cur = { type: h[1], confidence: h[3] };
      continue;
    }
    const f = line.match(/^- File: `([^`]+)`:(\d+)/);
    if (f && cur) {
      out.push({ ...cur, file: f[1].split(String.fromCharCode(92)).join("/"), line: Number(f[2]) });
      cur = null;
    }
  }
  return out;
}

const rows = [];
let registered = 0;
let discriminating = 0;
for (let i = 1; i <= 12; i++) {
  const n = String(i).padStart(2, "0");
  const inFamily = (t) => (n === "12" ? t === "env_exposure_risk" : AC.has(t));
  const inWindow = (list, h) =>
    list.filter((f) => inFamily(f.type) && h[f.file] && h[f.file].some(([a, b]) => f.line >= a - WINDOW && f.line <= b + WINDOW));
  const parentFindings = findings(path.join(parentDir, `${n}.report.md`));
  const fixFindings = findings(path.join(fixDir, `${n}.report.md`));
  const parentHit = inWindow(parentFindings, hunks(n, "old")).length > 0;
  const fixHit = inWindow(fixFindings, hunks(n, "new")).length > 0;
  if (parentHit) registered++;
  if (parentHit && !fixHit) discriminating++;
  rows.push({ case: n, parentHit, fixHit, discriminating: parentHit && !fixHit, parentFindings, fixFindings });
}
process.stdout.write(JSON.stringify({ registeredRuleHits: registered, pairedRuleHits: discriminating, rows }, null, 2) + "\n");
