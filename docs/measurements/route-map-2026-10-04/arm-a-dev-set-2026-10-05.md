# Route map, falsification arm A on the development set, computed 2026-10-05 at $0

Pre-registration: `route-map-prereg-2026-10-04.md`, section 6, arm A. This is the development-set
preview the owner agreed to before any parser is written. It is descriptive: the gating arm A is the
one computed on the measurement set at draw time (section 1 step 4). No model, no API key, no
parser. Inputs: each case's fix commit through the GitHub commits API (file list and status), and
each touched file's content at the fix's parent through the contents API, tested against the
route-definition patterns of `src/analysis-engine/detectors/shared/route-def-pattern.ts` at
`main` `ea2b379` (the file last changed in `05c5792`, 2026-09-28). The per-case record with the
file paths and flags is `arm-a-dev-set-2026-10-05.json`; no file content is committed.

## The definition, and the two readings

Arm A, as pre-registered: a case counts when **every defect window lies inside a single
route-shaped file**, a file that matches `EXPRESS_ROUTE_DEF_RE`, `APP_ROUTER_ROUTE_DEF_RE`, or
`REMIX_HANDLER_DEF_RE` under `isRemixRoutePath`, at the parent commit. Non-test source means the
R6 filter: `.ts/.tsx/.js/.jsx/.mjs/.cjs`, excluding the test segments and `*.test.*`/`*.spec.*`.

The definition is ambiguous on one point: a file the fix ADDS has no defect window (windows are
defined only for files that exist at the parent), so the two readings differ on whether an added
file breaks "single".
- **R1 (strict):** exactly one non-test source file touched by the fix, added files included, and
  that file is route-shaped at the parent.
- **R2 (window-based):** exactly one non-test source file that exists at the parent, and it is
  route-shaped; files the fix adds are ignored.

Both are reported. The measurement-set draw will use R2, because it is the reading that follows the
window definition literally; this is decided here, before the draw, and binds section 6.

## Per case

`src` = non-test source files touched by the fix; `at P` = of those, existing at the parent;
`shaped` = route-shaped flag per file at P, in manifest order; the paths are in the JSON record.

| set | case | repository | fix | src | at P | added | shaped | R1 | R2 |
|---|---|---|---|---|---|---|---|---|---|
| Arm A | 01 | n8n-io/n8n | `a70b2ea` | 5 | 4 | 1 | n n n n | no | no |
| Arm A | 02 | Budibase/budibase | `93db778` | 1 | 1 | 0 | Y | **yes** | **yes** |
| Arm A | 03 | directus/directus | `22be460` | 1 | 1 | 0 | n | no | no |
| Arm A | 04 | actualbudget/actual | `9966c02` | 2 | 1 | 1 | Y | no | **yes** |
| Arm A | 05 | frangoteam/FUXA | `78534da` | 3 | 3 | 0 | Y Y n | no | no |
| Arm A | 06 | withstudiocms/studiocms | `aebe8bc` | 1 | 1 | 0 | n | no | no |
| Arm A | 07 | lobehub/lobe-chat | `2c1762b` | 6 | 6 | 0 | n n n n n n | no | no |
| Arm A | 08 | OneUptime/oneuptime | `07bc6d4` | 1 | 1 | 0 | n | no | no |
| Arm A | 09 | SignalK/signalk-server | `ead2a03` | 1 | 1 | 0 | Y | **yes** | **yes** |
| Arm A | 10 | apostrophecms/apostrophe | `d50c6ad` | 1 | 1 | 0 | Y | **yes** | **yes** |
| Arm A | 11 | tinacms/tinacms | `0a927a4` | 4 | 4 | 0 | n n n n | no | no |
| Arm A | 12 | backstage/backstage | `3b62dd2` | 1 | 1 | 0 | n | no | no |
| held-out | 01 | deepstreamIO/deepstream.io | `1c2adde` | 1 | 1 | 0 | n | no | no |
| held-out | 02 | erxes/erxes | `4ed2ca7` | 3 | 3 | 0 | n n n | no | no |
| held-out | 03 | louislam/uptime-kuma | `303a609` | 1 | 1 | 0 | Y | **yes** | **yes** |
| held-out | 04 | misskey-dev/misskey | `dc77d59` | 4 | 3 | 1 | n n n | no | no |
| held-out | 05 | parse-community/parse-dashboard | `f92a9ef` | 1 | 1 | 0 | Y | **yes** | **yes** |
| held-out | 06 | parse-community/parse-server | `053109b` | 1 | 1 | 0 | Y | **yes** | **yes** |
| held-out | 07 | Unleash/unleash | `43e8db3` | 1 | 1 | 0 | n | no | no |
| held-out | 08 | vendurehq/vendure | `3bb0471` | 2 | 2 | 0 | n n | no | no |
| held-out | 09 | whyour/qinglong | `6bec52d` | 1 | 1 | 0 | Y | **yes** | **yes** |
| held-out | 10 | Yonle/bostr | `49181f4` | 1 | 1 | 0 | n | no | no |

Every route-shaped hit is `EXPRESS_ROUTE_DEF_RE`; no file matched the App Router or Remix patterns.
Zero read errors; every fix has one parent.

## Totals

| count | of 22 | share |
|---|---|---|
| single non-test source file touched, any shape (R1 basis) | 14 | 64% |
| single non-test source file at the parent, any shape (R2 basis) | 15 | 68% |
| **arm A, R1: one touched file and it is route-shaped** | **7** | **32%** |
| **arm A, R2: one parent file and it is route-shaped** | **8** | **36%** |

**The inherited "15 of 22, 68%" figure was the single-file count, not arm A.** It counted
single-file fixes regardless of whether the file is one the single-file lanes would ever open. Arm A
as pre-registered adds the route-shaped condition, and under it the count is 7 or 8 of 22.

## Verdict against the pre-registered 70% rule

Arm A is **not tripped** on the development set: 32% (R1) or 36% (R2), against a 70% threshold.
The claim "the lanes miss because the evidence spans files" is not falsified by this population.

## What the 22 cases actually split into, read from the same table

- **7 or 8 cases (R1/R2): the whole fix sits in one route-shaped file.** The single-file lanes
  received that file and missed. A map adds no defect evidence on these; what it could add is
  sibling context, a model question that is frozen.
- **7 cases: the whole fix sits in ONE file that is NOT route-shaped** (directus `flows.ts`,
  studiocms `secure.ts`, oneuptime `User.ts`, backstage `NunjucksWorkflowRunner.ts`, deepstream
  `rules-map.ts`, unleash `feature-toggle-service.ts`, bostr `auth.js`; actual's second file is a
  migration). The lanes never opened these files at all: the defect sits in a service, model,
  permission or auth helper, past the prefilter. This is the population a route map reaches by
  following the handler's calls (section 3, chain depth 3), and it is what C2 measures. It is
  evidence of a reach gap, not a cross-file reasoning gap.
- **7 cases: the fix spans 2 to 6 non-test source files** (n8n, FUXA, lobe-chat, tinacms, erxes,
  misskey, vendure). Cross-file evidence in the plain sense.

So on this set the map's case rests on 14 of 22 (the second and third groups), and the strongest
part of it is the second group, which the pre-registration did not name as a category. The
measurement set's report will carry this three-way split beside arm A; the split is descriptive
and does not change section 5 or section 6.
