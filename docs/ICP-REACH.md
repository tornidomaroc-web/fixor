# ICP reach — the idor detector reaches the model on 2 of 43 ICP repos

**Date:** 2026-07-17
**Rig:** `src/test/measure-icp-reach.ts` (`npm run measure:icp-reach`)
**Data:** `docs/measurements/icp-reach-2026-07-17.json`
**Corpus:** the 43 SHA-pinned TS/JS ICP repos from `docs/measurements/icp-corpus-2026-07-17.json`
**Spend:** $0.00, asserted (`successful === 0` and `no_api_key === 0`).

---

## 1. Scope — read before quoting

This measures **REACH**: on how many ICP repos does the idor detector's prefilter build a candidate pair and invoke the model *at all*. It is **EXPOSURE/reach**, confirmed under real execution.

- **Population:** 43 TS/JS ICP repos — a **SAMPLE, not a census**. GitHub search caps at 1000 results/query; the biases carried from sourcing (churn, TS/JS-only, star ceiling) are in the corpus manifest.
- **It establishes NO loss** and **no ICP rate** for L-006 or L-009.
- **It changes no gating status.** Whether reach = 2/43 *should* change anything on the tracker is a readiness call and is the owner's; it is raised separately from this artifact, not decided here. **L-010 wording untouched.**

---

## 2. The headline — reach = 2 / 43 repos

Every one of the **3,987** analyzable files across the 43 repos was driven through the real `IdorDetector.analyzeFile` under the #102 zero-spend lock. Not a sample — all of them, because the claim is that *no other repo reaches*, which must be confirmed per file, not extrapolated.

| | |
| --- | --- |
| **Repos where the model is reached** | **2 / 43** — `azirbel/npoint`, `jasonkneen/tiny-world-builder` |
| Files reaching the model | **8** (7 in tiny-world-builder, 1 in npoint) |
| Wilson 95% interval (over repos) | **[1.3%, 15.5%]** |
| Files driven through the real detector | 3,987 |
| Read failures | 0 |
| **Shadow vs. real disagreements** | **0** |

**The real detector confirms the shadow exactly** — zero disagreements across 3,987 files. The planning probes predicted 2/43 with the drift-guarded shadow; the real detector agrees on every file. The load-bearing number rests on the real detector.

**The Wilson interval is descriptive, not inferential.** It is computed over repos (the independent unit, so within-repo file clustering is handled by construction). But the 43 are **not a random sample** — churn and language bias carried from sourcing — so [1.3%, 15.5%] describes *this sample*; it is not an inference to all ICP repos.

**Reach is not brokenness.** When a repo *is* a server app that does id-based DB lookups, the detector reaches it fine (both repos that reach are exactly that). The finding is that **41 of 43 ICP repos are not that kind of app.**

---

## 3. L-011 dominates the tiny reach surface — the inversion

Of the 8 files that reach the model, **7 are sourced by `trpc_input_access`** — and **none of the 7 contains a tRPC marker** (`trpcMarker=false` on all). The one non-trpc reach is npoint's Rails controller (`rails_params_sym`).

```
rails_params_sym    npoint/app/controllers/api/documents_controller.rb
trpc_input_access   tiny-world-builder/netlify/functions/{admin-users,assets,avatar,builds,collectibles,preferences,share}.mjs
```

**The inversion a reader would get backwards.** From #102 — "`trpc_input_access` is 98.2% spurious" — plus "reach is near-zero on ICP," the natural inference is *the L-011 fix matters less on ICP*. **The opposite holds.** The spurious pattern is the source of **7 of the 8 files that reach the model at all**, so on ICP code it is the *majority of the entire reach surface*. Fixing L-011 matters **more** here, not less: it is most of what the detector reacts to on real ICP code.

**What the 7 actually are (characterized, not model-judged).** In `assets.mjs`, `const input = validateAssetInput(await readJson(request))` — so `input.X` *is* request-derived, but the pattern matched `input.class` / `input.name` (column *data* in an INSERT), while the SQL is ownership-scoped by `profile_id = ${profile.id}` (auth-derived). So `trpc_input_access` fired **without any tRPC present** and manufactured a candidate pair on **already-guarded** code. Whether the model would clear these is a verdict question this zero-spend run does not answer — but the *reach* is driven by the L-011 pattern, on code that is scoped correctly.

