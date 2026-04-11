import type { SqlDialect } from "../types/vulnerability.types";

export type Hotspot = { relativePath: string; line: number };

export type GroundTruth = {
  vulnerableHotspots: Hotspot[];
  benignHotspots: Hotspot[];
};

export type RealTestCase = {
  id: string;
  label: string;
  /** Subpath under src/real-tests/ */
  repoSubdir: string;
  precomputedRelative: string;
  dialect: SqlDialect;
  groundTruth: GroundTruth;
};

/**
 * Three reproducible scenarios: vulnerable-only, parameterized-only, mixed.
 * Repo trees live under src/real-tests/repos/; offline Semgrep output under precomputed/.
 */
export const REAL_TEST_CASES: RealTestCase[] = [
  {
    id: "vulnerable-sqli",
    label: "Small Node snapshot — string concatenation into SQL",
    repoSubdir: "repos/vulnerable-sqli",
    precomputedRelative: "precomputed/vulnerable-sqli.semgrep.json",
    dialect: "mysql",
    groundTruth: {
      vulnerableHotspots: [{ relativePath: "src/routes.js", line: 4 }],
      benignHotspots: [],
    },
  },
  {
    id: "safe-parameterized",
    label: "Parameterized queries only (mysql2 placeholders)",
    repoSubdir: "repos/safe-parameterized",
    precomputedRelative: "precomputed/safe-parameterized.semgrep.json",
    dialect: "mysql",
    groundTruth: {
      vulnerableHotspots: [],
      benignHotspots: [
        { relativePath: "src/users.js", line: 1 },
        { relativePath: "src/users.js", line: 4 },
      ],
    },
  },
  {
    id: "mixed-patterns",
    label: "Mixed — one unsafe pg concatenation + one safe $1 query",
    repoSubdir: "repos/mixed-patterns",
    precomputedRelative: "precomputed/mixed-patterns.semgrep.json",
    dialect: "postgres",
    groundTruth: {
      vulnerableHotspots: [{ relativePath: "src/unsafe.js", line: 4 }],
      benignHotspots: [{ relativePath: "src/safe.js", line: 4 }],
    },
  },
];
