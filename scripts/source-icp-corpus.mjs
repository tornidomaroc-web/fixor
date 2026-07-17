/**
 * E' step one: source the ICP corpus. SOURCING ONLY -- no scanning, no census.
 *
 * ZERO SPEND IS STRUCTURAL, NOT FLAG-DEPENDENT. This script imports the
 * prospector's filter/score/metadata modules ONLY. `fixor-runner.js` -- the sole
 * module that reaches Anthropic -- is never imported, so the Anthropic code path
 * is not in the call graph and there is nothing to bypass. No --dry-run flag is
 * trusted. Every network call here is `gh` -> GitHub, not Anthropic.
 *
 * SAMPLING FRAME: ICP MEMBERSHIP, NEVER CODE CONTENT. `search.ts` and
 * SEARCH_PATTERNS are dropped entirely. Sourcing by a vulnerability pattern
 * would select on the dependent variable -- measuring the prevalence of X in a
 * population chosen for containing X -- which does not dent the numbers, it
 * determines them. Candidates are enumerated on METADATA axes only (stars,
 * language, pushed date, fork, archived), then run through the real
 * fetchRepoMetadata -> filterRepo unchanged.
 *
 * SELECTION IS BY MEMBERSHIP. filterRepo is the ICP membership test. The 30-50
 * are drawn evenly per stratum in a deterministic, alphabetical order.
 *
 * SCOREREPO IS UNUSABLE HERE, AND THAT IS A FINDING, NOT AN OMISSION. The plan
 * was to record scoreRepo's output as data (never as a selection criterion).
 * On contact its real signature is `scoreRepo(meta, vulns: Vulnerability[])` --
 * the second argument IS the code-search hit list. scoreRepo is a LEAD-GEN
 * ranker and is structurally inseparable from SEARCH_PATTERNS: computing it at
 * all would require running the very pattern search this frame excludes, which
 * would reintroduce the dependent-variable contamination through the back door.
 * So it is dropped. filterRepo needs no vulns and is the whole ICP membership
 * test; the frame is therefore purely metadata-based with ZERO dependency on any
 * vulnerability signal.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// DEPENDENCY: the fixor-prospector compiled modules (filter.js, metadata.js).
// fixor-prospector is a SEPARATE repo, not vendored here, so its path is an env
// var with the local default. This script documents HOW the committed manifest
// was drawn; the manifest itself (repo + pinned SHA per entry) is the
// self-contained reproducible artifact and needs none of this to replay.
const P = process.env.FIXOR_PROSPECTOR_DIST
  ?? "D:/RAGHAD JAD/Fixor-Final/fixor-prospector/dist";
const { filterRepo } = await import(`file:///${P}/filter.js`);
const { fetchRepoMetadata } = await import(`file:///${P}/metadata.js`);
// scoreRepo is deliberately NOT imported. See SCOREREPO IS UNUSABLE HERE below.

const CORPUS_ROOT = process.env.ICP_CORPUS_ROOT
  ?? "D:/RAGHAD JAD/Fixor-Final/Fixor/test-output/icp-corpus";
const OUT = process.argv[2];
const TODAY = "2026-07-17";

// Star bands: mitigate --sort=updated concentrating the sample in whatever star
// range happens to be churning. Bands span filterRepo's <=5000 ceiling only up
// to 1500, because scoreRepo's ICP band is 50-1500; above that is out of profile.
const STAR_BANDS = ["50..150", "151..400", "401..800", "801..1500"];

// Date windows across filterRepo's <90d activity requirement. Without these the
// whole sample would be "pushed today" -- the extreme tail of a 90-day window.
const DATE_WINDOWS = [
  { id: "0-30d", q: "2026-06-17..2026-07-17" },
  { id: "30-60d", q: "2026-05-18..2026-06-17" },
  { id: "60-90d", q: "2026-04-18..2026-05-18" },
];

const LANGS = ["typescript", "javascript"];
const PER_CELL = 8;
const TAKE_PER_CELL = 2; // 4 bands x 3 windows x 2 langs x 2 = up to 48

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function searchCell(lang, band, win) {
  const args = [
    "search", "repos",
    `--language=${lang}`, `--stars=${band}`, `--updated=${win.q}`,
    "--include-forks=false", "--archived=false",
    "--sort=updated", `--limit=${PER_CELL}`,
    "--json", "fullName,stargazersCount,pushedAt",
  ];
  try {
    const data = JSON.parse(gh(args) || "[]");
    return data.map((r) => ({ repo: r.fullName, cell: `${lang}|${band}|${win.id}` }));
  } catch (e) {
    process.stdout.write(`  SEARCH FAILED ${lang} ${band} ${win.id}\n`);
    return [];
  }
}

function main() {
  // --- 1. Enumerate candidates on metadata axes only -----------------------
  process.stdout.write("1. Enumerating candidates (metadata axes only; no code search)\n");
  const candidates = new Map(); // repo -> cell (first cell wins; dedupe)
  let cells = 0;
  for (const lang of LANGS) {
    for (const band of STAR_BANDS) {
      for (const win of DATE_WINDOWS) {
        cells++;
        for (const c of searchCell(lang, band, win)) {
          if (!candidates.has(c.repo)) candidates.set(c.repo, c.cell);
        }
      }
    }
  }
  process.stdout.write(`   ${cells} strata queried; ${candidates.size} unique candidates\n\n`);

  // --- 2. Real ICP membership test -----------------------------------------
  process.stdout.write("2. fetchRepoMetadata -> filterRepo (prospector code, unchanged; no vulns needed)\n");
  // ROUND-ROBIN INTERLEAVE. v1 iterated insertion order (all typescript strata,
  // then all javascript), so a transient failure burst late in the run starved
  // javascript specifically and produced a 24/2 TS/JS sample that LOOKED like a
  // finding about the ICP. Interleaving means any residual failure is spread
  // across strata instead of concentrated in whichever ran last.
  const byCellQueue = new Map();
  for (const [repo, cell] of candidates) {
    const q = byCellQueue.get(cell) ?? [];
    q.push(repo);
    byCellQueue.set(cell, q);
  }
  const order = [];
  for (let d = 0; ; d++) {
    let added = false;
    for (const [cell, q] of byCellQueue) {
      if (d < q.length) { order.push([q[d], cell]); added = true; }
    }
    if (!added) break;
  }

  const rows = [];
  const rejects = {};
  const metadataFailures = [];
  let i = 0;
  for (const [repo, cell] of order) {
    i++;
    // RETRY WITH BACKOFF, AND RECORD. v1 called fetchRepoMetadata once and
    // discarded the failure, which is what made the bias invisible. A null here
    // is indistinguishable from a 404, a rate limit, or a local spawn failure
    // (prospector's ghJson swallows every error), so it is retried and, if it
    // still fails, RECORDED BY NAME rather than folded into a count.
    let meta = null;
    for (let attempt = 0; attempt < 3 && !meta; attempt++) {
      if (attempt > 0) execFileSync(process.platform === "win32" ? "timeout" : "sleep", process.platform === "win32" ? ["/t", "2", "/nobreak"] : ["2"], { stdio: "ignore" });
      try {
        meta = fetchRepoMetadata(repo);
      } catch {
        meta = null;
      }
    }
    if (!meta) {
      rejects["metadata unavailable (after 3 attempts)"] = (rejects["metadata unavailable (after 3 attempts)"] ?? 0) + 1;
      metadataFailures.push({ repo, cell });
      continue;
    }
    const f = filterRepo(meta);
    if (!f.keep) {
      rejects[f.reason] = (rejects[f.reason] ?? 0) + 1;
      continue;
    }
    rows.push({
      repo, cell,
      stars: meta.stars,
      contributorsCount: meta.contributorsCount,
      ownerType: meta.ownerType,
      pushedAt: meta.pushedAt,
      language: meta.language ?? null,
      hasManifest: meta.hasManifest,
      totalCommits: meta.totalCommits,
    });
    if (i % 25 === 0) process.stdout.write(`   ${i}/${candidates.size} checked, ${rows.length} passing\n`);
  }
  process.stdout.write(`   ${i} checked; ${rows.length} PASS filterRepo; ${i - rows.length} rejected\n\n`);

  // --- 3. Select evenly per stratum (NOT by score) --------------------------
  const byCell = new Map();
  for (const r of rows.sort((a, b) => a.repo.localeCompare(b.repo))) {
    const list = byCell.get(r.cell) ?? [];
    if (list.length < TAKE_PER_CELL) list.push(r);
    byCell.set(r.cell, list);
  }
  const selected = [...byCell.values()].flat();
  process.stdout.write(`3. Selected ${selected.length} repos, <=${TAKE_PER_CELL} per stratum, alphabetical within stratum (deterministic, score-blind)\n\n`);

  // --- 4. Clone at pinned SHA ----------------------------------------------
  process.stdout.write("4. Cloning at pinned SHA\n");
  mkdirSync(CORPUS_ROOT, { recursive: true });
  const manifest = [];
  for (const r of selected) {
    const dir = join(CORPUS_ROOT, r.repo.replace("/", "__"));
    let sha = null;
    try {
      if (!existsSync(dir)) {
        execFileSync("git", ["clone", "--depth=1", "--quiet", `https://github.com/${r.repo}.git`, dir], { stdio: ["ignore", "pipe", "pipe"] });
      }
      sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      process.stdout.write(`   CLONE FAILED ${r.repo}\n`);
      continue;
    }
    manifest.push({ ...r, sha, dir: `test-output/icp-corpus/${r.repo.replace("/", "__")}` });
  }
  process.stdout.write(`   ${manifest.length} cloned and pinned\n\n`);

  const artifact = {
    measurement: "E' step one - ICP corpus SOURCING (no scan, no census numbers)",
    date: TODAY,
    isA: "A SAMPLE of ICP-passing repos, not a census. GitHub search caps at 1000 results per query, so the population cannot be enumerated.",
    zeroSpend: {
      structural: "fixor-runner.js (the only module reaching Anthropic) is never imported; the Anthropic path is not in the call graph. No flag is relied on.",
      anthropicCalls: 0,
      network: "gh -> GitHub API only",
    },
    frame: {
      samplingFrame: "ICP MEMBERSHIP via repo metadata. SEARCH_PATTERNS / code search NOT used.",
      whyNotPatterns: "Sourcing by a vulnerability pattern selects on the dependent variable: measuring the prevalence of X in a population chosen for containing X. It would not dent the numbers, it would determine them.",
      membershipTest: "prospector filterRepo() unchanged, no vulns required",
      selection: "<=2 per stratum, alphabetical within stratum. Deterministic and score-blind.",
      scoreRepoDropped: "scoreRepo(meta, vulns) takes the CODE-SEARCH hit list as its second argument. It is a lead-gen ranker and is structurally inseparable from SEARCH_PATTERNS: computing it would require running the pattern search this frame excludes, reintroducing dependent-variable contamination. Dropped. filterRepo requires no vulns and is the entire ICP membership test.",
      strata: { starBands: STAR_BANDS, dateWindows: DATE_WINDOWS.map((w) => w.id), languages: LANGS },
    },
    disclosedBiases: [
      "SAMPLE, NOT CENSUS. GitHub search returns at most 1000 per query; the ICP population cannot be enumerated. Every downstream rate is an estimate from this sample.",
      "CHURN BIAS, mitigated but NOT eliminated. --sort=updated returns the most-recently-pushed repos. Date-window partitioning spreads the sample across three activity strata instead of concentrating it all at 'pushed today', but within each window the draw still clusters near that window's recent edge. The sample is not uniform over the 90-day window.",
      "LANGUAGE SCOPE. Only typescript/javascript were sampled, so every downstream claim is scoped to 'TS/JS ICP repos' and says nothing about Go/Python/Ruby ICP repos, which Fixor also supports.",
      "STAR-BAND CEILING. Bands stop at 1500 (scoreRepo's ICP band) though filterRepo admits up to 5000. Repos in 1500-5000 are ICP-admissible but unsampled.",
      "SEARCH INDEX LAG. GitHub's search index can return a repo whose pushed date is outside the requested window; filterRepo re-checks pushedAt against the live API, so staleness is caught at the membership test rather than entering the sample.",
      "RECONSTRUCTION DEPENDS ON UPSTREAM. Clones are --depth=1 with the SHA recorded; reconstruction (clone + checkout <sha>) requires the SHA to remain reachable upstream. A force-push or repo deletion breaks it.",
    ],
    counts: {
      strataQueried: cells,
      uniqueCandidates: candidates.size,
      metadataChecked: i,
      passedFilterRepo: rows.length,
      rejected: i - rows.length,
      rejectReasons: rejects,
      metadataFailures,
      selected: selected.length,
      cloned: manifest.length,
    },
    repos: manifest,
  };
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`manifest: ${OUT}\n`);
  process.stdout.write(`\nreject breakdown:\n`);
  for (const [k, v] of Object.entries(rejects).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(v).padStart(4)}  ${k}\n`);
  }
}

main();
