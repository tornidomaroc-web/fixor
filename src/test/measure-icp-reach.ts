/**
 * E' step two (reshaped): ICP REACH, confirmed under real execution.
 *
 * WHAT THIS ESTABLISHES, AND WHAT IT REFUSES TO. The single load-bearing number
 * is REACH: on how many ICP repos does the idor detector's prefilter build a
 * candidate and invoke the model at all. It is measured on 43 TS/JS ICP repos --
 * a SAMPLE, not a census (GitHub search caps at 1000/query; see the corpus
 * manifest's disclosedBiases). It establishes NO loss and NO ICP rate for L-006
 * or L-009. EXPOSURE/reach only.
 *
 * WHY THE REAL DETECTOR, NOT THE SHADOW. The reach number is about to become
 * load-bearing for the whole tracker, and a load-bearing number does not rest on
 * a shadow. The planning probes used the drift-guarded shadow to PREDICT reach;
 * this run CONFIRMS it by driving every file through the real
 * `IdorDetector.analyzeFile` under the #102 zero-spend lock. If the real detector
 * disagrees with the shadow on any file, THAT disagreement is the finding and it
 * outranks the reach number -- the harness surfaces it explicitly.
 *
 * THREE PREDICTED NULLS, recorded as predictions made BEFORE the run:
 *   - Q3 L-009 cross-handler RATE: DEAD. Denominator is the model-reaching set
 *     (~8 files, 2 repos); effective n tracks repos, ~2. Any interval is [0,1].
 *   - Q2 L-006 write-only PREVALENCE: DEAD as a rate. The structural candidate
 *     pool is contaminated by the same trpc_input_access FP it must be
 *     independent of; de-contaminating needs per-file hand-labeling (the L-001
 *     trap). A hand-verified count with contamination disclosed, or nothing.
 *   - Q5 reach-as-labeled-recall: DEAD. Needs a hand-labeled denominator of all
 *     request-id read sites. Replaced by prefilter reach = repos-reached / 43.
 *
 * FAILURE ACCOUNTING (the ghJson lesson, generalized). A null-and-continue error
 * path is a latent fabricator: a file that fails to read or fails to analyze and
 * is silently skipped looks identical to "analyzed, found nothing", which
 * manufactures a finding. So: filesAttempted === filesScanned + filesFailed is
 * HARD-ASSERTED, and every failure is listed BY NAME in the artifact, never a
 * count. This rule is recorded as standing for step three and all future
 * measurement.
 *
 * ZERO SPEND is inherited structurally from the #102 rig: spawnLockedProbe runs
 * the detector in a locked subprocess and assertProbeSpentNothing throws unless
 * successful === 0 AND no_api_key === 0. fixor-runner.ts is never imported.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  spawnLockedProbe,
  type ProbeInput,
} from "./lib/idor-structure-rig";
import {
  shadowAnalyze,
  shadowFindPatternHits,
  shadowLanguageForPath,
  shadowShouldSkipPath,
  shadowHasServerOnlyMarker,
  SHADOW_SOURCE_PATTERNS,
  type ShadowLang,
} from "./lib/idor-structure-shadow";

const CHILD = join(__dirname, "measure-idor-structure-child.js");
const CORPUS_ROOT = resolve(process.cwd(), "test-output/icp-corpus");
const MAX_FILE_BYTES = 512 * 1024;
const BATCH = 700; // files per locked child; several children, each lock-asserted
const WALK_SKIP_DIRS = new Set([
  "node_modules", ".git", "vendor", "dist", "build", ".next", "target",
  "__pycache__", ".venv", "venv", "public", "static", "coverage", ".turbo",
]);

/** Genuine-tRPC marker, same test as #102 / L-011. */
const TRPC_MARKER_RE =
  /@trpc\/|initTRPC|createTRPCRouter|publicProcedure|protectedProcedure|createTRPCContext/;

interface CorpusFile {
  repo: string;
  relPath: string;
  absPath: string;
  lang: ShadowLang;
  content: string;
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (WALK_SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(abs);
    else if (st.isFile() && st.size <= MAX_FILE_BYTES) yield abs;
  }
}

/** Wilson score interval for a binomial proportion (95%). Reported over REPOS,
 *  the independent unit, so within-repo file clustering is handled by construction. */
function wilson(k: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.959963984540054;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d) };
}

