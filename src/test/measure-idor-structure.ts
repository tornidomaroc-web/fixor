/**
 * idor STRUCTURAL EXPOSURE measurement rig (L-006 / L-009 / trpc_input_access).
 *
 * WHAT IT PRODUCES, AND WHAT IT REFUSES TO PRODUCE.
 *
 *   B. Mechanism witnesses, under EXECUTION, on constructed inputs. Construction
 *      is the ground truth: we authored the vulnerability, so we know it is
 *      there. No AST, no inference.
 *   C. `trpc_input_access` pattern-specificity on the 13-repo step-4 corpus,
 *      shadow-validated against the real detector before any count is trusted.
 *
 * IT EMITS NO RATE. Not from the constructed inputs, not from the 26 replay
 * fixtures, not from the 13-repo corpus. Two questions are DEFERRED to E' on the
 * ICP corpus and are named in the artifact:
 *   - L-009 cross-handler RATE: how often real ICP code produces a cross-handler
 *     pair. This rig witnesses the mechanism; it does not count its incidence.
 *   - L-006 write-only PREVALENCE: how often real ICP code contains a
 *     write-with-no-read handler. This is the question that decides whether the
 *     witnessed L-006 miss costs anything, and it is the reason L-006 stays
 *     NON-gating.
 *
 * WHY THE 13-REPO CORPUS CANNOT CARRY A RATE. It is mature OSS, not Fixor's ICP.
 * STEP4-PRODUCTION-VALIDATION.md section 3 disqualified it for rate claims: it
 * produced zero true positives, so precision is 0/0. That same section is
 * explicit about what the corpus IS good for -- "[fixture corpora] are
 * predictive at the pattern-matching axis, which is why FPs are abundant."
 * Pattern-specificity is a pattern-matching-axis question. That is the ONLY axis
 * this rig uses it on.
 *
 * NOT WIRED INTO test:ci ON PURPOSE. It depends on `test-output/step4-scans/
 * repos`, which is gitignored and absent on runners. In CI it would fail for
 * lack of a corpus, not for a regression. Run it by hand: `npm run
 * measure:idor-structure`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  CONSTRUCTED_INPUTS,
  L006_READ_CONTROL,
  L006_WRITE_ONLY,
  L009_CROSS_HANDLER,
  L009_HANDLER_A_LINES,
  L009_HANDLER_B_LINES,
} from "./lib/idor-structure-inputs";
import { checkPatternDrift } from "./lib/idor-structure-drift";
import {
  spawnLockedProbe,
  type HarvestedPair,
  type ProbeFileResult,
  type ProbeInput,
} from "./lib/idor-structure-rig";
import {
  shadowAnalyze,
  shadowEnumerateSinkPairs,
  shadowFindPatternHits,
  shadowHasServerOnlyMarker,
  shadowLanguageForPath,
  shadowShouldSkipPath,
  SHADOW_SINK_PATTERNS,
  SHADOW_SOURCE_PATTERNS,
  type ShadowLang,
} from "./lib/idor-structure-shadow";

const CHILD = join(__dirname, "measure-idor-structure-child.js");
const CORPUS_ROOT = resolve(process.cwd(), "test-output/step4-scans/repos");
const MAX_FILE_BYTES = 512 * 1024;
const WALK_SKIP_DIRS = new Set([
  "node_modules", ".git", "vendor", "dist", "build", ".next", "target",
  "__pycache__", ".venv", "venv", "public", "static",
]);

/** Evidence that a TS file is genuinely tRPC. Absence => the source is spurious. */
const TRPC_MARKER_RE =
  /@trpc\/|initTRPC|createTRPCRouter|publicProcedure|protectedProcedure|createTRPCContext|\.input\s*\(/;

const failures: string[] = [];

function check(name: string, ok: boolean, detail: string): boolean {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}\n        ${detail}`);
    failures.push(`${name}: ${detail}`);
  }
  return ok;
}

function byId(results: ProbeFileResult[], id: string): ProbeFileResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no probe result for ${id}`);
  return r;
}

// ---------------------------------------------------------------------------
// B. Mechanism witnesses on constructed inputs.
// ---------------------------------------------------------------------------

