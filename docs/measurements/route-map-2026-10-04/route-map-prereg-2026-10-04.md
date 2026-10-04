# Route-map extractor, mapping-stage measurement: pre-registration, 2026-10-04

Committed before any extractor code exists, before any measurement set is drawn, and before any
case is read for this purpose. Zero model calls, zero paid calls, zero API keys at every step.
This file is the whole of what the owner's narrow lift of 2026-10-04 permits (tracker entry "THE
STOP IS LIFTED FOR ONE STEP ONLY"). Everything else frozen on 2026-10-04 under A1 section 2 stays
frozen: no reviewer step, no model call, no detector change, no prompt change, no prefilter or
regex change made to raise detection, no batch 2 of the third held-out set, no Gate B.

## 0. Why this measurement exists, and what it is not

The owner's hypothesis: the single-file access-control lanes (auth-bypass, admin-check, idor)
miss defects because the evidence spans files, so a deterministic map of each route (declaration,
handler, guard chain, data-access symbol) is the shared foundation the three lanes lack. ABSENTIA
(arXiv 2610.00977) builds such a map with LLM agents and recalls 19 of 30 BAC-Bench advisories
where CodeQL and Semgrep recall 0; its map is not released and its data carries no license, so
nothing of it is reused here beyond the idea that the map comes first.

This measurement asks one question only: **can a deterministic, zero-model extractor build that
map for real JavaScript/TypeScript applications, and does the map contain the known defect?** It
is a measurement of the mapping stage. It is not a measurement of detection, it produces no
finding, and no public claim may cite it as evidence that Fixor detects anything.

**The framing, challenged and recorded.** The map is a foundation for one lane and a locator for
two:
- auth-bypass asks whether the route's chain carries an authentication guard. The map carries
  the chain. Foundation.
- admin-check asks whether a *privileged* route carries only an ordinary guard. "Privileged" is a
  semantic label the map does not carry; the map tells which guard is there, not whether it is
  the right one. Locator plus a reasoning step.
- idor asks whether the data access filters by the caller's ownership or grant. The map points
  at the data-access call; the predicate, the tenancy model and which column is the owner key
  are not map facts. Locator only. ABSENTIA's own breakdown separates an extraction gate from a
  reasoning gate per weakness class for this reason.

So a PASS here would say the chain can be built and found, not that the three lanes become
detectors. That next question is a separate pre-registration, and it is frozen.

## 1. Order of operations, binding

1. This file merges to `main`.
2. The extractor is built against the **development set** (section 2.1) only, with a keyless
   rehearsal in `test:ci`. It may be tuned freely against the development set.
3. The extractor is **frozen**: a dated file in this directory records the `main` commit SHA and
   the sha256 of every file under its source directory. From this point no extractor change may
   precede the measurement; a change after this point voids the measurement and restarts at
   step 3 with a NEW draw under a new name.
4. The **measurement set** (section 2.2) is drawn, by a script committed in the same PR as the
   draw, under rules that are byte-identical to section 2.2 at the freeze commit. The manifest
   holds identifiers only. The falsification arm A (section 6) is computed from the fix diffs and
   committed in the same commit as the draw, before the extractor touches any case.
5. The extractor runs on the parent tree and the fix tree of every admitted case. Outputs stay
   outside the repository. A committed scorer reads them and writes the per-case flags, counts
   and the verdict into this directory.
6. The verdict is filed in the tracker. Nothing is re-run.

The developer (a Claude Code session) will have read the development set. It must not read any
measurement-set case, advisory text, fix diff or file before step 4 completes and the freeze
commit of step 3 is on `main`. Reading one voids the set.

## 2. Case source and admission

### 2.1 Development set (looked at, tuned against; never scored)

The 22 cases already burned by the reach work, all named in the tracked tree:
- the 12 Arm A cases, `docs/measurements/field-trial-2026-09-19/arm-a-corpus-manifest-2026-09-19.tsv`;
- the held-out ten, `docs/measurements/detector-reach-2026-09-27/held-out-corpus-manifest-2026-09-27.tsv`.

Their files are outside the repository beside it. No file content from them enters the tree.

### 2.2 Measurement set

