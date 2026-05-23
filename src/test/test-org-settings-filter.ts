/**
 * Pure-function tests for the org_settings filter (5B-4).
 *
 * The integration into auditor-workflow.ts is exercised live by the
 * existing fixture suite (no findings are filtered by the default
 * settings = severity_threshold:"low" + no globs + enabledDetectors:null,
 * so this PR is behavior-neutral for installations without configured
 * settings).
 */
import {
  filterFindings,
  passesOrgSettings,
  type FindingForFilter,
  type OrgSettingsView,
} from "../lib/org-settings-filter";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}

const PERMISSIVE: OrgSettingsView = {
  severityThreshold: "low",
  ignoredGlobs: [],
  enabledDetectors: null,
};

function f(
  partial: Partial<FindingForFilter> & { file: string },
): FindingForFilter {
  return {
    type: "auth_bypass_risk",
    severity: "high",
    ...partial,
  };
}

function run(): void {
  // -- passesOrgSettings: severity gate -------------------------------
  assert(
    passesOrgSettings(f({ file: "a.ts", severity: "low" }), PERMISSIVE).passes,
    "low severity passes when threshold=low",
  );
  {
    const r = passesOrgSettings(f({ file: "a.ts", severity: "low" }), {
      ...PERMISSIVE,
      severityThreshold: "high",
    });
    assert(!r.passes, "low severity dropped when threshold=high");
    assert(!r.passes && r.reason === "severity", "reason=severity");
  }
  assert(
    passesOrgSettings(f({ file: "a.ts", severity: "critical" }), {
      ...PERMISSIVE,
      severityThreshold: "high",
    }).passes,
    "critical passes when threshold=high",
  );

  // -- passesOrgSettings: glob gate -----------------------------------
  {
    const r = passesOrgSettings(
      f({ file: "src/foo.test.ts" }),
      { ...PERMISSIVE, ignoredGlobs: ["**/*.test.ts"] },
    );
    assert(!r.passes, "test file matches glob -> drop");
    assert(!r.passes && r.reason === "glob", "reason=glob");
  }
  assert(
    passesOrgSettings(
      f({ file: "src/foo.ts" }),
      { ...PERMISSIVE, ignoredGlobs: ["**/*.test.ts"] },
    ).passes,
    "non-test file passes the test-file glob",
  );
  assert(
    !passesOrgSettings(
      f({ file: "node_modules/lib/index.js" }),
      { ...PERMISSIVE, ignoredGlobs: ["node_modules/**"] },
    ).passes,
    "node_modules glob drops nested file",
  );
  // Multiple globs — any match drops
  assert(
    !passesOrgSettings(
      f({ file: "dist/bundle.js" }),
      { ...PERMISSIVE, ignoredGlobs: ["**/*.test.ts", "dist/**"] },
    ).passes,
    "any-of multiple globs drops",
  );

  // -- passesOrgSettings: detector allowlist gate ---------------------
  // auth-bypass has registered detector "auth-bypass-multi"
  {
    const r = passesOrgSettings(
      f({ file: "src/x.ts", type: "auth_bypass_risk" }),
      { ...PERMISSIVE, enabledDetectors: ["idor-multi"] },
    );
    assert(!r.passes, "auth-bypass finding dropped when allowlist excludes it");
    assert(!r.passes && r.reason === "detector", "reason=detector");
  }
  assert(
    passesOrgSettings(
      f({ file: "src/x.ts", type: "auth_bypass_risk" }),
      {
        ...PERMISSIVE,
        enabledDetectors: ["auth-bypass-multi", "idor-multi"],
      },
    ).passes,
    "auth-bypass finding passes when in allowlist",
  );
  // null allowlist = all enabled
  assert(
    passesOrgSettings(
      f({ file: "src/x.ts", type: "auth_bypass_risk" }),
      { ...PERMISSIVE, enabledDetectors: null },
    ).passes,
    "null allowlist = all detectors enabled",
  );
  // Empty allowlist [] is the user's deliberate "scan nothing" choice
  // — the validator accepts empty arrays explicitly (see
  // settings-validation.ts:78 comment "we accept even though it's an
  // aggressive choice; the backend honors it"). The defensive guard
  // ONLY engages for non-empty stale allowlists, NOT for explicit [].
  // Honoring an explicit [] is honoring user intent, not silent fail.
  {
    const r = passesOrgSettings(
      f({ file: "src/x.ts", type: "auth_bypass_risk" }),
      { ...PERMISSIVE, enabledDetectors: [] },
    );
    assert(!r.passes, "explicit empty allowlist drops everything");
    assert(
      !r.passes && r.reason === "detector",
      "reason=detector on explicit empty allowlist",
    );
  }

  // -- defensive guard: stale allowlist falls back to "all pass" ----
  // A stale allowlist that contains only ids no longer in the
  // shipping set (e.g. an org row written by the pre-fix dashboard
  // when DETECTOR_OPTIONS still pointed at the suppressed
  // sql/xss/cmdi/pt detectors) must NOT filter the scan to zero
  // findings — that's a silent fail-closed. Fail-safe: treat as null.
  assert(
    passesOrgSettings(
      f({ file: "src/x.ts", type: "auth_bypass_risk" }),
      { ...PERMISSIVE, enabledDetectors: ["sql-injection-js-ts"] },
    ).passes,
    "stale-only allowlist falls back to all-pass (auth-bypass survives)",
  );
  assert(
    passesOrgSettings(
      f({ file: "src/x.ts", type: "idor_risk" }),
      { ...PERMISSIVE, enabledDetectors: ["xss-js-ts", "command-injection-js-ts"] },
    ).passes,
    "stale-only allowlist with multiple stale ids still falls back",
  );
  // Mixed allowlist: at least one real id present → guard does NOT engage,
  // the filter behaves normally and drops findings not in the recognized set.
  {
    const r = passesOrgSettings(
      f({ file: "src/x.ts", type: "auth_bypass_risk" }),
      { ...PERMISSIVE, enabledDetectors: ["sql-injection-js-ts", "idor-multi"] },
    );
    assert(!r.passes, "mixed allowlist with real id: auth-bypass dropped");
    assert(
      !r.passes && r.reason === "detector",
      "reason=detector on mixed allowlist",
    );
  }

  // -- filterFindings: stats accumulation -----------------------------
  const findings: FindingForFilter[] = [
    f({ file: "src/a.ts", severity: "low" }),
    f({ file: "src/b.test.ts", severity: "high" }),
    f({ file: "src/c.ts", severity: "high", type: "auth_bypass_risk" }),
    f({ file: "src/d.ts", severity: "high", type: "idor_risk" }),
    f({ file: "src/e.ts", severity: "critical" }),
  ];
  const result = filterFindings(findings, {
    severityThreshold: "medium",
    ignoredGlobs: ["**/*.test.ts"],
    enabledDetectors: ["idor-multi"],
  });
  assert(
    result.kept.length === 1,
    `1 finding kept (got ${result.kept.length})`,
  );
  assert(result.kept[0]!.file === "src/d.ts", "kept the idor finding");
  assert(
    result.stats.droppedBySeverity === 1,
    `severity drops = 1 (got ${result.stats.droppedBySeverity})`,
  );
  assert(
    result.stats.droppedByGlob === 1,
    `glob drops = 1 (got ${result.stats.droppedByGlob})`,
  );
  assert(
    result.stats.droppedByDetector === 2,
    `detector drops = 2 (got ${result.stats.droppedByDetector})`,
  );

  // -- short-circuit ordering -----------------------------------------
  // A single finding is dropped by exactly ONE reason; the predicate
  // must report the FIRST gate that fails (severity > glob > detector).
  {
    const r = passesOrgSettings(
      // Low severity AND matches glob — severity gate hits first.
      f({ file: "src/a.test.ts", severity: "low" }),
      { ...PERMISSIVE, severityThreshold: "high", ignoredGlobs: ["**/*.test.ts"] },
    );
    assert(!r.passes && r.reason === "severity", "severity beats glob");
  }

  if (failures === 0) {
    console.log("[PASS] org-settings-filter unit tests");
  } else {
    console.error(`[FAIL] ${failures} org-settings-filter unit test(s) failed`);
    process.exit(1);
  }
}

run();