---

## 4. Q4 — most ICP repos are not the kind of app IDOR detection applies to

Per-repo type, assigned by manual judgment from `package.json` shape, dependencies, directory layout, and description. **This is a characterization, not a computed fraction:** the automated server-detector already false-negatived on `npoint`'s Rails controller (it matched only JS/Python/Go frameworks), so "server code" has no clean regex boundary and the exact number is not machine-derivable.

| Type | ~count | Examples |
| --- | --- | --- |
| Library / SDK (published package) | ~18 | har-validator, react-advanced-cropper, vue3-jsoneditor, use-undo, bonsai-js, inertia-adapter-solid, apollo-server-integration-fastify (a lib *for* a server, not one), delete-artifact (GH action) |
| Frontend / static site | ~9 | track3, xin-wen-lian-bo, outage-data-ua, Robohash, mesurer |
| Browser extension / clientside app | ~5 | YAAW-for-Chrome, dokieli, web-esheep |
| CLI tool | ~4 | eyo, 0xweb, e2yo |
| **Web app with server route handlers** | **~7** | npoint (Rails), tiny-world-builder (netlify fns), every-pdf (next+backend), Queen-Riam (express), better-auth |

The boundary cases are judgment calls (e.g. `apollo-server-integration-fastify` is a library that *targets* servers but is not one), which is exactly why this is prose, not a percentage. **The direction is unambiguous:** the majority of ICP repos are libraries, components, extensions, and CLIs with no HTTP route handler. Even among the ~7 web apps, only **2** produced an id-based DB-lookup flow the detector reaches. That is a finding about **Fixor's market**, and it may be the most consequential number in the census: IDOR detection applies to a small minority of what the ICP actually ships.

---

## 5. The predicted nulls — made before the run, recorded with their reasons

These three were predicted from the planning probes **before** this run, and are recorded as predictions, not post-hoc conclusions, so the tracker carries *why* they are unanswerable and no one re-runs them expecting a number.

**Q3 — L-009 cross-handler RATE — UNANSWERABLE at this n.** The denominator is the model-reaching set: 8 files in 2 repos, 7 of them in one. Effective n tracks repos (~2). A cross-handler rate needs multi-handler files that reach the model; the corpus supplies almost none. Any interval is [0, 1]. This is L-007's 0/21 repeating.

**Q2 — L-006 write-only PREVALENCE — UNANSWERABLE as a rate at this n.** The structural candidate pool (source + write-verb + no-sink) was 76 files, but it is contaminated by the *same* `trpc_input_access` FP it is supposed to be independent of — most are DOM `input.x` in editor/frontend files (e.g. `dokieli`) that merely also contain a `.save(`. De-contaminating needs per-file hand-labeling — the L-001 trap ("we knew it had a vuln; it didn't"). Report a hand-verified count with contamination disclosed, or nothing. **Never a rate ± interval.**

**Q5 — reach-as-labeled-recall — UNANSWERABLE, reframed.** "Fraction of request-id *read sites* that `SOURCE_PATTERNS` matches" needs a hand-labeled denominator of every read site across 43 repos — subjective, and the L-001 trap again. Replaced by **prefilter reach = repos-reached / 43**, which is objective and needs no labeling. That is §2.

---

## 6. Failure accounting — the ghJson lesson, generalized

The prior step's near-miss (a silent-null error path that hid a sampling skew) is designed out here:

- **Every file is accounted for.** `filesWalked = 14,566`, `analyzable = 3,987`, `read-failures = 0`. Failures are listed **by name** in the artifact JSON, never a count.
- **Zero-spend is hard-asserted**, not assumed: the run throws unless `successful === 0` and `no_api_key === 0`. `fixor-runner.ts` is never imported.

**Standing rule, recorded for step three and all future measurement:** *a null-and-continue error path is a latent fabricator.* A file that fails to read or analyze and is silently skipped looks identical to "analyzed, found nothing" — which manufactures a finding shaped like data. Every error path lists its casualties by name.

---

## 7. Reproducing

```bash
npm run measure:icp-reach
```

Deterministic (no time/random in the path). **Not wired into `test:ci`** — it depends on `test-output/icp-corpus`, which is gitignored and absent on runners; in CI it would fail for lack of a corpus, not for a regression. Reuses the #102 rig (`spawnLockedProbe`) unchanged.
