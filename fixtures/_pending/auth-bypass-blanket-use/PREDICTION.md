# Pre-registration — blanket-`use()` pair, auth-bypass

Authored 2026-08-16, at `main` 81612614, tree clean, zero open PRs.
**Written before any measurement. Nothing in this directory has been run.**

`.md` is excluded by every fixture reader in the tree, so this file cannot reach a model.

> **PATH MAP, added after the enabling change (`deb2c70`). Nothing below this line is edited.**
> The fixtures have moved into the corpus and been renumbered. Every reference below to
> `positive/01-blanket-use-inverted-claims-guard.ts` now means `fixtures/auth-bypass/positive/23-blanket-use-inverted-claims-guard.ts`,
> and `negative/01-blanket-use-all-covered.ts` now means `fixtures/auth-bypass/negative/24-blanket-use-all-covered.ts`.
> Their `ASSUMED-PATH` headers are unchanged. Selector form for recording: `positive/23` and `negative/24`.

---

## What the pair is

| | file | the one difference |
|---|---|---|
| positive | `positive/01-blanket-use-inverted-claims-guard.ts` | `if (isHoldingBroker)` |
| negative | `negative/01-blanket-use-all-covered.ts` | `if (!isHoldingBroker)` |

**72 code lines each, differing on exactly one line** — the negation operator. Diffed mechanically over the code region alone (hold-out block excluded), so nothing but the operator separates them.

Correction to an earlier figure: this was first reported as "94 code lines, 8 differing lines, 6 of them hold-out pointer text". That split used `[array]::IndexOf` to find the hold-out marker; it returned −1 on the box-drawing characters, so the "code region" was silently the whole file. The conclusion — one negation operator — was right, the numbers were not. Re-measured by locating the marker with `Select-String` line numbers.

Both files: `policiesRouter.use(requireAuth)` once at the top, then eight routes of one shape, none carrying a middleware argument. The eighth (`POST /:id/claims`) creates a claim carrying `amountCents` and `payeeAccount` — money movement — and is the only route with an extra authorization conditional.

In the positive that conditional denies the holding broker and permits every other authenticated caller, so any signed-in user can file a claim against any policy and name the payee. In the negative it is the right way round.

## Why this shape and not another

Two things are under test and they are separable:

1. **Is blanket `router.use(requireAuth)` seen as authentication at all?** The negative answers this. A flag on the negative is a false positive caused by eight empty argument lists.
2. **Is an inverted route-level authorization conditional caught when authentication is blanket?** The positive answers this. A pass on the positive is a false negative.

Symmetry is the point. Because one operator is the only code difference, any divergence in verdict is attributable to it, and any *sameness* on a flag is attributable to the shape rather than the bug.

## Prediction

Read from the shipping prompt in `src/analysis-engine/detectors/auth-bypass.detector.ts`, fingerprint `45a17ae07c26`, byte-identical to what every current cassette recorded under.

**Both files → `authPresent: "yes"`.** L366-377 lists *"a router-level `router.use(requireAuth)` visible in this file"* as a yes-signal, explicitly.

**Negative → `isVulnerable: false`, confidence `high`.**

**Positive → `isVulnerable: false`. This is the claim under test, and it predicts a miss.**

Reasoning. Case 2 (L182-192) is the only rule that decides `isVulnerable` for an Express route, and it is written against the argument list: a route *"has NO authentication/authorization middleware in its argument list"*, with sibling contrast as the strong tell. Here nothing is missing relative to siblings — all eight routes are identical — and the fallback branch applies verbatim: *"If every sibling route on the same router is also unguarded, it is more likely a public router by design — be cautious and prefer medium/low confidence."* Case 1 covers sentinel strings and `|| true`-shaped shortcuts; an inverted `===` on an ownership field is neither. No case in the prompt covers "the route-level authorization conditional is present but backwards."

## What falsifies it

- **Positive returns `isVulnerable: true` and the reasoning names the inverted comparison** → prediction wrong, detector handles this shape. Best outcome.
- **Positive returns `isVulnerable: true` but the reasoning names missing middleware** → right answer, wrong reason. RUBBER-STAMP under the taxonomy in `docs/detector-test-rules.md`, not a catch. Must not be recorded as a pass.
- **Negative returns `isVulnerable: true`** → the blanket-shape false positive. Independent of whatever the positive did.
- **Either file returns `authPresent: "no"`** → L371 is not operative, and the prompt contradicts itself more sharply than predicted.

Joint outcomes:

| negative | positive | reading |
|---|---|---|
| safe | flagged, names inversion | shape handled; prediction wrong |
| safe | safe | **predicted** — clean false negative |
| flagged | flagged | keying on shape, not the bug; worst case |
| flagged | safe | reads the correct guard as the anomaly |

Resolve in the same beat as the run. Leave every value above byte-identical and re-read from git, not from this working file.

## Related instrument finding, measured while authoring

`EXPRESS_ROUTE_DEF_RE` (`src/analysis-engine/detectors/shared/route-def-pattern.ts:45`) includes `use` in its method alternation but requires a string-literal first argument. Tested directly:

- `policiesRouter.use(requireAuth)` → **no match**
- `app.use("/api/policies", requireAuth, r)` → match
- `policiesRouter.get("/", handler)` → match

So the in-router blanket form — the exact form L371 says counts as gating — is invisible to the prefilter. These two fixtures reach the model only incidentally, because their other eight routes trigger (8 matches each, verified). A router module whose only router call is `router.use(requireAuth)` triggers nothing and never reaches the model at all.

## Hold-out status

Not in `fixtures/auth-bypass/`. Not in the manifest in `src/test/specs/auth-bypass.replay-spec.ts`. Nothing reads this directory — verified against each reader:

- `test-auth-bypass-prefilter.ts:33,98` hardcodes `fixtures/auth-bypass/{positive,negative}`
- `stability-harness.ts` is driven by `sourceDir: "fixtures/auth-bypass"`
- `run-fixture-tests.ts:59` reads only `*.json` directly under `fixtures/`, non-recursive
- `measure-stage3-calls.ts:360` uses `fixturesDir: "fixtures/auth-bypass"`
- `tsconfig.json:19` includes only `src/**/*`, so these are not typechecked
- `.gitignore` matches nothing here; line 119 confirms underscored paths under `fixtures/` stay visible

A `.disabled` suffix inside `fixtures/auth-bypass/` was considered and **rejected**. `isFixtureFile` (`stability-harness.ts:356-366`) honours `.disabled`; `test-auth-bypass-prefilter.ts:98-100` does not — it filters only `.md` and dotfiles, and it runs in the `test:ci` chain. CLAUDE.md §5's "the iterator excludes `.disabled`" is true of one reader and false of the other.

**Not verified by execution.** The hold-out above is reasoned from reading each reader, not proved by running `npm run test:ci`. That run is free and keyless and is the negative control this claim still needs.

## Enabling checklist — a paid decision, not a file move

`runReplayGate` fails on `missing recordings for: ...` (`replay-harness.ts:870`). The only way to produce a recording is `record:auth-bypass`, which spends real money **and overwrites frozen evidence** (CLAUDE.md §3). So:

1. Delete the hold-out comment block from both files (F1 — it is model context).
2. Move them into `fixtures/auth-bypass/{positive,negative}/` and renumber.
3. Add both ids to the manifest and to `EXPECTED_FLAGGED` in `auth-bypass.replay-spec.ts`.
4. Update the counts in that spec's header: 45→47 fixtures, 37→39 model-reaching, 22→23 positives, 23→24 negatives.
5. Update `fixtures/auth-bypass/META.md`.
6. Re-read this prediction from git, then record.
