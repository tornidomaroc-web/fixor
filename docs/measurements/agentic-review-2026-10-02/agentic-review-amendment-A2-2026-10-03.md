# Agentic change review, amendment A2, 2026-10-03. Committed before any case run.

Amends `agentic-review-amendment-A1-2026-10-03.md` section 1 by reference; A1 is left byte-identical.
It corrects one rule that A1 stated imprecisely, found while building the preparation script and
before any case was prepared or run.

**The batch-1 anchor line.** A1 says the anchor is the old-side start line of the fix diff's first
hunk in `git diff <parent> <fix> -- <path>`. With git's default three lines of context that start
line sits up to three lines BEFORE the first changed line, and can fall in the previous function,
so the defect window would be drawn around the wrong code.

The rule that binds: run the diff with zero context (`git diff -U0 <parent> <fix> -- <path>`) and
read the first hunk header `@@ -a[,b] +c[,d] @@`.
- If the old side has lines (`b` absent or greater than 0), the anchor is `a`, the first line the
  fix changes or removes.
- If the old side is empty (`b` is 0, a pure insertion after line `a`), the anchor is `a + 1`, the
  line the inserted code now precedes, which is the line the added guard protects.

This applies to the four post-cutoff cases only. The held-out ten keep their frozen anchors from
`forced-routing-2026-09-28/anchors-2026-09-28.tsv`. The rule is exercised in the rehearsal (a fix
that inserts a guard before the unguarded line yields that line as the anchor).

Nothing else in the pre-registration or in A1 changes.
