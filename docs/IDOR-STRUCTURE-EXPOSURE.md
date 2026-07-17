# idor structural exposure — L-006, L-009, and `trpc_input_access`

**Date:** 2026-07-17
**Rig:** `src/test/measure-idor-structure.ts` (`npm run measure:idor-structure`)
**Data:** `docs/measurements/idor-structure-2026-07-17.json`
**Spend:** $0.00. Zero model calls. Asserted, not assumed — see [Zero spend](#zero-spend).

---

## 1. Scope — read this before quoting any number below

**This is EXPOSURE, not LOSS.**

What that means precisely:

- **EXPOSURE** = a detector mechanism, witnessed under execution, that *can* drop or
  misrepresent a vulnerability. That is what this document establishes.
- **LOSS** = a vulnerability that Fixor actually failed to report on real code someone
  actually wrote. **This document establishes no loss, and no rate of loss.**

**No rate is emitted here.** Not from the constructed inputs, not from the 26 replay fixtures,
not from the 13-repo corpus. Two questions are **DEFERRED to E'** on the ICP corpus, to be
measured once with the rig built here:

| Deferred to E' | Question | Why it is not answered here |
| --- | --- | --- |
| **L-009 cross-handler RATE** | How often does real ICP code produce a cross-handler pair? | This rig witnesses the mechanism on one constructed file. One constructed file is not an incidence rate, and the 13-repo corpus is not the ICP. |
| **L-006 write-only PREVALENCE** | How often does real ICP code contain a write-with-no-read handler? | **This is the load-bearing unknown.** It decides whether the witnessed L-006 miss costs anything, and it is the reason L-006 stays non-gating. |

**This does NOT make L-006 or L-009 READY-gating.** See [§5](#5-what-this-changes-in-the-tracker).
Witnessing exposure does not gate READY. The READY gate is L-010 (detection quality unproven on
a real vulnerability) and F-004, and this measurement moves neither.

---

## 2. Zero spend

The rig drives the real `IdorDetector.analyzeFile` in a **subprocess** under a **triple lock**.
Each layer alone suffices; all three are set so that no single mistake spends money.

| # | Lock | Mechanism |
| --- | --- | --- |
| 1 | `FIXOR_REPLAY=1` | `callClaude` returns from `loadReplayFixture` **before any client is constructed** (`anthropic-client.ts:180-192`). Zero network. |
| 2 | `FIXOR_REPLAY_ROOT` = an **empty** temp dir | Every request key misses, so `loadReplayFixture` throws `ReplayFixtureMissing` (`llm-replay.ts:224`). Fail loud — never a silent fall-through to a live call. |
| 3 | **no** `ANTHROPIC_API_KEY` | Even if 1 and 2 both failed open, `getAnthropicClient()` returns null and the call fails `no_api_key` instead of spending. |

The child env is built **from scratch**, not copied from `process.env` with an override, so an
ambient key from a shell or `--env-file` cannot leak in. The lock is asserted **inside the
child** — the process that would actually spend. A parent-side assert would prove nothing about
the child's env.

**The hard assert.** `callClaude` tallies every terminal outcome into `llm-coverage`, where
`attempted - failed` is the count of *successful* calls. The rig throws unless **both** hold:

- `successful === 0` — a successful call means a fixture was found (replay) or real spend (live).
  Either falsifies the run.
- `no_api_key === 0` — **this is not redundant.** If locks 1–2 failed open, lock 3 would catch
  the call and tally it `no_api_key`: spend-free, but it would mean replay never engaged and
  every `ReplayFixtureMissing` we think we witnessed was actually a keyless no-op. A run that
  leans on lock 3 is not the run this document claims. It fails rather than reporting clean.

**Measured:** `successful = 0`, `attempted = 0`, `failed = 0`.

---

## 3. The witnesses (B) — constructed inputs, real execution

**Construction is the ground truth.** These files were authored, so what they contain is known
by construction rather than inferred. No AST is involved and none is needed. Inputs live in
`src/test/lib/idor-structure-inputs.ts`.

They are **string constants, not files under `fixtures/`**, for two reasons: `fixtures/` is
enumerated by the replay corpus (a new directory there would perturb the 26-fixture manifest
frozen by PR #95–#97), and `SKIP_PATH_RE` skips any path containing `/fixtures/`, so a real scan
would never see them. Because §3's assertions are line-number-based and `core.autocrlf=true`
means this source is CRLF in a Windows worktree and LF on a Linux runner, that stability was
checked rather than assumed: both inputs produce **identical** sink counts and pair line numbers
(`13->28`) under LF and CRLF, since `findPatternHits` splits on `/\r?\n/` and counts only `\n`.

### 3.1 L-006 — a genuine unguarded write IDOR is dropped before the model — **WITNESSED**

The input is the *exact* file the tracker's L-006 entry hypothesised: an unguarded
`prisma.document.update({ where: { id: req.params.id } })` behind `requireAuth`, with **no read
anywhere in the file**. `requireAuth` proves the caller is *somebody*; nothing proves the
document is *theirs*. Any authenticated caller can rename any document — a textbook
write-variant IDOR (OWASP BOLA).

| Observation | Result |
| --- | --- |
| `analyzeFile` returns | `[]` |
| Model reached | **No** |
| Dropped at | the `:803-807` early return, `preFilterReason = "no source/sink co-occurrence"` |

**Why: `sinkHits.length === 0`.** `prisma.document.update` matches no entry of `SINK_PATTERNS`
(`idor.detector.ts:173-202` — all 15 are reads).

**The read control is what makes this an experiment rather than an anecdote.** A second input,
identical but for the ORM verb (`update` → `findUnique`), **does** reach the model. Everything
else is held constant, so the **verb** is the cause. Without this control, `[]` would be equally
consistent with some unrelated flaw in how the file was built.

**The mechanism is universal from source, not an artefact of the construction.** No write verb
appears in `SINK_PATTERNS`, so *every* file whose only sink is an ORM write hits that same early
return. The construction supplies the vulnerability; the source supplies the generality.

> **This is a demonstrated missed vulnerability — conditional on the shape existing.** It proves
> the conditional: *if* write-only-no-read code exists, Fixor misses it, 100% of the time, before
> the model. Whether that shape exists in ICP code is **L-006 PREVALENCE, deferred to E'**.

### 3.2 L-009 — a pair spanning two unrelated handlers reaches the model — **WITNESSED**

A two-handler file. Handler A (`GET /documents/:id/echo`, lines 8–19) has a **source and no
sink** — it echoes the id back, touching no database. Handler B (`GET /stats`, lines 21–33) has a
**sink and no source** — it reads the caller's own row, scoped by `req.user.id`, which matches no
source pattern. **The file contains no IDOR.**

The **real candidate block**, harvested verbatim from the `FIXOR_DEBUG_IDOR_LLM=1` debug log
(`idor.detector.ts:1002-1016`):

```
[0] SOURCE line 13: const documentId = req.params.id;
 -> SINK line 28: const summary = await prisma.usageStats.findFirst({
```

Line 13 is inside handler A. Line 28 is inside handler B. `enumerateSinkPairs`
(`idor.detector.ts:540-570`) has no scope awareness — it pairs each sink with its nearest source
by **line distance only**, and 15 lines is well inside `PROXIMITY_THRESHOLD = 200`. The detector
reached `callLlm` and asked the model to judge **a data flow that does not exist**.

**This is exposure, not a miss.** It costs one of the 12 `MAX_PAIRS_PER_FILE` slots and some
model attention. It is a latent false-positive source, not a demonstrated false positive: no
missed vulnerability is demonstrated, so **L-009 remains UNWITNESSED in the tracker's sense of
that word** (see [§5](#5-what-this-changes-in-the-tracker)).

---

## 4. `trpc_input_access` specificity (C) — pattern-matching axis only

### 4.1 Why this corpus, and what it may not be used for

The 13-repo step-4 corpus (`caddy`, `discourse`, `documenso`, `full-stack-fastapi-template`,
`gitea`, `grafana`, `hoppscotch`, `langchain`, `lemmy`, `mastodon`, `plane`, `strapi`, `twenty`)
is **mature OSS, not Fixor's ICP**. `STEP4-PRODUCTION-VALIDATION.md` §3 disqualified it for rate
claims: it produced **zero true positives**, so precision is 0/0 and undefined.

That same section is explicit about what it *is* good for:

> "Fixture corpora are not predictive of real-codebase signal distribution at the
> *secret-presence* axis. They are predictive at the *pattern-matching* axis, which is why FPs
> are abundant."

Pattern-specificity is a pattern-matching-axis question. **That is the only axis used here.** No
rate, precision, or recall claim is made from this corpus.

### 4.2 Shadow validation — done FIRST, and the count is void without it

Counting 46,632 files by driving the real detector would be minutes of subprocess time to answer
pure regex arithmetic, so the corpus count comes from a **shadow** of the prefilter + pairing
stage (`src/test/lib/idor-structure-shadow.ts`, copied verbatim from the detector). A shadow can
**drift**, and a drifted shadow reports confident nonsense — so it is validated, not trusted.

**A note on what "shadow == real" can mean.** The harvested candidate block shows only the
*nearest source per sink*, not every source hit, so the shadow cannot be validated by comparing a
raw source-hit count against the block — those are different quantities. What is compared is the
**pairs**: the block *is* the detector's own pairing output, and the shadow reproduces the whole
path (patterns → hits → pairs) that produced it. A wrong source pattern moves a source line; a
wrong sink pattern moves or deletes a pair. Matching pairs therefore exercises both copied regex
arrays and the copied pairing logic.

Validation is **two layers**, because sampling alone has a hole:

1. **Structural (`idor-structure-drift.ts`).** Sampled validation only exercises the patterns the
   sample happens to contain — a typo in `rails_class_find` would survive if no sampled file is
   Ruby. So the guard parses both pattern arrays out of the **detector's source text** and
   requires the shadow to match entry-for-entry: same order, same ids, same regex source, same
   flags, same `lang`. "Verbatim" is therefore a mechanical fact, not a claim backed by eyeballs.
   **Result: zero drift across all 17 source + 15 sink patterns.** The guard is itself
   negative-controlled — it was confirmed to fire on a tampered regex and on a dropped entry, so
   it is not decoration that always passes. If its parse breaks it throws, because a guard that
   quietly finds zero patterns and reports "no drift" is worse than no guard.
2. **Behavioural (sampled).** **15 of 15 sampled real corpus files, across 8 repos, matched
   pair-for-pair** — same count, same source line, same sink line, same order.

The rig refuses to emit a corpus count if **either** layer fails.

### 4.3 What the pattern is, and what it actually matches

```js
{ id: "trpc_input_access", re: /\binput\.\w+/ }   // idor.detector.ts:140
```

It carries **no `lang` restriction**, so it applies to all 9 supported languages. **tRPC is
TypeScript-only.**

| Measure | Value |
| --- | --- |
| Files scanned (after the real language / path / server-only filters) | **46,632** across 13 repos |
| Files where `trpc_input_access` fires | **390** (1,367 hits) |
| Hits by language | `ts` 850, `go` 241, `tsx` 197, `rb` 36, `js` 24, `py` 13, `jsx` 6 |
| Spurious — non-TypeScript language (tRPC cannot exist there) | **73 files / 320 hits** |
| Spurious — TypeScript with no tRPC marker anywhere in the file | **310 files / 1,033 hits** |
| First hit sits inside a quoted string (heuristic, line-level) | 103 files |
| **Plausibly genuine tRPC** | **7 files** |
| **Spurious share of firing files** | **98.2 %** (383 / 390) |

**The 98.2 % is a lower bound.** "Plausibly genuine" is generous by design: the marker regex
includes a bare `.input(`, which matches non-tRPC calls too. Being generous to the pattern makes
the finding conservative in the right direction.

**What it is really matching** — actual hits from the corpus:

```
[go]  caddy/modules_test.go:109         actualNamespace := tc.input.Namespace()   // test-table struct field
[js]  discourse/.../postcss.js:24       from: "input.css",                        // STRING LITERAL
[js]  discourse/.../group/index.js:263  .querySelectorAll("input.bulk-select:not(:checked)")  // CSS SELECTOR
[ts]  gitea/.../colorpicker.ts:31       updateSquare(square, input.value);        // DOM <input> element
[ts]  gitea/.../users.ts:16             input.checked = true;                     // DOM <input> element
[ts]  gitea/.../WebHookEditor.ts:10     input.addEventListener('change', ...)     // DOM <input> element
[ts]  documenso/.../time-zones.ts:37    const [timeZone] = input.split('(');      // plain string variable
[ts]  documenso/.../envelope-items.spec.ts:108  await input.setInputFiles(files); // Playwright locator
```

The dominant real-world referents of `input.` are **DOM `<input>` element handles**, **plain
string variables named `input`**, **Go test-table struct fields**, and **CSS selectors inside
string literals**. `findPatternHits` matches raw content with no string/comment awareness, so a
CSS selector in a quoted string is a "request-derived identifier".

### 4.4 The L-009 amplification effect

This is where specificity stops being cosmetic. More sources inside a 200-line window means more
chances for a spurious source to win "nearest" and be handed to the model as the origin of a
flow. Measured by re-running the **real** pairing with this **one** pattern removed and diffing:

| Effect | Count |
| --- | --- |
| Pairs whose source is a `trpc_input_access` hit | **103** |
| — of those, pairs **CREATED** by it (the sink had *no* other source within 200 lines) | **101** |
| — of those, pairs **HIJACKED** by it (a real source existed; the spurious hit was nearer and displaced it) | **2** |
| Files that reach the model **only** because this pattern fired | **40** |

**101 of 103** trpc-sourced pairs exist *purely* because this pattern fired. Remove it and the
sink has no source within 200 lines and no pair forms at all. **40 files** are sent to the model
solely on its account — each consuming a pair slot and model attention to judge a flow that,
on the evidence of §4.3, is usually a DOM element or a string.

The 2 **hijacked** pairs are the more interesting failure: a real source existed, but the
spurious hit was nearer, so the model was shown the **wrong origin** for a real sink.

**This is the concrete content of the L-007 constraint** ("L-007 and L-009 must be fixed together
or not at all", in the tracker's L-007 entry): matching *more* sources without scope awareness amplifies
exactly this. It is measured here for one pattern only.

### 4.5 Two honest limits on the corpus count

1. **`SKIP_PATH_RE` filters directory components, not filename conventions.**
   `(^|\/)(test|tests|__tests__|spec|...)(\/|$)` skips a `tests/` **directory**, but not
   `listeners_test.go`, `EditorMarkdown.test.ts`, or `envelope-items.spec.ts`. 22 of the 73
   non-TypeScript spurious files carry a test-convention filename. The shadow reproduces this
   faithfully because it is what production does — these files really are scanned. Whether that
   is desirable is **not** claimed here; it is an observation, not a measured finding.
2. **"Plausibly genuine" is a marker heuristic, not a parse.** It answers "does this file mention
   tRPC at all", not "is this hit a tRPC input access". It is deliberately generous (see §4.3).

---

## 5. What this changes in the tracker

Two things: **L-006's descriptor and rationale** (from §3), and a **new entry, L-011** (from §4;
added 2026-07-17, see the end of this section).

On the witnessed axis, **only L-006 changes.** `REMEDIATION-PROGRESS.md` glosses "UNWITNESSED"
twice, identically and in apposition — in the readiness verdict, and in the "What survives" note
on the void demonstration:

> "They are UNWITNESSED. We have ZERO demonstrated missed vulnerabilities."

So in that document **UNWITNESSED means "no missed vulnerability has been demonstrated"** — not
"inferred from source rather than executed". That distinction decides what this measurement is
allowed to change:

| Item | Before | After | Why |
| --- | --- | --- | --- |
| **L-006** | UNWITNESSED | **WITNESSED** | §3.1 demonstrated a missed vulnerability — the word's exact currency. |
| **L-009** | UNWITNESSED | **UNWITNESSED** (unchanged) | §3.2 witnessed a *mechanism*, but a spurious pair is a precision gap, not a missed vulnerability. It does not touch the word in its real sense. |
| **L-007** | UNWITNESSED | **UNWITNESSED** (unchanged) | Not exercised by this measurement at all. |

**L-006 stays NON-gating — on a rewritten rationale.** The old rationale ("we never observed
one") is dead: we have now observed one. What keeps it non-gating is **PREVALENCE**, which is
unknown and deferred to E'. The witnessed miss is *conditional*: it proves that **if** the shape
exists, Fixor misses it. If the shape does not occur in ICP code, the miss costs nothing.

The gate question for L-006 is now explicitly: **does write-with-no-read code exist in ICP
repos?** E' answers it.

**§4 is tracked as L-011** (added 2026-07-17, under a new `Priority 1e`). The
`trpc_input_access` finding was initially recorded inside L-009's body as an amplifier; it was
extracted because it is a defect in a SOURCE PATTERN, not a property of the pairing algorithm,
and it has an independent fix and verification. L-011 owns every figure in §4; L-009 keeps a
numberless pointer, so no number lives in two places. Its descriptor carries **no
witnessed/unwitnessed adjective in either direction** — that word is a recall-axis word meaning
"a missed vulnerability has been demonstrated", and applying it to a precision defect would be
true-but-vacuous and would re-blur the term §5 exists to sharpen. It follows the tracker's
existing precedent for precision items (L-002, L-003, L-009): status + axis, with the evidence
in a `MEASURED:` line.

Minting L-011 also forced a **CORRECTION to the `L-` namespace definition**, which read "`L-`
items [were surfaced] by *live* detection-quality measurement". This rig is not live and makes
no model call, so filing L-011 under `Priority 1d` ("defects surfaced by the first live
detection-quality run") would have made that header false. The definition is widened to
"detector measurement (live or structural)"; the `F-`/`L-` axis (found by READING vs found by
RUNNING) is unchanged.

Swapping the adjective while leaving the old rationale in place would have left a status whose
stated basis no longer supports it — the same defect as the L-010 contradiction this session
exists to fix. The rationale is therefore rewritten, not just the word, and
every collective sentence that swept L-006 into "we have ZERO demonstrated missed
vulnerabilities" is corrected in the same PR.

**L-010 and F-004 are untouched.** L-010 is that detection quality is unproven on a **real**
vulnerability. This measurement demonstrates no *catch*, so it neither lifts nor weakens that
gate. READY remains blocked on F-004 and L-010.

---

## 6. Reproducing

```bash
npm run measure:idor-structure
```

Deterministic: two consecutive runs produced identical numbers.

**Deliberately NOT wired into `test:ci`.** Section 4 depends on
`test-output/step4-scans/repos`, which is gitignored and absent on runners — in CI it would fail
for lack of a corpus, not for a regression. Sections 2 and 3 (the witnesses) have no corpus
dependency and the rig skips section 4 cleanly when the corpus is absent, so wiring the witnesses
alone into CI is possible later; it is out of scope here.

**Built for reuse by E'.** `spawnLockedProbe` in `src/test/lib/idor-structure-rig.ts` takes an
arbitrary file list; only the inputs differ for the ICP corpus. The per-file `try/catch` is
load-bearing for that reuse: under the lock, a file reaching the model throws
`ReplayFixtureMissing`, and that throw is a **result**, not a crash — one unparseable file in a
real repo must not void the whole run.