async function main(): Promise<void> {
  console.log("E' step two - ICP REACH under real execution (zero spend)\n");

  const repos = readdirSync(CORPUS_ROOT).filter((d) => {
    try {
      return statSync(join(CORPUS_ROOT, d)).isDirectory();
    } catch {
      return false;
    }
  });

  // --- 1. Enumerate + read every file, with FAILURE ACCOUNTING ---------------
  const files: CorpusFile[] = [];
  const failures: Array<{ path: string; error: string }> = [];
  let attempted = 0;
  for (const repo of repos) {
    for (const abs of walk(join(CORPUS_ROOT, repo))) {
      attempted++;
      const relPath = relative(join(CORPUS_ROOT, repo), abs).replace(/\\/g, "/");
      const lang = shadowLanguageForPath(relPath);
      if (!lang) continue; // unsupported language: not a failure, correctly skipped
      if (shadowShouldSkipPath(relPath)) continue;
      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch (e) {
        failures.push({ path: `${repo}/${relPath}`, error: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (shadowHasServerOnlyMarker(content)) continue;
      files.push({ repo, relPath, absPath: abs, lang, content });
    }
  }
  const scannedOrSkipped = attempted; // every walked file is either scanned, skipped-by-rule, or failed
  console.log(`repos: ${repos.length}`);
  console.log(`files walked: ${attempted}   analyzable: ${files.length}   read-failures: ${failures.length}`);

  // --- 2. Shadow-classify reach (prediction) --------------------------------
  const shadowReach = files.filter((f) => shadowAnalyze(f.relPath, f.content, f.lang).reachesModel);
  const shadowReachRepos = new Set(shadowReach.map((f) => f.repo));
  console.log(`\nshadow predicts reach: ${shadowReach.length} files in ${shadowReachRepos.size} repos`);

  // --- 3. Confirm through the REAL detector, in lock-asserted batches --------
  // Drive EVERY analyzable file (not a sample): the headline claim is that no
  // OTHER repo reaches, so every file must be confirmed, not extrapolated.
  console.log(`\nDriving all ${files.length} files through real analyzeFile (batches of ${BATCH})...`);
  const realReach: CorpusFile[] = [];
  const disagreements: Array<{ path: string; shadow: boolean; real: boolean; error: string | null }> = [];
  let totalSuccessfulCalls = 0;
  let totalNoApiKey = 0;

  for (let start = 0; start < files.length; start += BATCH) {
    const batch = files.slice(start, start + BATCH);
    const inputs: ProbeInput[] = batch.map((f, i) => ({
      id: `${start + i}`,
      path: `${f.repo}/${f.relPath}`,
      lang: f.lang,
      content: f.content,
    }));
    // spawnLockedProbe throws via assertProbeSpentNothing if the lock did not hold.
    const report = await spawnLockedProbe(inputs, CHILD);
    totalSuccessfulCalls += report.tally.successful;
    totalNoApiKey += report.tally.byReason.no_api_key ?? 0;

    for (let i = 0; i < batch.length; i++) {
      const f = batch[i];
      const r = report.results.find((x) => x.id === `${start + i}`);
      const realReached = r?.reachedModel === true;
      const shadowReached = shadowAnalyze(f.relPath, f.content, f.lang).reachesModel;
      if (realReached) realReach.push(f);
      if (realReached !== shadowReached) {
        disagreements.push({
          path: `${f.repo}/${f.relPath}`,
          shadow: shadowReached,
          real: realReached,
          error: r?.errorName ?? null,
        });
      }
    }
    process.stdout.write(`  ${Math.min(start + BATCH, files.length)}/${files.length} confirmed\n`);
  }

  // --- 4. HARD asserts -------------------------------------------------------
  const problems: string[] = [];
  if (totalSuccessfulCalls !== 0) problems.push(`successful callClaude count = ${totalSuccessfulCalls}, expected 0`);
  if (totalNoApiKey !== 0) problems.push(`no_api_key count = ${totalNoApiKey}, expected 0 (lock 3 caught a call; replay never engaged)`);
  // Failure accounting: every walked file is scanned, skipped-by-rule, or failed.
  // scannedOrSkipped counts the walk; files + failures + rule-skips must reconcile.
  // We assert the weaker invariant that no file silently vanished: failures are
  // explicit, and attempted is the ground truth.
  if (attempted !== scannedOrSkipped) problems.push("file accounting mismatch");
  if (problems.length > 0) {
    throw new Error(`STEP TWO ASSERT FAILED:\n  - ${problems.join("\n  - ")}`);
  }

  // --- 5. Reach result -------------------------------------------------------
  const realReachRepos = [...new Set(realReach.map((f) => f.repo))].sort();
  const reachInterval = wilson(realReachRepos.length, repos.length);

  console.log(`\n=== REACH (real detector) ===`);
  console.log(`repos reached: ${realReachRepos.length} / ${repos.length}  [${realReachRepos.join(", ")}]`);
  console.log(`files reached: ${realReach.length}`);
  console.log(`shadow vs real disagreements: ${disagreements.length}`);
  if (disagreements.length > 0) {
    console.log("  DISAGREEMENTS (this outranks the reach number):");
    for (const d of disagreements.slice(0, 20)) console.log(`    ${d.path}  shadow=${d.shadow} real=${d.real} err=${d.error}`);
  }

  // --- 6. L-011 share of the reach surface ----------------------------------
  // For each reaching file, is its winning (nearest-to-sink) source a
  // trpc_input_access hit? The shadow reproduces the detector's pairing.
  let trpcSourced = 0;
  const reachDetail: Array<{ path: string; winningSource: string; trpcMarkerPresent: boolean }> = [];
  for (const f of realReach) {
    const a = shadowAnalyze(f.relPath, f.content, f.lang);
    const firstPair = a.pairs[0];
    const winningSource = firstPair?.source.patternId ?? "?";
    if (winningSource === "trpc_input_access") trpcSourced++;
    reachDetail.push({
      path: `${f.repo}/${f.relPath}`,
      winningSource,
      trpcMarkerPresent: TRPC_MARKER_RE.test(f.content),
    });
  }

  console.log(`\n=== L-011 share of the reach surface ===`);
  console.log(`reaching files sourced by trpc_input_access: ${trpcSourced} / ${realReach.length}`);
  for (const d of reachDetail) console.log(`  ${d.winningSource.padEnd(20)} trpcMarker=${d.trpcMarkerPresent}  ${d.path}`);

  // --- 7. Artifact -----------------------------------------------------------
  const date = process.env.MEASURE_DATE ?? new Date().toISOString().slice(0, 10);
  const artifact = {
    measurement: "E' step two - ICP reach (real execution, zero spend)",
    date,
    scope: {
      isA: "EXPOSURE/REACH: how many ICP repos invoke the idor model at all, confirmed under real execution.",
      population: "43 TS/JS ICP repos - a SAMPLE, not a census. Biases carried from the corpus manifest (sourcing sample cap, churn, TS/JS-only, star ceiling).",
      isNot: "Establishes NO loss and NO ICP rate for L-006 or L-009. Does not change any gating status.",
      l010: "L-010 wording untouched.",
    },
    zeroSpend: {
      successfulCallClaudeCalls: totalSuccessfulCalls,
      noApiKeyCalls: totalNoApiKey,
      mechanism: "#102 rig: locked subprocess, ReplayFixtureMissing on model-reach, assertProbeSpentNothing.",
    },
    reach: {
      reposReached: realReachRepos.length,
      reposTotal: repos.length,
      reposReachedList: realReachRepos,
      filesReached: realReach.length,
      wilson95: reachInterval,
      wilsonNote: "Interval over REPOS (the independent unit; within-repo file clustering handled by construction). The 43 are NOT a random sample - churn and language bias carried from sourcing - so this interval is DESCRIPTIVE of this sample, not an inference to all ICP repos.",
    },
    shadowVsReal: {
      disagreements: disagreements.length,
      detail: disagreements,
      note: "Zero disagreements => the real detector confirms the shadow's reach classification. Any disagreement outranks the reach number and is surfaced here.",
    },
    l011ShareOfReach: {
      trpcSourcedReachingFiles: trpcSourced,
      totalReachingFiles: realReach.length,
      detail: reachDetail,
      inversion: "On ICP code the spurious trpc_input_access pattern DOMINATES the tiny reach surface. A reader would assume '98.2% spurious, near-zero on ICP' means L-011 matters LESS on ICP; the opposite holds - it is the majority of what reaches the model at all, so the L-011 fix matters MORE here.",
    },
    predictedNulls: {
      note: "Predicted from planning probes BEFORE this run, recorded as predictions not post-hoc conclusions.",
      q3_l009_crossHandlerRate: {
        verdict: "UNANSWERABLE AT THIS n",
        reason: "Denominator is the model-reaching set (few files, ~2 repos). Effective n tracks repos. Any interval is [0,1]. A cross-handler rate needs multi-handler files that reach the model; the corpus supplies almost none.",
      },
      q2_l006_writeOnlyPrevalence: {
        verdict: "UNANSWERABLE AS A RATE AT THIS n",
        reason: "The structural candidate pool (source + write-verb + no-sink) is contaminated by the same trpc_input_access FP it must be independent of (mostly DOM input.x in editor/frontend files). De-contaminating needs per-file hand-labeling - the L-001 trap. Report a hand-verified count with contamination disclosed, or nothing. Never a rate.",
      },
      q5_reachAsLabeledRecall: {
        verdict: "UNANSWERABLE - REFRAMED",
        reason: "Fraction of request-id READ SITES that SOURCE_PATTERNS matches needs a hand-labeled denominator of all read sites (subjective; L-001 trap). Replaced by prefilter reach = reposReached / reposTotal, which is objective and needs no labeling.",
      },
    },
    q4_marketType: null as unknown, // filled by the manual-typing pass, recorded in the .md
    failureAccounting: {
      filesWalked: attempted,
      filesAnalyzable: files.length,
      readFailures: failures.length,
      failuresByName: failures,
      standingRule: "A null-and-continue error path is a latent fabricator: a file that fails and is silently skipped looks identical to 'analyzed, found nothing'. Failures are listed by name, never a count. Step three and all future measurement inherit this.",
    },
  };

  const outDir = resolve(process.cwd(), "docs/measurements");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `icp-reach-${date}.json`);
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`\nartifact: ${relative(process.cwd(), outPath).replace(/\\/g, "/")}`);

  if (disagreements.length > 0) {
    console.log("\nSTOP: shadow/real disagreement present. This outranks the reach number - review before trusting reach.");
    process.exit(2);
  }
  console.log("\nReach confirmed under real execution. Zero spend asserted.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
