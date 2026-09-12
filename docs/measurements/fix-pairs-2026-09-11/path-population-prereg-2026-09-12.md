# Path population for stage P: pre-registration, 2026-09-12

Written and committed BEFORE the instrument is run over the corpus and BEFORE any negative
witness is run. Stage P of selector B needs a draw universe, and only the *counts* of that
universe exist on disk: `selector-b.md`'s sizing table, and the job's own stdout in the
untracked `selector-b-population.txt`. The twelve ordered sha lists the draw consumes were
never written. This file fixes the rule that produces them, by content.

## What this is, and what it is not

IS: a restoration of the instrument that produced the sizing table, extended to emit the
lists, plus a measurement of whether the reproduction check can fail.

IS NOT: a falsification test of anybody's reading of `selector-b.md`. See "The label on the
twelve-row match" below. That distinction is the whole reason this file exists before the
run rather than after it.

## Provenance: the rule is restored, not rewritten

The counting job of 2026-09-11 ran as a stdin heredoc, wrote no script file, printed its
twelve rows and then died in its final JSON write, handing a Git-Bash path to a Windows
Python. Its rows are therefore its own output; nothing in the sizing table is estimated.
It was recovered on 2026-09-12 from the session transcript of the project directory
`D--RAGHAD-JAD-Fixor-Final`, and its three constants are copied verbatim into
`tools/path_population.py`. The rule of record is the rule that produced the table.

## The rule, named by content and not by symbol

`selector-b.md` says "outside the `SKIP_PATH_RE` segments". On the day it was written that
named one rule: all six detector copies and the instrument's own regex agreed. #212 widened
the `secrets-exposure.detector.ts` copy and #213 added `_test.go` to its `SKIP_FILE_RE`, so
the symbol now denotes two different rules depending on which detector is read, and a
session that resolves it against the secrets copy builds a different population. Resolve by
these strings and digests, never by the symbol.

| constant | pattern (verbatim) | flags | sha256 |
|---|---|---|---|
| `EXT` | `\.(js\|jsx\|ts\|tsx\|py\|go\|rb\|java\|kt)$` | IGNORECASE | `8685bb027fc2a5bba06b453ee5ea9c1746c07036db2a6b83b3182aa20852a577` |
| `SKIP` | `(^\|/)(test\|tests\|__tests__\|spec\|fixtures\|examples?\|scripts\|dev-tools\|migrations?\|seed\|seeds\|demo)(/\|$)` | IGNORECASE | `20506ff8246d8c64d3ea5fa465f058069083fb0bc070cda24536fdcf4e3d2652` |
| `GEN` | `(^\|/)(generated\|locales?\|i18n\|translations?\|vendor\|node_modules\|dist\|build)(/\|$)` | IGNORECASE | `1e7ac9af47308900eaff62980110adc9a4920ab12785940118e33ef810fa5aa4` |

Flags are recorded beside the strings and not inside them: `re.I` is not part of a pattern's
source, and a digest that ignored it would be blind to a case-sensitivity change. The
plaintext is recorded beside the digest because a digest alone is undiagnosable: a session
that finds a mismatch needs to see what moved.

Instrument blobs at this commit: `path_population.py` `2526845a`,
`path_population_witness.py` `12db2e07`, `commit-gated.sh` `399e66c5`.

Two prose-against-code checks, run before this file was written, both passed: `SKIP` is
character-identical to `SKIP_PATH_RE` in `admin-check.detector.ts` at `134ca122`, the state
at count time; `GEN` is exactly the ten generated-content segments `selector-b.md` names in
prose, with `locales?` and `translations?` carrying the singular/plural pairs.

## Definitions this pins, where the record is silent

- **Unit.** A population identifier is a NON-MERGE COMMIT reachable from the clone HEAD, not
  a path. A commit qualifies when at least one file it touches passes `EXT` and fails
  `SKIP`. The excluding-generated column additionally requires that at least one such file
  also fails `GEN`.
- **Generated-exclusion semantics.** The recovered job keeps a commit when ANY qualifying
  file is non-generated. The prose admits a second reading, "drop the commit when ANY
  qualifying file is generated", which gives different numbers. The first is the rule; the
  second is carried in the instrument solely so W3 can perturb the READING.
- **Order.** `git log` emission order, as the recovered job walked it. Silent in
  `selector-b.md`, `README.md` and `shape-sample-twenty.md`, all three of which record draw
  order for a SAMPLE and say nothing about the population's sequence, which `random.sample`
  equally depends on. Settled empirically: rebuilding twenty's population under this rule
  with the `packages/twenty-server/src/` prefix reproduces `twenty-server-population.shas`
  identically, in order, 5,689 of 5,689, first identifier `2769f54b959a` in both.
- **The FILE is the draw universe, not the command.** Each list's sha256, its parsed record
  count and its repository HEAD are recorded in the artifact, so a future git that orders
  differently cannot silently move a landed draw.
- **Record counts are parsed, never counted with `wc -l`.** The absence of a trailing
  newline in `twenty-server-population.shas` already produced a 5,688-against-5,689
  discrepancy in a landed artifact. Lists are written with a trailing newline.
