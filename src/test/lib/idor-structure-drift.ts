/**
 * DRIFT GUARD for the shadow's copied pattern arrays.
 *
 * WHY. `idor-structure-shadow.ts` copies SOURCE_PATTERNS and SINK_PATTERNS out of
 * the detector and claims they are verbatim. Sampled validation
 * (`validateShadow`) only exercises the patterns the sample happens to contain:
 * a typo in, say, `rails_class_find` would survive if no sampled file is Ruby.
 * "Verbatim" should be a mechanical fact, not a claim backed by eyeballs.
 *
 * WHAT. Parses the two pattern arrays out of the detector's SOURCE TEXT and
 * requires the shadow's runtime arrays to match entry for entry: same order,
 * same ids, same regex source, same flags, same `lang` restriction.
 *
 * FAIL LOUD, NEVER SILENT. If the parse itself breaks (the detector's formatting
 * changes), this THROWS. A guard that quietly finds zero patterns and reports
 * "no drift" is worse than no guard, so a zero/short parse is an error.
 *
 * The patterns are also the reason this is worth guarding rather than importing:
 * the detector does not export them, and exporting them purely to satisfy a
 * measurement would edit the code under measurement.
 */
import { readFileSync } from "node:fs";

interface ParsedPattern {
  id: string;
  source: string;
  flags: string;
  lang: string[] | null;
}

interface ShadowLike {
  id: string;
  re: RegExp;
  lang?: readonly string[];
}

/**
 * Extract `const NAME: PrefilterPattern[] = [ ... ];` from the detector text.
 * Bounded by the first `];` at column 0-ish so a nested `]` inside a regex
 * cannot end the block early.
 */
function extractArrayBlock(text: string, name: string): string {
  const start = text.indexOf(`const ${name}: PrefilterPattern[] = [`);
  if (start < 0) throw new Error(`drift guard: could not find ${name} in the detector source`);
  const end = text.indexOf("\n];", start);
  if (end < 0) throw new Error(`drift guard: could not find the end of ${name}`);
  return text.slice(start, end);
}

/**
 * Parse `{ id: "x", re: /body/flags, lang: ["py"] }` entries. The regex body is
 * matched non-greedily up to a `/` that is followed by flag letters and then a
 * delimiter, which is what distinguishes the closing slash from an escaped one.
 */
function parseEntries(block: string): ParsedPattern[] {
  const entryRe =
    /\{\s*id:\s*"([^"]+)",\s*re:\s*\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+)\/([a-z]*)\s*(?:,\s*lang:\s*\[([^\]]*)\])?\s*,?\s*\}/g;
  const out: ParsedPattern[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(block)) !== null) {
    out.push({
      id: m[1],
      source: m[2],
      flags: m[3],
      lang: m[4] === undefined ? null : m[4].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean),
    });
  }
  return out;
}

function describe(p: ParsedPattern): string {
  return `${p.id} :: /${p.source}/${p.flags} :: lang=${p.lang ? JSON.stringify(p.lang) : "any"}`;
}

function fromShadow(p: ShadowLike): ParsedPattern {
  return {
    id: p.id,
    source: p.re.source,
    flags: p.re.flags,
    lang: p.lang ? [...p.lang] : null,
  };
}

/**
 * Compare one copied array against the detector's source of truth. Returns
 * human-readable drift lines; empty means verbatim.
 */
export function checkPatternDrift(
  detectorPath: string,
  arrayName: string,
  shadow: ShadowLike[],
  expectedMin: number,
): string[] {
  const text = readFileSync(detectorPath, "utf8");
  const real = parseEntries(extractArrayBlock(text, arrayName));

  // A parse that silently under-collects would make drift invisible.
  if (real.length < expectedMin) {
    throw new Error(
      `drift guard: parsed only ${real.length} entries from ${arrayName} (expected >= ${expectedMin}). ` +
        `The detector's formatting probably changed; FIX THE GUARD rather than lowering the bound.`,
    );
  }

  const drift: string[] = [];
  if (real.length !== shadow.length) {
    drift.push(`${arrayName}: detector has ${real.length} entries, shadow has ${shadow.length}`);
  }
  const n = Math.min(real.length, shadow.length);
  for (let i = 0; i < n; i++) {
    const a = describe(real[i]);
    const b = describe(fromShadow(shadow[i]));
    if (a !== b) drift.push(`${arrayName}[${i}]:\n      detector: ${a}\n      shadow:   ${b}`);
  }
  return drift;
}