interface WitnessReport {
  l006: {
    writeOnly: { findingCount: number; reachedModel: boolean; preFilterReason: string | null; triggerCount: number };
    readControl: { findingCount: number; reachedModel: boolean; preFilterReason: string | null };
    verdict: string;
  };
  l009: {
    reachedModel: boolean;
    errorName: string | null;
    pairs: HarvestedPair[];
    crossHandler: boolean;
    handlerA: { start: number; end: number };
    handlerB: { start: number; end: number };
    verdict: string;
  };
}

function witnessL006(results: ProbeFileResult[]): WitnessReport["l006"] {
  console.log("\nB1. L-006 - unguarded ORM write with no read");
  const w = byId(results, L006_WRITE_ONLY.id);
  const c = byId(results, L006_READ_CONTROL.id);

  check(
    "write-only: analyzeFile returns []",
    w.findingCount === 0,
    `got ${w.findingCount} findings`,
  );
  check(
    "write-only: model NEVER reached (no ReplayFixtureMissing)",
    !w.reachedModel,
    `reachedModel=${w.reachedModel} errorName=${w.errorName}`,
  );
  check(
    "write-only: dropped at the :803-807 early return",
    w.preFilterReason === "no source/sink co-occurrence",
    `preFilterReason=${JSON.stringify(w.preFilterReason)}`,
  );
  // The control is what turns "this file returned []" into "the VERB caused it".
  check(
    "read control: SAME shape with findUnique DOES reach the model",
    c.reachedModel,
    `reachedModel=${c.reachedModel} preFilterReason=${JSON.stringify(c.preFilterReason)}`,
  );

  const isolated = !w.reachedModel && c.reachedModel;
  return {
    writeOnly: {
      findingCount: w.findingCount,
      reachedModel: w.reachedModel,
      preFilterReason: w.preFilterReason,
      triggerCount: w.triggerCount,
    },
    readControl: {
      findingCount: c.findingCount,
      reachedModel: c.reachedModel,
      preFilterReason: c.preFilterReason,
    },
    verdict: isolated
      ? "WITNESSED: a genuine unguarded write-variant IDOR is dropped before the model. " +
        "The read control, identical but for the ORM verb, reaches the model - so the verb is the cause."
      : "NOT WITNESSED (see failures)",
  };
}

function witnessL009(results: ProbeFileResult[]): WitnessReport["l009"] {
  console.log("\nB2. L-009 - source in handler A paired to sink in handler B");
  const r = byId(results, L009_CROSS_HANDLER.id);

  check(
    "reaches callLlm (observable as ReplayFixtureMissing under the lock)",
    r.reachedModel,
    `errorName=${r.errorName} preFilterReason=${JSON.stringify(r.preFilterReason)}`,
  );
  check(
    "throws ReplayFixtureMissing (not some other error)",
    r.errorName === "ReplayFixtureMissing",
    `errorName=${r.errorName} message=${r.errorMessage}`,
  );
  check(
    "harvested exactly one candidate pair",
    r.pairs.length === 1,
    `got ${r.pairs.length} pairs: ${JSON.stringify(r.pairs)}`,
  );

  const p = r.pairs[0];
  const inA = p !== undefined && p.sourceLine >= L009_HANDLER_A_LINES.start && p.sourceLine <= L009_HANDLER_A_LINES.end;
  const inB = p !== undefined && p.sinkLine >= L009_HANDLER_B_LINES.start && p.sinkLine <= L009_HANDLER_B_LINES.end;
  const crossHandler = inA && inB;

  check(
    "the REAL candidate block shows the pair crossing the two handlers",
    crossHandler,
    p
      ? `source line ${p.sourceLine} (handler A is ${L009_HANDLER_A_LINES.start}-${L009_HANDLER_A_LINES.end}) -> ` +
        `sink line ${p.sinkLine} (handler B is ${L009_HANDLER_B_LINES.start}-${L009_HANDLER_B_LINES.end})`
      : "no pair harvested",
  );

  if (p) {
    console.log(`        harvested: [${p.pairIndex}] SOURCE line ${p.sourceLine}: ${p.sourceText}`);
    console.log(`                       -> SINK line ${p.sinkLine}: ${p.sinkText}`);
  }

  return {
    reachedModel: r.reachedModel,
    errorName: r.errorName,
    pairs: r.pairs,
    crossHandler,
    handlerA: { ...L009_HANDLER_A_LINES },
    handlerB: { ...L009_HANDLER_B_LINES },
    verdict: crossHandler
      ? "WITNESSED: the detector built a source->sink pair spanning two unrelated route handlers and sent it to the model. " +
        "The file contains no IDOR; the flow does not exist. EXPOSURE (wasted pair slot + model attention), not a miss."
      : "NOT WITNESSED (see failures)",
  };
}

