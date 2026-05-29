/**
 * Regression test for collapseFindings — the report-layer finding collapse.
 *
 * Pure / zero-API. Asserts the invariant violated by the old
 * suppressAdminCheckWhereAuthBypass step: a correct admin_check finding must
 * NOT be silently dropped just because an auth_bypass finding coincides on the
 * same (file, line). Reproduces the real-shape FastAPI proof case (admin role
 * route: authenticated-but-not-admin, where admin_check is the correct, more
 * specific finding and auth_bypass is a cross-fire).
 *
 * Run: npm run test:finding-merge   (no ANTHROPIC_API_KEY required)
 */

import assert from "node:assert/strict";
import { collapseFindings } from "../cli/finding-merge";
import type { Finding, FindingType } from "../analysis-engine/types";

function finding(type: FindingType, file: string, line: number): Finding {
  return {
    type,
    file,
    line,
    confidence: "high",
    severity: "critical",
    explanation: `${type} at ${file}:${line}`,
    why_it_matters: "test",
    suggested_fix: "test",
    example_fix: "test",
    original_snippet: "test",
  };
}

function has(findings: Finding[], type: FindingType, file: string, line: number): boolean {
  return findings.some((f) => f.type === type && f.file === file && f.line === line);
}

function count(findings: Finding[], type: FindingType, file: string, line: number): number {
  return findings.filter((f) => f.type === type && f.file === file && f.line === line).length;
}

function main(): void {
  // [1] THE DEFECT: auth_bypass and admin_check coincide on the same line.
  // admin_check is the correct, more-specific finding and MUST survive.
  const coincident = collapseFindings([
    finding("auth_bypass_risk", "app/routers/admin.py", 14),
    finding("admin_check_risk", "app/routers/admin.py", 14),
  ]);
  assert(
    has(coincident, "admin_check_risk", "app/routers/admin.py", 14),
    "[1] admin_check_risk silently dropped where auth_bypass_risk coincides — silent loss of a true positive",
  );
  assert(
    has(coincident, "auth_bypass_risk", "app/routers/admin.py", 14),
    "[1] auth_bypass_risk missing",
  );
  process.stdout.write("[finding-merge] 1: coincident admin_check preserved\n");

  // [2] Exact duplicates (same type, same file:line) still collapse to one.
  const dups = collapseFindings([
    finding("auth_bypass_risk", "a.py", 5),
    finding("auth_bypass_risk", "a.py", 5),
  ]);
  assert.equal(
    count(dups, "auth_bypass_risk", "a.py", 5),
    1,
    "[2] exact duplicate not collapsed",
  );
  process.stdout.write("[finding-merge] 2: exact duplicates collapse to one\n");

  // [3] Standalone admin_check (no coincident auth_bypass) is preserved.
  const standalone = collapseFindings([finding("admin_check_risk", "b.py", 9)]);
  assert(
    has(standalone, "admin_check_risk", "b.py", 9),
    "[3] standalone admin_check dropped",
  );
  process.stdout.write("[finding-merge] 3: standalone admin_check preserved\n");

  // [4] Distinct vuln types on the same line are all preserved.
  const distinct = collapseFindings([
    finding("idor_risk", "c.py", 30),
    finding("admin_check_risk", "c.py", 30),
  ]);
  assert(
    has(distinct, "idor_risk", "c.py", 30) && has(distinct, "admin_check_risk", "c.py", 30),
    "[4] distinct types on same line not both preserved",
  );
  process.stdout.write("[finding-merge] 4: distinct types on same line preserved\n");

  process.stdout.write("\n[finding-merge] PASS\n");
}

main();