**This revises the recommendation of 2026-10-04 that the set be "a fresh draw of at least 10
cases published after 2026-06-30 under the sealed third-set rules".** The post-2026-06-30 window
exists to defeat a model's memorisation of published advisories. A deterministic extractor cannot
memorise; the window buys nothing here and would spend the only post-cutoff set on a question that
does not need it. The risk that remains is the developer tuning the extractor to the cases, and
section 1 handles that by order (freeze, then draw), not by date.

**The sealed third set (`docs/measurements/held-out-3-2026-10-03/`) is not read, not used and not
touched by this measurement.** Its batch 2 stays frozen under the stop.

The measurement set is drawn under `held-out-3-2026-10-03/admission-2026-10-03.md` **with these
stated differences, and no others**:
- **Window.** Advisories published from 2024-01-01T00:00:00Z to the draw's run time. R7 (fix dates
  on or after 2026-07-01) does not apply.
- **R3, extended.** The repository is none of: the 12 Arm A repositories; the held-out ten;
  `lobehub/lobehub`; the six repositories of third-set batch 1; any repository named in the tracked
  tree at the freeze commit of section 1 step 3 (`git grep -il owner/name`). This removes every
  development-set repository and every BAC-Bench repository that Fixor has ever named.
- **R5, lane.** Unchanged: auth-bypass, admin-check or idor, assigned from summary and CWE alone.
  The CWE list is the third set's.
- **R6, fix commit.** Unchanged, including its known gap (a cited commit need not hold the defect).
  **Treatment of the gap, decided now:** every admitted case is scored; the gate reads the count
  over ALL admitted cases (strict). At draw time, from the advisory text and the fix's file list
  only, each case is also marked `consistent` or `inconsistent` as batch 1 did, and the count over
  consistent cases is reported beside the gate. The marking is a judgment, listed per case, and it
  is made before the extractor runs.
- **Size.** Minimum for a label: **20 admitted**. Target 40. If more than 40 qualify, the 40 with
  the lowest `sha256("route-map-2026-10-04|" + GHSA id)` are drawn; the rest are recorded as
  "qualified, not drawn". Below 20 the count is the result and no label applies.
- **Clean files.** None. This measurement has no clean arm; its noise control is section 4 C5.

Expected yield, stated before the count is known: the held-out ten came from 971 reviewed npm
advisories over 33 months; the third set's batch 1 came from 8,022 reviewed and unreviewed
advisories over three months and admitted 6. Over 33 months with both types, before R3's tree
exclusion, the rule is expected to admit more than 20. If it does not, that is the result.

### 2.3 Why not the third set's count today

Counted on 2026-10-04 from the advisory database (public data only, no draw): since batch 1's
listing run at 2026-10-02T23:36:33Z, 38 distinct advisories match the window and CWE set; 13 fail
R1, 24 fail R2, 0 fail R3, and the one that reaches judgment (`formbricks/formbricks`,
GHSA-q9hg-xqvp-x2xv, stored XSS) fails R5. **Zero new cases.** The third set stands at 6 admitted,
4 consistent, and at batch 1's own rate reaches 10 around early 2027. A measurement that needs the
post-cutoff property must wait for that; this one does not, which is section 2.2's point.

## 3. Frameworks in scope, declared before the draw

**Tier 1, gating.** The extractor must build the chain for:
1. **Express-family declarations:** `app|router|server|fastify.<method>(path, ...handlers)`,
   `router.route(path).<method>(...)`, Hapi's `server.route({method, path, options.pre, handler})`,
   koa-router and `@koa/router`, restify. Mount composition through `app.use(prefix, router)`,
   `router.use(prefix, sub)` and nested routers, so a route's path is its composed path. Guards are
   the handlers before the last one, plus every `use()` middleware on the route's own router and on
   each router it is mounted under, in order.
2. **NestJS controllers:** `@Controller(prefix)` with `@Get|Post|Put|Patch|Delete|All(path)`;
   guards from `@UseGuards` on the method, the class, and global `APP_GUARD` providers; middleware
   from `MiddlewareConsumer.apply(...).forRoutes(...)`.
3. **Next.js App Router route handlers:** `export async function GET|POST|...` in `route.ts|js`
   under `app/`; guards are the `middleware.ts` matcher that covers the path plus the first
   in-handler call whose name matches the guard-name heuristic (section 4).