// ---------------------------------------------------------------------------
// C. trpc_input_access specificity on the 13-repo corpus.
// ---------------------------------------------------------------------------

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

/**
 * Load the corpus through the SAME pre-model filters production applies
 * (`languageForPath`, `shouldSkipPath`, `hasServerOnlyMarker`). Counting raw
 * files would inflate every number with code the detector never sees.
 */
function loadCorpus(): { files: CorpusFile[]; repos: string[]; skipped: Record<string, number> } {
  const repos = readdirSync(CORPUS_ROOT).filter((d) =>
    statSync(join(CORPUS_ROOT, d)).isDirectory(),
  );
  const files: CorpusFile[] = [];
  const skipped = { unsupportedLang: 0, pathFilter: 0, serverOnly: 0, unreadable: 0 };

  for (const repo of repos) {
    for (const abs of walk(join(CORPUS_ROOT, repo))) {
      const relPath = relative(join(CORPUS_ROOT, repo), abs).replace(/\\/g, "/");
      const lang = shadowLanguageForPath(relPath);
      if (!lang) { skipped.unsupportedLang++; continue; }
      if (shadowShouldSkipPath(relPath)) { skipped.pathFilter++; continue; }
      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch { skipped.unreadable++; continue; }
      if (shadowHasServerOnlyMarker(content)) { skipped.serverOnly++; continue; }
      files.push({ repo, relPath, absPath: abs, lang, content });
    }
  }
  return { files, repos, skipped };
}

/**
 * Shadow validation. Drives a SAMPLE of real corpus files through the real
 * detector under the zero-spend lock and requires the shadow to predict the
 * harvested candidate block pair-for-pair. Any mismatch aborts before a single
 * corpus number is reported.
 */
async function validateShadow(files: CorpusFile[]): Promise<{
  patternDrift: string[];
  sampleSize: number;
  matched: number;
  mismatches: string[];
}> {
  console.log("\nC1. Shadow validation");

  // C1a. Structural: the copied pattern arrays must be VERBATIM. Sampled
  // validation below only exercises patterns the sample contains, so a typo in
  // an unexercised pattern would survive it. This closes that hole.
  const detectorPath = resolve(process.cwd(), "src/analysis-engine/detectors/idor.detector.ts");
  const patternDrift = [
    ...checkPatternDrift(detectorPath, "SOURCE_PATTERNS", SHADOW_SOURCE_PATTERNS, 17),
    ...checkPatternDrift(detectorPath, "SINK_PATTERNS", SHADOW_SINK_PATTERNS, 15),
  ];
  check(
    "shadow pattern arrays are verbatim copies of the detector's",
    patternDrift.length === 0,
    patternDrift.join("\n        "),
  );

  // Sample only files the shadow says reach the model: a file with no pairs
  // produces no candidate block, so it cannot discriminate shadow from real.
  // Spread across repos so one framework cannot carry the validation.
  const reaching = files.filter((f) => shadowAnalyze(f.relPath, f.content, f.lang).reachesModel);
  const byRepo = new Map<string, CorpusFile[]>();
  for (const f of reaching) {
    const list = byRepo.get(f.repo) ?? [];
    if (list.length < 2) list.push(f);
    byRepo.set(f.repo, list);
  }
  const sample = [...byRepo.values()].flat().slice(0, 20);
  if (sample.length === 0) throw new Error("shadow validation: no sample files reach the model");

  const inputs: ProbeInput[] = sample.map((f, i) => ({
    id: `shadow-${i}`,
    path: `${f.repo}/${f.relPath}`,
    lang: f.lang,
    content: f.content,
  }));

  const report = await spawnLockedProbe(inputs, CHILD);

  const mismatches: string[] = [];
  let matched = 0;
  for (let i = 0; i < sample.length; i++) {
    const f = sample[i];
    const real = byId(report.results, `shadow-${i}`);
    const predicted = shadowAnalyze(f.relPath, f.content, f.lang).pairs;

    if (predicted.length !== real.pairs.length) {
      mismatches.push(
        `${f.repo}/${f.relPath}: shadow predicted ${predicted.length} pairs, real emitted ${real.pairs.length}`,
      );
      continue;
    }
    let ok = true;
    for (let k = 0; k < predicted.length; k++) {
      const ps = predicted[k];
      const rs = real.pairs[k];
      if (ps.source.line !== rs.sourceLine || ps.sink.line !== rs.sinkLine) {
        mismatches.push(
          `${f.repo}/${f.relPath} pair[${k}]: shadow ${ps.source.line}->${ps.sink.line}, real ${rs.sourceLine}->${rs.sinkLine}`,
        );
        ok = false;
        break;
      }
    }
    if (ok) matched++;
  }

  check(
    `shadow reproduces the real candidate block on all ${sample.length} sampled files`,
    mismatches.length === 0,
    mismatches.slice(0, 5).join("; "),
  );
  console.log(`        sample: ${sample.length} files across ${byRepo.size} repos; matched ${matched}`);
  return { patternDrift, sampleSize: sample.length, matched, mismatches };
}