- **Renames.** The recovered job did not pass `--no-renames`, so it ran at git's default,
  `diff.renames` true. That was an accident of defaults, not a decision. The AS-RECOVERED
  arm is the population, because it is the instrument that produced the committed table;
  `--no-renames` runs as a control on all twelve and a per-repository divergence is a
  recorded property of the universe, not a defect to repair and not a reason to switch arms.
- **HEAD.** Captured before and after each repository's walk; a difference aborts THAT
  repository and no other. A later HEAD change re-opens that repository's draw and nothing
  else.
- **Trees only.** `GIT_NO_LAZY_FETCH=1` on every git invocation, so a blob fetch is an error
  rather than a silent download. Measured on caddy and documenso before this file was
  written: both rename arms exit 0 and `.git` grows 0 bytes.
- **Quoted paths.** `core.quotePath` prints a non-ASCII path wrapped in quotes, whose
  trailing `"` makes `EXT` fail, so such files are silently excluded. Counted per repository
  and reported rather than assumed: twenty has 0, caddy has 3.
- **Malformed blocks.** The recovered job splits its log on `@@`; a path containing `@@`
  would corrupt a block. Counted per repository, not repaired.

## The label on the twelve-row match

The twelve-row reproduction of the sizing table is a test of CORPUS STABILITY and of this
implementation. It is NOT corroboration that the definition of path population is right, and
must not be recorded as such in any artifact. Recovering the original spent that
independence: running the recovered rule and obtaining the recovered numbers cannot test a
reading that was taken from the same source. Only two legs are claimed, both stated above:
the two prose-against-code checks, and the order-identical reproduction of
`twenty-server-population.shas`, which is a witness on a different artifact built by a
different script.

## Negative witness: predictions, committed before the run

Standing convention in this measurement: a gate earns a negative witness. #212 landed five
negative fixtures, one per new path class, each shown to fire under a neutral path and drop
under its own; #213 did the same for fixture 19; the blind reader instrument earned a
planted live key called real and a planted placeholder not. The reproduction check had none,
so its discriminating power was assumed.

Departure is measured against this instrument's own unperturbed run of the same repository,
never against the sizing table; comparing to the table would borrow the table's authority
and conflate two different claims. Nothing is perturbed in place: the harness imports the
tracked constants, reads them, and passes its own perturbed copies as parameters, so there
is no restoration step to skip. The module's digests are asserted identical before and after.

| arm | repository | perturbation | predicted `path_population` | predicted excluding-generated |
|---|---|---|---|---|
| W1a | discourse | `SKIP` replaced by the widened secrets copy (`scripts?`, `e2e`, `e2e-*`, `api[_-]tests`, `app-tests`) | decrease | decrease |
| W1b | grafana | a `_test\.go$` basename exclusion added, one sub-rule only | decrease | decrease |
| W1b | gitea | same single sub-rule | decrease | decrease |
| W2 | twenty | `GEN` with `locales?` dropped | unchanged | increase |
| W2 | caddy | `GEN` with `locales?` dropped | unchanged | unchanged |
| W3 | twenty | semantics changed to drop-if-any-generated | unchanged | decrease |

Bound, checked on every arm: the excluding-generated count can never exceed the
path-population count. W1a and W1b can only fall, because both perturbations are strictly
wider exclusions. W2 can only rise, bounded above by the path-population column, which `GEN`
does not touch.

**W1a and W1b are not synthetic breaks.** They are the rule a future session actually gets
by resolving "the `SKIP_PATH_RE` segments" against `secrets-exposure.detector.ts`. The drift
this pre-registration exists to prevent is the thing being perturbed.

**W2-caddy is the blind region, and it is recorded rather than hidden.** Four of the twelve
repositories have equal path-population and excluding-generated columns in the sizing table
(caddy 2,234/2,234, full-stack-fastapi-template 236/236, hoppscotch 2,387/2,387, langchain
9,805/9,805). `GEN` removes nothing there, so no perturbation of it can depart, and a
witness run only on caddy would have returned clean under a deliberately broken rule and
been recorded as proof of power. The arm measures that the check's discriminating power is
repository-dependent.

**Consequence, pre-registered.** If any predicted departure fails to appear, that is a STOP.
It is reported, not repaired in the same execution, and the twelve-repository run does not
follow it. The harness exits non-zero.

## The run, if every prediction holds

Twelve repositories, both arms, foreground, `GIT_NO_LAZY_FETCH=1`. Each repository's two
lists and its JSON are written the moment that repository completes, atomically through a
temporary name, so a halt at a repository boundary loses nothing already earned and leaves
no partial list behind. Lists stay untracked in `../drafts-2026-09-11-tree-scan/`, following
the `twenty-server-population.shas` precedent and keeping a public repository lean. One
tracked JSON carries the pinning fields for all twelve.

The draw universe for stage P is the EXCLUDING-GENERATED list, whose twelve rows sum to
157,996 in the sizing table. Both lists are written per repository so that both columns are
reproducible from files rather than from counts alone.

## Cost

Zero. No API key in the environment, no model call, no network: the walk is tree-only and
`GIT_NO_LAZY_FETCH=1` enforces it rather than intending it. The only cost is wall time,
remeasured below what `selector-b.md` records.