4. **tRPC routers:** `t.router({...})` members built from `publicProcedure|protectedProcedure|
   <name>Procedure` chains; guards are every `.use(...)` middleware on the procedure base and on
   the chain; the path is the dotted router path.

**Tier 2, reported, not gating.** Remix / React Router v7 `loader|action` exports with the parent
layout chain (reusing `route-guard-resolver.ts`); NestJS GraphQL resolvers (`@Resolver`,
`@Query`, `@Mutation`); Meteor methods and `@rocket.chat/http-router`; h3 / Nitro event handlers;
Hono and Elysia; Astro endpoint files; Payload `endpoints`; raw `http.createServer` dispatch.

A case whose defect files declare routes only in a Tier 2 or unknown framework is recorded
`out-of-scope`. It counts as a miss in the strict count and is excluded from the in-scope count.
The framework of a case is read mechanically: the first Tier 1 pattern that matches any defect
file at the parent, else the first Tier 2 pattern, else `unknown`. This reading is committed with
the draw, before the extractor runs.

**Data-access symbols.** A call on an identifier or member whose root name is one of: `prisma`,
`db`, `knex`, `sequelize`, `mongoose`, a Mongoose model (an identifier created by `model(...)`),
`typeorm` repositories (`getRepository`, `Repository<...>` members `find*|save|update|delete|
remove|query|createQueryBuilder`), `drizzle` (`db.select|insert|update|delete`), `kysely`
(`selectFrom|insertInto|updateTable|deleteFrom`), raw `query(`/`execute(` on `pool|client|conn`,
and the Meteor collection methods `find|findOne|update|remove|insert`. The list is frozen here; a
symbol outside it is not a data-access node.

**Chain depth.** From the handler, calls are followed through relative imports (never
`node_modules`) to a depth of 3 hops. Each hop is a function or method declaration resolved by
name within the imported module; dynamic dispatch, dependency injection by token and `this.x`
where `x` is not a class field initialised in the same file are not resolved and are recorded as
`unresolved` edges.

**Guard-name heuristic**, frozen here. A guard node is classified `auth` when its callee name
matches `/auth|authent|login|session|jwt|passport|bearer|token|requireUser|isLoggedIn|
protected/i`; `role` when it matches `/admin|role|permission|authori[sz]|can[A-Z]|policy|
ability|rbac|scope|owner|member/`; else `other`. The class is descriptive (section 4 C3) and
never gating.

## 4. What "resolves the chain" means for one case

Inputs, all public and all read by git: the repository at the fix's single parent `P`; the fix
diff `F` against `P` restricted to non-test `.ts/.tsx/.js/.jsx/.mjs/.cjs` files (the R6 filter);
the **defect windows**: for each defect file that exists at `P`, the parent-side line range of
each hunk of `F`, padded by 3 lines, exactly as `src/test/lib/agentic-review.ts` `defectWindow`
computes it (WINDOW_PAD 3; a hunk with no parent-side lines takes NO_BLOCK_PAD 10 around its
insertion point).