interface TrpcReport {
  corpus: { repos: string[]; filesScanned: number; skipped: Record<string, number> };
  fires: {
    files: number;
    hits: number;
    byLang: Record<string, number>;
    byRepo: Record<string, number>;
  };
  spurious: {
    nonTsFiles: number;
    nonTsHits: number;
    tsWithoutTrpcMarkerFiles: number;
    tsWithoutTrpcMarkerHits: number;
    totalSpuriousFiles: number;
    genuineCandidateFiles: number;
    /**
     * Files whose first hit sits inside a quoted string on its line. HEURISTIC
     * (line-level, not a parse) and reported as one: it is indicative of the
     * failure mode (CSS selectors, filenames), not a precise count.
     */
    firstHitInsideQuotedStringFiles: number;
  };
  amplification: {
    pairsWithTrpcSource: number;
    pairsCreatedByTrpc: number;
    pairsHijackedByTrpc: number;
    filesReachingModelOnlyBecauseOfTrpc: number;
  };
  examples: Array<{ repo: string; path: string; lang: string; line: number; text: string; kind: string }>;
}

function measureTrpc(files: CorpusFile[], repos: string[], skipped: Record<string, number>): TrpcReport {
  console.log("\nC2. trpc_input_access specificity (pattern-matching axis only)");

  const trpcPattern = SHADOW_SOURCE_PATTERNS.filter((p) => p.id === "trpc_input_access");
  const withoutTrpc = SHADOW_SOURCE_PATTERNS.filter((p) => p.id !== "trpc_input_access");

  const rep: TrpcReport = {
    corpus: { repos, filesScanned: files.length, skipped },
    fires: { files: 0, hits: 0, byLang: {}, byRepo: {} },
    spurious: {
      nonTsFiles: 0, nonTsHits: 0,
      tsWithoutTrpcMarkerFiles: 0, tsWithoutTrpcMarkerHits: 0,
      totalSpuriousFiles: 0, genuineCandidateFiles: 0,
      firstHitInsideQuotedStringFiles: 0,
    },
    amplification: {
      pairsWithTrpcSource: 0, pairsCreatedByTrpc: 0,
      pairsHijackedByTrpc: 0, filesReachingModelOnlyBecauseOfTrpc: 0,
    },
    examples: [],
  };

  for (const f of files) {
    const trpcHits = shadowFindPatternHits(f.content, trpcPattern, f.lang);
    if (trpcHits.length === 0) continue;

    rep.fires.files++;
    rep.fires.hits += trpcHits.length;
    rep.fires.byLang[f.lang] = (rep.fires.byLang[f.lang] ?? 0) + trpcHits.length;
    rep.fires.byRepo[f.repo] = (rep.fires.byRepo[f.repo] ?? 0) + trpcHits.length;

    // tRPC is a TypeScript-only framework. A hit in Go/Java/Python/Ruby cannot
    // be a tRPC input access -- no judgment call, no sampling.
    const isTs = f.lang === "ts" || f.lang === "tsx";
    let spurious = false;
    if (!isTs) {
      rep.spurious.nonTsFiles++;
      rep.spurious.nonTsHits += trpcHits.length;
      spurious = true;
    } else if (!TRPC_MARKER_RE.test(f.content)) {
      rep.spurious.tsWithoutTrpcMarkerFiles++;
      rep.spurious.tsWithoutTrpcMarkerHits += trpcHits.length;
      spurious = true;
    } else {
      rep.spurious.genuineCandidateFiles++;
    }
    if (spurious) rep.spurious.totalSpuriousFiles++;
    if (/["'][^"']*\binput\.\w+/.test(trpcHits[0].patternText)) {
      rep.spurious.firstHitInsideQuotedStringFiles++;
    }

    // Sample per KIND, not first-come: the walk order is alphabetical by repo,
    // so an unbalanced cap would fill entirely with whichever repo sorts first
    // and misrepresent the corpus.
    if (spurious) {
      const kind = isTs ? "ts-without-trpc-marker" : "non-typescript-language";
      const ofKind = rep.examples.filter((e) => e.kind === kind).length;
      if (ofKind < 6) {
        rep.examples.push({
          repo: f.repo, path: f.relPath, lang: f.lang,
          line: trpcHits[0].line, text: trpcHits[0].patternText,
          kind,
        });
      }
    }

    // --- L-009 amplification -------------------------------------------------
    // More sources inside a 200-line window means more chances for a spurious
    // source to win "nearest" and be handed to the model as the origin of a
    // flow. Measured by re-running the real pairing with this ONE pattern
    // removed and diffing.
    const sinkHits = shadowFindPatternHits(f.content, SHADOW_SINK_PATTERNS, f.lang);
    if (sinkHits.length === 0) continue;

    const allSources = shadowFindPatternHits(f.content, SHADOW_SOURCE_PATTERNS, f.lang);
    const baseSources = shadowFindPatternHits(f.content, withoutTrpc, f.lang);
    const withPairs = shadowEnumerateSinkPairs(allSources, sinkHits).pairs;
    const withoutPairs = baseSources.length === 0
      ? []
      : shadowEnumerateSinkPairs(baseSources, sinkHits).pairs;

    const withoutBySink = new Map(withoutPairs.map((p) => [p.sink.line, p]));
    for (const p of withPairs) {
      if (p.source.patternId !== "trpc_input_access") continue;
      rep.amplification.pairsWithTrpcSource++;
      const before = withoutBySink.get(p.sink.line);
      if (!before) {
        // The sink had NO source within 200 lines without this pattern: the
        // pair exists purely because trpc_input_access fired.
        rep.amplification.pairsCreatedByTrpc++;
      } else if (before.source.line !== p.source.line) {
        // A real source existed, but the trpc hit was nearer and displaced it:
        // the model is shown the WRONG origin for a real sink.
        rep.amplification.pairsHijackedByTrpc++;
      }
    }
    if (withPairs.length > 0 && withoutPairs.length === 0) {
      rep.amplification.filesReachingModelOnlyBecauseOfTrpc++;
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1));
  console.log(`        files scanned (post-filter): ${rep.corpus.filesScanned} across ${repos.length} repos`);
  console.log(`        trpc_input_access fires in:  ${rep.fires.files} files / ${rep.fires.hits} hits`);
  console.log(`        languages:                   ${JSON.stringify(rep.fires.byLang)}`);
  console.log(`        spurious (non-TypeScript):   ${rep.spurious.nonTsFiles} files / ${rep.spurious.nonTsHits} hits`);
  console.log(`        spurious (TS, no tRPC):      ${rep.spurious.tsWithoutTrpcMarkerFiles} files / ${rep.spurious.tsWithoutTrpcMarkerHits} hits`);
  console.log(`        first hit inside a string:   ${rep.spurious.firstHitInsideQuotedStringFiles} files (heuristic)`);
  console.log(`        plausibly genuine tRPC:      ${rep.spurious.genuineCandidateFiles} files`);
  console.log(`        => spurious share of files:  ${pct(rep.spurious.totalSpuriousFiles, rep.fires.files)}%`);
  console.log(`        L-009 amplification:`);
  console.log(`          pairs sourced by trpc:     ${rep.amplification.pairsWithTrpcSource}`);
  console.log(`          pairs CREATED by trpc:     ${rep.amplification.pairsCreatedByTrpc}`);
  console.log(`          pairs HIJACKED by trpc:    ${rep.amplification.pairsHijackedByTrpc}`);
  console.log(`          files reaching model only because of trpc: ${rep.amplification.filesReachingModelOnlyBecauseOfTrpc}`);
  return rep;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("idor structural exposure - measurement rig");
  console.log("zero spend: FIXOR_REPLAY=1 + empty FIXOR_REPLAY_ROOT + no ANTHROPIC_API_KEY\n");

  console.log("B. MECHANISM WITNESSES (constructed inputs; construction is ground truth)");
  const witnessProbe = await spawnLockedProbe(CONSTRUCTED_INPUTS, CHILD);
  console.log(
    `  zero-spend assert: successful callClaude calls = ${witnessProbe.tally.successful} ` +
      `(attempted ${witnessProbe.tally.attempted}, failed ${witnessProbe.tally.failed})`,
  );

  const l006 = witnessL006(witnessProbe.results);
  const l009 = witnessL009(witnessProbe.results);

  let trpc: TrpcReport | null = null;
  let shadow: {
    patternDrift: string[];
    sampleSize: number;
    matched: number;
    mismatches: string[];
  } | null = null;

  if (!existsSync(CORPUS_ROOT)) {
    console.log(`\nC. SKIPPED - corpus not present at ${CORPUS_ROOT}`);
    console.log("   (gitignored; C is a local-only measurement)");
  } else {
    console.log("\nC. trpc_input_access SPECIFICITY (13-repo step-4 corpus)");
    const { files, repos, skipped } = loadCorpus();
    shadow = await validateShadow(files);
    if (shadow.mismatches.length > 0 || shadow.patternDrift.length > 0) {
      // Refuse to report a count from an unvalidated shadow. Drift and sample
      // mismatch are both disqualifying: a count is only as good as the shadow.
      console.log("\n  shadow != real; REFUSING to emit a corpus count.");
    } else {
      trpc = measureTrpc(files, repos, skipped);
    }
  }

  const date = process.env.MEASURE_DATE ?? new Date().toISOString().slice(0, 10);
  const artifact = {
    measurement: "idor structural exposure (L-006 / L-009 / trpc_input_access)",
    date,
    scope: {
      isA: "EXPOSURE: detector mechanisms witnessed under execution on constructed inputs.",
      isNot: "NOT LOSS. No missed vulnerability in real ICP code is claimed, and no rate is emitted.",
      gating:
        "Does NOT make L-006 or L-009 READY-gating. L-006 is a WITNESSED conditional miss whose " +
        "PREVALENCE on ICP-shaped code is unknown; that unknown, not the absence of a witness, is " +
        "why it stays non-gating. L-009 is precision-only and remains UNWITNESSED in the tracker's " +
        "sense of the word (no missed vulnerability demonstrated).",
      deferredToEPrime: [
        "L-009 cross-handler RATE - how often real ICP code produces a cross-handler pair. " +
          "This rig witnesses the mechanism; it does not count incidence.",
        "L-006 write-only PREVALENCE - how often real ICP code contains a write-with-no-read handler. " +
          "This is the question that decides whether the witnessed L-006 miss costs anything.",
      ],
      corpusLimit:
        "The 13-repo corpus is mature OSS, not Fixor's ICP, and is disqualified for rates by " +
        "STEP4-PRODUCTION-VALIDATION.md section 3 (zero true positives => precision is 0/0). It is used " +
        "here ONLY on the pattern-matching axis, which that same section states it IS predictive on.",
    },
    zeroSpend: {
      locks: ["FIXOR_REPLAY=1", "empty FIXOR_REPLAY_ROOT temp dir", "no ANTHROPIC_API_KEY"],
      successfulCallClaudeCalls: witnessProbe.tally.successful,
      assert: "HARD: successful === 0 AND no_api_key === 0 (the latter proves replay engaged, not that the key was merely absent)",
    },
    witnesses: { l006, l009 } satisfies WitnessReport,
    trpcSpecificity: trpc,
    shadowValidation: shadow,
    failures,
  };

  const outDir = resolve(process.cwd(), "docs/measurements");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `idor-structure-${date}.json`);
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`\nartifact: ${relative(process.cwd(), outPath).replace(/\\/g, "/")}`);

  if (failures.length > 0) {
    console.log(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll witnesses hold. Zero spend asserted.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
