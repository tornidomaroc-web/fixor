/**
 * Shared diff-parser regression test (deterministic, no LLM, no DB).
 *
 * Guards the H1 contract (Phase H):
 *   1. The CLI's synthetic whole-file diff path is the degenerate case
 *      every detector baseline was measured under — content and line
 *      numbers must remain byte-identical (identity lineMap).
 *   2. On real multi-hunk PR diffs, added lines must carry their TRUE
 *      target-file line numbers derived from `@@ -a,b +c,d` headers —
 *      the legacy per-detector parser numbered them against the
 *      concatenated added-lines text, which broke every production
 *      finding anchor, SARIF region, and file:line:type dedupe key.
 *   3. `content` (the judgment input to prefilters/prompts) must stay
 *      byte-identical to what the LEGACY parser produced on every diff
 *      shape — the fix changes WHERE findings point, never WHAT the
 *      detectors judge. Asserted against an inline copy of the legacy
 *      parser as oracle.
 *
 * Run via: npm run test:diff-parser
 */

import {
  parseDiff,
  remapFindingLines,
} from "../analysis-engine/detectors/shared/diff-parser";
import { buildSyntheticDiff } from "../cli/diff-builder";
import type { NormalizedFinding } from "../analysis-engine/detector.types";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg} (expected ${e}, got ${a})`);
}

/**
 * VERBATIM copy of the legacy per-detector parseDiff (the six deleted
 * copies hashed identical). Used as the oracle proving `content` and
 * `path` selection did not drift.
 */
function legacyParseDiff(diff: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const parts = diff.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split(/\r?\n/);
    let path: string | null = null;
    let inHunk = false;
    const content: string[] = [];
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        path = line.slice("+++ b/".length).trim();
      } else if (line.startsWith("@@")) {
        inHunk = true;
      } else if (inHunk && line.startsWith("+") && !line.startsWith("+++")) {
        content.push(line.slice(1));
      }
    }
    if (path && content.length > 0) {
      out.push({ path, content: content.join("\n") });
    }
  }
  return out;
}

// --- fixtures -------------------------------------------------------

const MULTI_HUNK_DIFF = [
  "diff --git a/src/routes/notes.ts b/src/routes/notes.ts",
  "index 1111111..2222222 100644",
  "--- a/src/routes/notes.ts",
  "+++ b/src/routes/notes.ts",
  "@@ -8,5 +8,6 @@ function setup() {",
  " const a = 1;",
  " const b = 2;",
  "+const added1 = 3;",
  "+const added2 = 4;",
  " const c = 5;",
  "-const removed = 6;",
  " const d = 7;",
  "@@ -30,3 +32,5 @@ export function tail() {",
  " function tail() {",
  "+  const x = 1;",
  "   return null;",
  "+  // added trailing comment",
  " }",
].join("\n");

// The G1 motivator shape: unchanged decorator + signature (context
// lines), vulnerable body added mid-file.
const SIGNATURE_CONTEXT_DIFF = [
  "diff --git a/app/api/users.py b/app/api/users.py",
  "index 3333333..4444444 100644",
  "--- a/app/api/users.py",
  "+++ b/app/api/users.py",
  '@@ -41,3 +41,6 @@ router = APIRouter(prefix="/users")',
  ' @router.delete("/{user_id}")',
  " def delete_user(user_id: int, session: SessionDep) -> dict:",
  "+    user = session.get(User, user_id)",
  "+    session.delete(user)",
  "+    session.commit()",
  '     return {"deleted": user_id}',
].join("\n");

const DELETED_FILE_DIFF = [
  "diff --git a/old.ts b/old.ts",
  "deleted file mode 100644",
  "--- a/old.ts",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "-line1",
  "-line2",
  "-line3",
].join("\n");

const MULTI_FILE_DIFF = [
  MULTI_HUNK_DIFF,
  SIGNATURE_CONTEXT_DIFF,
  DELETED_FILE_DIFF,
].join("\n");

const MALFORMED_HEADER_DIFF = [
  "diff --git a/x.ts b/x.ts",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ mangled header @@",
  "+const kept = 1;",
  "+const kept2 = 2;",
].join("\n");

// --- 1. synthetic whole-file pin (the baseline-bearing case) --------

console.log("\n--- 1. synthetic whole-file diff (CLI path) ---");
{
  const original = "import x from 'y';\n\nconst a = 1;\nexport default a;\n";
  const synthetic = buildSyntheticDiff("src/x.ts", original);
  const [file] = parseDiff(synthetic);
  const [legacy] = legacyParseDiff(synthetic);
  assert(file !== undefined, "synthetic diff parses to one file");
  assertEq(file!.path, "src/x.ts", "synthetic path preserved");
  assert(
    file!.content === legacy!.content,
    "synthetic content BYTE-IDENTICAL to legacy parser",
  );
  assertEq(
    file!.lineMap,
    [1, 2, 3, 4],
    "synthetic lineMap is the identity (degenerate single hunk at +1)",
  );
}

// --- 2. legacy-oracle content equivalence on every shape ------------

console.log("\n--- 2. content/path equivalence vs legacy parser ---");
for (const [name, diff] of [
  ["multi-hunk", MULTI_HUNK_DIFF],
  ["signature-context", SIGNATURE_CONTEXT_DIFF],
  ["multi-file", MULTI_FILE_DIFF],
  ["deleted-file", DELETED_FILE_DIFF],
  ["malformed-header", MALFORMED_HEADER_DIFF],
] as const) {
  const ours = parseDiff(diff).map((f) => ({ path: f.path, content: f.content }));
  const legacy = legacyParseDiff(diff);
  assertEq(ours, legacy, `${name}: path+content identical to legacy`);
}

// --- 3. real line numbers on multi-hunk diffs ------------------------

console.log("\n--- 3. hunk-offset line mapping ---");
{
  const [file] = parseDiff(MULTI_HUNK_DIFF);
  assertEq(
    file!.content.split("\n"),
    [
      "const added1 = 3;",
      "const added2 = 4;",
      "  const x = 1;",
      "  // added trailing comment",
    ],
    "multi-hunk: added lines collected in order",
  );
  assertEq(
    file!.lineMap,
    [10, 11, 33, 35],
    "multi-hunk: REAL file lines (ctx advances, '-' does not, 2nd hunk offset honored)",
  );
}
{
  const [file] = parseDiff(SIGNATURE_CONTEXT_DIFF);
  assertEq(
    file!.lineMap,
    [43, 44, 45],
    "unchanged-signature case: added body lines numbered after context lines",
  );
}

// --- 4. multi-file, deleted-file, malformed --------------------------

console.log("\n--- 4. multi-file / deleted / malformed / empty ---");
{
  const files = parseDiff(MULTI_FILE_DIFF);
  assertEq(
    files.map((f) => f.path),
    ["src/routes/notes.ts", "app/api/users.py"],
    "multi-file: both added-line files present, deleted file skipped",
  );
  assertEq(files[1]!.lineMap, [43, 44, 45], "multi-file: second file's map independent");
}
assertEq(parseDiff(DELETED_FILE_DIFF), [], "deleted-file diff yields no files");
assertEq(parseDiff(""), [], "empty diff yields no files");
assertEq(parseDiff("not a diff at all\njust text\n"), [], "garbage input yields no files");
{
  const [file] = parseDiff(MALFORMED_HEADER_DIFF);
  assertEq(
    file!.lineMap,
    [1, 2],
    "malformed hunk header degrades to monotonic numbering, content kept",
  );
}

// --- 5. remapFindingLines --------------------------------------------

console.log("\n--- 5. finding line remap ---");
{
  const finding = (line: number): NormalizedFinding => ({
    detectorId: "test",
    type: "idor_risk",
    file: "f.ts",
    startLine: line,
    endLine: line,
    originalCode: "x",
    ruleId: "r",
    message: "m",
    explanation: "e",
    confidence: "high",
    severity: "critical",
  });
  const map = [10, 11, 33, 35];
  const [mapped] = remapFindingLines([finding(3)], map);
  assertEq(mapped!.startLine, 33, "content line 3 maps to file line 33");
  assertEq(mapped!.endLine, 33, "endLine mapped identically");
  const [identity] = remapFindingLines([finding(2)], [1, 2, 3]);
  assertEq(identity!.startLine, 2, "identity map leaves synthetic lines unchanged");
  const [outOfRange] = remapFindingLines([finding(99)], map);
  assertEq(outOfRange!.startLine, 99, "out-of-range content line kept (defensive, no throw)");
}

console.log(
  failures === 0
    ? "\nDiff-parser test: PASS."
    : `\nDiff-parser test: ${failures} FAILURE(S).`,
);
process.exit(failures > 0 ? 1 : 0);
