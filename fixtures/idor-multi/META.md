# idor-multi fixtures (H6, Phase H Tier 2)

Proving fixtures for lifting the G3 one-finding-per-file ceiling. Today
`closestSourceSinkPair` judges exactly ONE source/sink pair per file, so
a file with two independent IDORs reports one. H6 enumerates ALL
qualifying pairs and judges them in a SINGLE whole-file LLM call that
returns a verdict ARRAY (one verdict per pair, each carrying the lane
facts). These fixtures pin per-pair expectations that the standard
stability harness (positive = "flagged at all") cannot express — a
custom `test:idor-multi` (Phase 2) asserts finding COUNT and the exact
sink lines, n=5 K-of-N.

Honesty rules (F1): no safety-asserting comments; verdicts pinned here.

## A-two-independent-idors.ts — BOTH must flag (proves ceiling lifted)

Express+Prisma. Two independent route handlers, each a genuine IDOR;
the list siblings (`findMany where userId`) signal both resources are
user-owned and create no competing source/sink pair (`findMany` is not a
sink pattern).

- `GET /orders/:id` — `order.findUnique({ where: { id: req.params.id } })`
  at **line 19**, no ownership filter → IDOR, flag HIGH.
- `GET /invoices/:id` — `invoice.findUnique({ where: { id: req.params.id } })`
  at **line 36**, no ownership filter → IDOR, flag HIGH.

**Expected: exactly 2 findings, at sink lines {19, 36}.** Under the
CURRENT single-pair code this fixture yields ONE finding (the closest
pair only) — that is the ceiling H6 lifts. This file also doubles as the
same-file introduced-vs-pre-existing proving case H2 flagged: with two
findings at distinct lines, H2's changed-line partition can now split a
single file into introduced vs pre-existing (previously impossible
because only one was found).

## B-one-real-one-safe.ts — exactly ONE flags (proves it discriminates)

Express+Prisma. One safe (scoped) handler + one IDOR in the same file.
Proves multi-finding judges each pair on its merits, not flag-all.

- `GET /documents/:id` — `document.findFirst({ where: { id: req.params.id, userId: req.user.id } })`
  at **line 12**, ownership-filtered by userId → SAFE, must NOT flag.
- `GET /reports/:id` — `report.findUnique({ where: { id: req.params.id } })`
  at **line 22**, no ownership filter → IDOR, flag HIGH.

**Expected: exactly 1 finding, at sink line 22 (reports). Line 12
(documents) must NOT appear.**

## Reused proving case (no new file): H5 tenant NEG-2

`fixtures/idor-tenant/negative/02-express-prisma-membership.ts` cleared
at safe/MEDIUM in H5 because the 200-line window truncated its
`if (!membership) return 403`. Under H6's whole-file payload that line is
in context, so it should clear at a FIRMER margin (safe/low, not
safe/medium). Verified by re-running `test:idor-tenant` in Phase 2 and
inspecting the verdict confidence. (Phase 3 confirms the caveat closed.)

## Falsifier (R10/R11 + H6 plan)

If implementing the verdict-array + whole-file payload regresses ANY of
the existing 18 `fixtures/idor/` fixtures, OR multi-verdict output is
unstable across n=5 (e.g. A flags 2 findings on some runs and 1 on
others), the change REVERTS to single-pair and the ceiling stays. A
shaky multi-finding is worse than an honest single-finding.