The extractor, run on `P`'s tree, emits a **map**: a list of route nodes, each with `framework`,
`methods`, `path` (composed), `declaration {file, span}`, `handler {file, span}`, `guards:
[{name, kind, file, span}]`, `dataAccess: [{symbol, file, span}]`, `unresolved: n`, and a
content hash per node (sha256 of the node's source text). The run also emits a digest: route
count, routes with zero guards, routes with zero data-access nodes, unresolved edges.

A route's **chain** is the union of its declaration, handler, guard and data-access spans.

Per case, computed by the committed scorer with no human reading:

- **C1 Located.** At least one route's chain intersects at least one defect window at `P`.
- **C2 Contained.** At least one hunk's parent-side range (unpadded) lies entirely within one
  node's span of one route's chain. **A case resolves when C2 holds.** C1 without C2 is reported
  as `located-only`.
- **C3 Lane-shaped differential**, descriptive: the extractor is also run on `F`'s tree; the C2
  route is matched at `F` by `(framework, methods, path)`; the difference between its chains at
  `P` and `F` is classified: `guard-added` (a guard node present at `F` and absent at `P`),
  `handler-changed` (handler hash differs), `data-access-changed` (a data-access node hash differs
  or one appears), `route-removed`, `other`. For the record only; the lane assignment is a
  judgment and the guard kind is a heuristic.
- **C4 Deterministic.** Two runs of the extractor on the same tree, in two processes, produce
  byte-identical maps. Checked on every case at `P` and `F`. **One failure voids the measurement**
  (section 7).
- **C5 Guard-blind flag**, the noise control: a repository whose `package.json` at `P` lists an
  authentication dependency (`passport`, `jsonwebtoken`, `jose`, `next-auth`, `@auth/core`,
  `lucia`, `better-auth`, `express-session`, `koa-session`, `@fastify/jwt`, `@nestjs/passport`,
  `@nestjs/jwt`, `firebase-admin`, `@clerk/*`, `@supabase/*`, `keycloak-connect`,
  `openid-client`) and whose map has more than 50% of routes with zero guard nodes is flagged
  `guard-blind`. The map almost certainly fails to see a mount-level or global guard there, and a
  model fed that map would be told most routes are unguarded. The flag is per repository and feeds
  falsification arm B.

Correctness is judged from these public facts only: the fix diff decides where the defect is,
git decides what the files say, and the manifest's lane comes from the draw. No model judges
anything and no person reads a measurement case before the draw commits.

## 5. Thresholds, decided now

Over the measurement set, with n ≥ 20 admitted:

- **PASS requires all four:**
  1. in-scope coverage: at least **70%** of admitted cases have a Tier 1 framework;
  2. **C2 on at least 80%** of in-scope cases;
  3. **C2 on at least 60%** of ALL admitted cases, out-of-scope and inconsistent included;
  4. C4 on every run.
- **FAIL** is anything else.
- Below n = 20: no label; the counts are filed and the lift lapses (section 8).

Why 80%. A map that cannot contain 1 known defect in 5 would hand a model a chain without the
evidence a fifth of the time, on top of the model's own miss rate, which on the lanes' record is
0 of 12 on Arm A and 1 of 10 on the held-out ten under the proxy. A foundation has to be nearly
lossless to be worth a model run; 80% is the floor below which the next pre-registration cannot
be justified on any budget. Why 70% coverage: the four Tier 1 frameworks are Fixor's own list; if
most real advisories sit outside it, the map covers the detector, not the market.

## 6. Deliberate falsification: what would prove the map is not the missing piece

**Arm A, "the evidence was already in one file."** Computed from the fix diff alone, at draw time,
before the extractor exists for the set (section 1 step 4), and committed with the draw. For
every admitted case: the number of non-test source files the fix touches, and whether every
defect window lies in a file that matches one of the route-definition patterns in
`src/analysis-engine/detectors/shared/route-def-pattern.ts` at the freeze commit (that is, a file
the single-file lanes already route to the model). **If 70% or more of admitted cases have every
defect window inside a single route-shaped file, the claim "the lanes miss because the evidence
spans files" is falsified for this population, and the map is not the missing piece, whatever
section 5 says.** This arm binds even on a PASS; a PASS with arm A tripped is filed as
`MAP-BUILDS, EVIDENCE-WAS-LOCAL`, and the next pre-registration may not cite it as support.

What arm A does not falsify, stated now so it is not stretched later: it says nothing about
whether sibling-route context (the other routes' guards, which is what ABSENTIA's invariant step
uses) would change a model's verdict. That is a model question and it is frozen.

The record already says what arm A is likely to find: the agentic review pre-registration notes
that 7 of the held-out ten fix commits change a single non-test source file, and the Arm A
admission lists 8 of 12 with one target file; 15 of the 22 development cases, 68%, are
single-file fixes, and the lanes still scored 0 of 12 and 1 of 10. The measurement set may differ;
the threshold is set before it is drawn.

**Arm B, "the map cannot see guards where it matters."** If **30% or more** of in-scope
repositories are `guard-blind` (C5), the guard chain is not trustworthy on the population, a
model fed with it would receive false "unguarded" claims on most routes, and the map is not a
foundation for auth-bypass. Filed as `MAP-BUILDS, GUARD-BLIND`; binds on a PASS.

**Arm C, coverage.** Section 5's 70% coverage floor, failing on its own: the map covers Fixor's
framework list, not the market. Filed as `MAP-NARROW`.

A result that passes section 5 and trips none of A, B, C is filed as `MAP-RESOLVES`. It unlocks
exactly one thing: the right to write the next pre-registration, which is a model question, which
needs the owner's decision on the precision thesis first (Fixor's zero-false-positive rule against
ABSENTIA's 77 reports per repository at 51% confirmed), and which is frozen until that decision.

## 7. Stop and void conditions

- C4 fails on any run: the measurement is void; the cause is filed; a fix restarts at step 3 with
  a new draw.
- Any model call, any API key in the environment of any step, any request to any model
  endpoint: void. The scripts refuse to start when `ANTHROPIC_API_KEY` or any `ANTHROPIC_*`
  variable is set.
- Any extractor change between the freeze (step 3) and the verdict: void.
- Any measurement case read by the developer before the draw commits: the set is void.
- Any file content, route path string, symbol name or line of source from a measured repository
  committed to this public repository: the PR is rejected. Committed artifacts carry identifiers
  (GHSA, repository, commits, paths of defect files as the draw already does), flags, counts,
  hashes and the verdict. Maps stay outside the repository.
- The draw script, the extractor and the scorer may not read `fixtures/replay/`, the sealed third
  set's corpus, or any `.env`.

## 8. Hard stop date

**2026-12-15.** If the verdict is not filed on `main` by then, the lift lapses, the stop of
2026-10-04 stands with no result, and this file is annotated `LAPSED`, never deleted. The date is
before ABSENTIA's planned code release ("by the end of 2026"), so no part of this extractor can
have been read from it.

## 9. What the verdict means for the product

- **FAIL, MAP-NARROW, GUARD-BLIND, or EVIDENCE-WAS-LOCAL:** no route-graph work continues. The
  six shipping detectors stay as they are. No public copy may say "cross-file", "route graph" or
  "application-wide". The three access-control lanes keep their measured result (Arm A 0 of 12
  on the shipped pipeline) and the owner's product decision on them, keep, drop or rebuild as
  deterministic checks, is taken on that record, not on this one.
- **MAP-RESOLVES:** the extractor stays in `src/test/` as measurement tooling; it does not ship,
  it emits no finding, and no public claim cites it. The next step is a pre-registration for a
  model-backed measurement, after the owner decides the precision thesis. Nothing in this file
  pre-authorises that step.
- **Below n = 20 or LAPSED:** no label, no product change, the stop stands.

## 10. Artifacts this measurement will commit

Under this directory, identifiers and counts only:
- `extractor-freeze-<date>.md`: the `main` SHA and per-file sha256 of the extractor.
- `draw-<date>.md` and `manifest-<date>.tsv`: rules applied, counts per rule, the admitted cases
  (GHSA, CVE, repository, lane, CWEs, published, fix, parent, defect-file paths and blob ids), the
  per-case framework reading, the consistency marking, and arm A's per-case numbers.
- `rejections-<date>.tsv`: every listed advisory and the first rule it failed.
- `results-<date>.json`: per case C1 to C5 flags, the differential class, route and guard counts,
  unresolved-edge counts, the map's sha256 at `P` and `F`, the two-run equality; the verdict.
- A dated tracker entry with the verdict and the counts.

## 11. Build plan the pre-registration binds (summary; the full plan is in the tracker entry)

Reused: `route-def-pattern.ts` regexes as declaration seeds for the Express family, App Router
and Remix; `route-guard-resolver.ts` and its `GuardFs` for the Remix layout chain and the
filesystem abstraction; `src/test/agentic-prepare.ts` for mirroring a repository and exporting a
commit's tree; `agentic-review.ts`'s `defectWindow`, `nonTestSource` and `TEST_SEG_RE`. New:
`src/test/lib/route-map.ts` (pure: parsing with the `typescript` compiler API already in
`devDependencies`, mount composition, guard chain, call following, the map and digest types),
`src/test/route-map.ts` (entry: tree in, map out, two-run determinism check), `src/test/draw-route-map.ts`
(the draw and arm A), `src/test/measure-route-map.ts` (the scorer), and a keyless rehearsal in
`test:ci` over synthetic fixtures under `fixtures/route-map/` written for this purpose (no
third-party code). Nothing under `src/analysis-engine/` changes.
