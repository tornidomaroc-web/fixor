# Fix-pair measurement, 2026-09-11: protocol and pre-registration

Purpose: the three numbers per shipped detector on real code that "ready for a first customer"
means (owner's definition): how many known defects it catches, how many it misses, how many
false alarms it raises. Nothing in this repository could state those numbers before this
measurement. The one real-code test before it covered one detector (IDOR, Open WebUI,
`idor-single-file-bound-2026-08-17.json`) and produced no finding on three advisory parents.

This file is committed BEFORE any clone is read. Everything below is fixed at this commit;
a later change to it is a new measurement, not an amendment.

## Case source

Fix commits from twelve of the thirteen step-4 corpus repositories
(`step4-corpus-2026-05-15.json`). LemmyNet/lemmy is excluded before cloning: Rust is outside
the nine languages every detector accepts (`SUPPORTED_LANGS`). Advisory lists are not a
source: the owner's account of an earlier session puts the advisory harvest at 924 advisories
and one valid harvest in nine; that figure is not recorded in this tree and is carried here
as UNVERIFIED until the artifact that measured it is filed.

The clones are blobless (`--filter=blob:none --no-checkout`) in a sibling directory of this
checkout, `../fix-pairs-corpus/<name>`, outside the repository and outside the step-4
evidence clones, which are shallow and must not be touched (manifest instruction). Commit and
tree history is complete; blobs are fetched only when a diff or file is shown.
Measured footprint after cloning and before any history was read (2026-09-11): 697 MB for
the twelve, against 7,464 MB reported by the GitHub API for full clones and a 1.5 GB estimate
stated before cloning. Commit counts on the default branch at clone time are in the
candidate-count artifact.

## Selector: message and path, fixed before searching

Candidates are commits whose message matches at least one keyword in `keywords.json` for a
class AND whose diff touches at least one file with an accepted extension
(js, jsx, ts, tsx, py, go, rb, java, kt) outside the segments every detector skips
(`SKIP_PATH_RE`: test, tests, __tests__, spec, fixtures, example, examples, scripts,
dev-tools, migration, migrations, seed, seeds, demo). Matching is case-insensitive on the
whole message, fixed strings. Content searches (`git log -S` or `-G`) run only over
candidates, never as a selector.

Provenance of the keyword list: derived by a fresh reader that was permitted to read ONLY
`docs/detector-capabilities.md`, the customer-facing class definitions, and never the
detector source; each keyword carries the sentence it came from or is marked as the reader's
own word. `PREFILTER_PATTERNS` was not a source. One limit is visible in the list itself and
is marked per keyword as `pattern_adjacent`: the capabilities document quotes some recognized
tokens (`requireAuth`, `constructEvent`, `timingSafeEqual`, `SECRET_KEY`, `NEXT_PUBLIC_`), so a
keyword derived from such a sentence is definitions-derived by provenance and pattern-shaped
by content. The measuring session added no keyword. A keyword added later carries
`"added_by"` and its origin.

Every candidate is recorded, admitted or not, with its rejection reason, so the yield per
repository and per class is a stated number.

Known, NAMED bias: a message-and-path selector finds only fixes whose authors described
them. Whether that gap is measured (a shape-searched sample on one repository, at a bounded
blob-fetch cost) is a separate decision recorded in this directory when taken. Until then
the bias is UNMEASURED and this sentence is its record.

## Admission (stage 0)

A pair is one file and one answer range. The measuring session reads the diff and writes the
grounds sentence and the answer line range; the record carries the verbatim unified diff
hunk so the judgment can be audited without the clone. A second reader that has never seen
the detector source receives only the hunk and the six class definitions and returns a class
or "none" with one sentence. Agreement admits; disagreement marks the pair CONTESTED and keeps
it, and the contested list with both sentences is what the owner reads. The owner does not
read diffs. Files are left byte-identical; a child that carries a comment asserting the
safety property the fix established is recorded as such, never stripped (D6).

A commit touching several vulnerable files yields one pair per file. A file with two
separated hunks of the same fix yields one pair with a range covering both, stated as such.
Identifiers are 40-hex inside every record; file names carry twelve hex of the child commit.

## Reach (stage 1), keyless, $0.00

One instrument on the zero-spend triple lock of the IDOR structure rig (replay forced on,
replay root an empty directory, key deleted from the child environment; hard assert of zero
successful calls AND zero no-key failures, or the output is discarded). Inputs by environment
variable: pairs directory, clone root. Not wired into `test:ci`. Semantics measured are the
GitHub App path (all nine languages); the CLI walker's six-extension default is recorded as
its own stop reason.

Per pair and per detector it records: stop reason before the model, or the chosen trigger
line and the payload window, and whether the answer range lies inside the window. For
secrets-exposure (regex-only shipped path) and the admin-check literal tier (three patterns)
it records the emitted findings with lines: those two yield all three numbers keyless. The
other four (auth-bypass, idor, env-exposure, webhook-unverified) yield reach counts only.

Rules fixed now:
- Stopped by a documented out-of-scope bound (unsupported language) REMOVES the pair.
- Stopped by anything else (path filter, server-only marker, no trigger, co-location,
  proximity) is a MISS.
- Reaches with the answer range outside the payload window is a MISS by construction
  ("reaches blind"); stage-2 spend is refused for it.
- False alarms are counted only over children that reach; the reaching-children count is
  printed beside the false-alarm count.

The artifact closes with the stage-2 cost: calls = reaching parents + reaching children
(blind excluded), priced at the measured COLD unit (Run 1, 2026-07, about $0.027 per call)
as the upper bound and the measured warm IDOR unit as the estimate, one cache premium per
detector per process. The halt ceiling for stage 2 is the upper bound.

## Verdicts (stage 2), spend, only on the owner's approval by detector

Catch: a finding whose line range covers the answer range on the parent. False alarm: a
finding covering the same range on the child. Population C: every other finding on either
file, an unread count, never merged into false alarms. Right verdict with the wrong reason is
not a catch (rubber-stamp check, `fixtures/_pending/auth-bypass-blanket-use/PREDICTION.md`).
Reasoning logs kept for every call (R2). Cut-down is by detector only, never by pair count.

## Reporting floor, fixed now

Per detector: "k catches of n admissible pairs, m false alarms of r reaching children, c
unread flags", n and r printed beside every figure. Under 10 admissible pairs: cases listed,
no count line. No percentage, interval, or ranking of detectors at any size. The corpus is
mature open source, not the customer's code, and the report says so in its first lines.

## Eleventh-instrument watch list (named before the rig exists)

1. Children that stop before the model make "zero false alarms" a verdict on unread files:
   hence the reaching-children denominator.
2. Message-vocabulary bias in candidate search: hence the keyword provenance, the
   `pattern_adjacent` marks, and the recorded rejections.
3. IDOR emits up to 12 findings per file: a catch is matched by line and every other finding
   on the file is Population C, not a catch.
4. Eight-hex identifiers are not identifiers at this corpus size: 40-hex in every record.
5. A line-by-line probe cannot match a multi-line regex (Open WebUI artifact): the instrument
   calls the detectors' own `detect`, never a port of their patterns.
