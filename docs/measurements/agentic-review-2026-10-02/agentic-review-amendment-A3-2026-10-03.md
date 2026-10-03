# Agentic change review, amendment A3, 2026-10-03. Committed before any case run.

Amends the pre-registration's "How the withholding is enforced" and A1 section 3 by reference;
both are left byte-identical. Two gaps were found while running the preparation on the real cases,
before any judge process was started.

**1. A run that reaches outside its own repository is void.** The pre-registration withholds the
fix and the existence of a fix, and enforces that through history, the network and the repository
checks of A1 3.6. It does not cover the file system. The sibling fix-side state of the same case,
the other cases, the mirrors (which hold the real history) and this checkout all sit on the same
disk, and the allowed tools can name absolute paths.

The rule that binds: a run is void, and the series stops, when any tool call
- in `Read`, `Glob`, `Grep` or `LS` names a path (`file_path`, `path`, `pattern`, `glob`) that is
  absolute, starts with `~`, or has a `..` segment, and does not resolve inside the run's own
  repository; a glob is judged by its prefix before the first wildcard; or
- in `Bash` passes `--no-index`, or an argument with the same property, to an allowed git read.

Plain relative paths, absolute paths inside the repository, and git ranges such as
`origin/HEAD...` are not affected. A1 3.5's visibility limit applies unchanged: the rule covers
the calls the stream-json output shows, and is not claimed to cover sub-tasks.

**2. A network failure during preparation is an infrastructure stop, never a property of a case.**
The mirrors are partial clones, so blame, show and apply fetch file contents on demand. Before this
amendment a failed fetch could be read as "the blame rule rejects the case", "the fix side does not
exist" (a miss under A1 3.1) or "the mirror failed" (a rejection), each of which moves the count
that A1's precondition and Gate A read. The rule that binds: a git read that fails on the network
is retried up to three times; if it still fails, the preparation stops with no manifest and is
rerun. A case is rejected, or has no fix side, only on what git reports about its data.

Observed on 2026-10-03, before this amendment: the first preparation stopped on a network error at
the fourth held-out case, with no manifest written; held-out case 02's missing fix side was
reproduced by hand and is a genuine conflict (two of its three defect files no longer match at I),
not a network error. Nothing from that run is used; the preparation is rerun with both rules in
force.

Both rules are exercised in the rehearsal, and each is shown failing when its fix is reverted.

Nothing else in the pre-registration, A1 or A2 changes.
