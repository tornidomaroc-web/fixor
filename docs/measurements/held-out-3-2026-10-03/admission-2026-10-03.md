# Third held-out set: admission rules, 2026-10-03. Committed BEFORE any candidate was listed.

This file is committed on its own, before the advisory database is queried for this set. Git
carries the order: this commit is the parent of the commit that carries the draw. Nothing in it
may change after the draw starts. A different rule is a different set, with a new name.

## What the set is for

The forced-routing proxy scored the shipped `claude-sonnet-4-6` at PROXY-FAIL (1 of 10) and
`claude-opus-5-5` at PROXY-INCONCLUSIVE (2 of 10) on the held-out ten. Six of those ten had fix and
advisory public before `claude-opus-5-5`'s stated June 2026 cutoff, so a pass there is only an
upper bound. Three pre-registered or owed questions need cases that no model can have learned as
a published finding and that no prompt has been tuned on:
1. the agentic change review (`docs/measurements/agentic-review-2026-10-02/`);
2. the stage-2 prompt revision owed after PROXY-FAIL;
3. any later model comparison.

**The set is sealed.** No prompt, prefilter, detector, lane or harness may be written, tuned or
debugged against it. It is used only by a measurement whose pre-registration is committed before
that measurement reads it. The drawing session reads advisory metadata, fix-commit file lists and
blob ids. It fetches the files to disk to verify their blob ids, and does not read their contents.

## Source and window

GitHub's global advisory database (`GET /advisories`):
- **Type:** both `reviewed` and `unreviewed`. The two earlier sets used `reviewed` npm advisories
  only. A self-hosted application rarely publishes an npm package, so most application advisories
  arrive unreviewed, imported from a CVE.
- **Window:** published from 2026-07-01T00:00:00Z to the draw's run time.
- **CWEs:** at least one CWE in the access-control family Fixor's lanes claim: 284, 285, 287, 288,
  290, 306, 425, 566, 639, 862, 863, 269, 1220. These are Arm A's 18 CWEs without the five
  secrets and disclosure ones (347, 345, 798, 200, 215, 532), plus 290 (authentication bypass by
  spoofing). An advisory with no CWE is out.
- **Listing:** every page is listed, sorted by the API's default order.

## Admission: an advisory is admitted when ALL hold, checked in this order

The first rule a candidate fails is recorded against it, in the rejection log committed with the
draw.

1. **R1, GitHub source.** Its `source_code_location`, or failing that its first reference to a
   `github.com/<owner>/<repo>` URL, names a repository that resolves through the API.
2. **R2, language.** The repository's `language` field in the API is `TypeScript` or
   `JavaScript`.
3. **R3, not already used.** The repository is none of the following:
   - the 12 Arm A repositories (`field-trial-2026-09-19/arm-a-corpus-manifest-2026-09-19.tsv`);
   - the held-out ten (`detector-reach-2026-09-27/held-out-corpus-manifest-2026-09-27.tsv`);
   - `lobehub/lobehub` (the renamed Arm A case 07);
   - any repository named in this repository's tracked tree at this commit
     (`git grep -il owner/name`, case-insensitive).

   The reach work used exactly Arm A and the held-out ten, so it is covered.
4. **R4, application-shaped.** The repository is a self-hosted, multi-user web application with
   an HTTP API and user accounts. Libraries, frameworks, SDKs, CLIs, MCP servers, developer tools
   and single-user desktop apps are out. **This is a judgment,** made from the repository's name,
   description and the advisory summary, and every repository it is applied to is listed with its
   outcome.
5. **R5, lane.** The summary and CWE describe a defect in the application's own server-side code
   of one of three classes: **auth-bypass** (a route or operation reachable without the
   authentication it requires), **admin-check** (a privileged operation reachable without the
   role or permission it requires), or **idor** (an object reachable by a caller who does not own
   it or lacks the grant to it). The lane is assigned from the summary and CWE alone. **This is
   a judgment,** listed per advisory.
6. **R6, fix commit.** The fix is the FIRST same-repository reference that is either a commit
   (`/commit/<sha>`) or a merged pull request (`/pull/<n>`, resolved to its `merge_commit_sha`). It
   must also:
   - resolve through the API;
   - have exactly one parent, which is the vulnerable side;
   - modify between 1 and 10 non-test `.ts/.tsx/.js/.jsx/.mjs/.cjs` files, at least one of which
     exists at the parent.

   The non-test filter is the held-out ten's: the segments `test`, `tests`, `__tests__`, `spec`,
   `e2e`, `fixture`, `fixtures`, `example`, `examples` and `demo`, and names `*.test.*` and
   `*.spec.*`, with no `scripts` exclusion.
7. **R7, dates.** The advisory's `published_at`, the fix commit's author date and its committer
   date are all on or after 2026-07-01T00:00:00Z.
8. **R8, one per repository.** The most recent qualifying advisory in each repository is
   admitted; a tie on the publication day goes to the lowest GHSA id. When the most recent one
   fails R6 or R7, the next most recent is tried.

## Sampling: a census, drawn by seed only if it overflows

Every advisory that passes R1 to R8 is admitted. No candidate is chosen or dropped for any other
reason, and nothing that depends on a model's output enters the draw. No detector, prefilter,
judge or model runs at any point of the drawing.

If more than 30 qualify, the admitted 30 are those with the lowest
`sha256("held-out-3-2026-10-03|" + GHSA id)`. The rest are recorded as "qualified, not drawn".

## Target size, and what happens below it

- **Target: 30 cases. Minimum for any measurement label: 10.**
- **Why 30.** At n = 10 the 95% Clopper-Pearson interval for 2 of 10 is 2.5% to 55.6%, and for 1 of
  10 it is 0.3% to 44.5%. The two arms' results cannot be told apart at that size, which is the
  weakness already hit. At n = 30 the interval for 6 of 30 is 7.7% to 38.6%: still wide, but a
  difference of 20 points between two arms starts to be visible.
- **Expected shortfall, stated before the count is known.** The held-out ten took 33 months of
  reviewed npm advisories (971 of them) to yield 10 cases. This window is three months. Adding
  unreviewed advisories widens it, but by an unknown factor. Fewer than 10 qualifying cases is a
  likely outcome of this first draw.
- **If fewer than 10 qualify:**
  - the cases that do qualify are frozen now as batch 1, and the set is sealed from this commit;
  - the same rules, unchanged and with the same seed, are applied again on the 3rd of each
    following month to advisories published since the previous draw's run time, and each result
    is appended as the next batch;
  - every batch carries its own rejection log, and earlier batches are never re-drawn;
  - no measurement label is applied on the set before it holds 10 admitted cases;
  - the target of 30 stands, and growing past 30 needs a new pre-registration.
- **If 0 qualify,** that count is the result, and it is reported as such.

## The matched clean set

For every defect file of every admitted case that exists at the vulnerable parent, one clean
file is drawn from the same repository at the same parent commit:
- **Candidates:** files in the defect file's own directory, then in its parent directory, then
  in each directory above in turn, up to the repository root. The first level holding any
  eligible file is used.
- **Eligible:** a supported extension, non-test by the R6 filter, of at least 300 bytes, not
  under a `node_modules`, `dist`, `build`, `vendor`, `generated`, `coverage`, `.next`, `public`,
  `locales` or `i18n` segment, not touched by the case's fix commit, and not already drawn for
  this set.
- **The draw:** at that level, the file with the lowest
  `sha256("held-out-3-clean-2026-10-03|" + repo + "|" + path)`.

A clean file has no known advisory. A flag on it is unverified, never a confirmed false positive.

## What is frozen

The manifest holds identifiers only, nothing from the files themselves:
- **per case:** GHSA id, CVE id where present, type, repository, lane, CWEs, publication date,
  fix commit and its author and committer dates, the parent commit;
- **per defect file:** its path and its git blob id at the parent and at the fix (or "absent");
- **per clean file:** its repository, commit, path and blob id.

The rejection log holds every listed advisory and the first rule it failed.

The files themselves are kept outside the repository, beside it, in
`held-out-3-corpus-2026-10-03/`. Each was fetched by blob id and checked against
`sha1("blob <len>\0" + bytes)`. No third-party source is committed: this repository is public.

## Known limits, stated before the draw

- R4 and R5 are one reader's judgments. Their per-repository and per-advisory lists are the
  whole audit trail.
- A late advisory does not mean late code. The vulnerable code can be years old and was in public
  repositories before any cutoff; a model may have seen the code, but not the published finding.
- The set's population is GitHub's advisory database. It shares that database's biases: projects
  that file advisories, and CWE labels as the advisories assign them.
- Fix-commit file lists are read during the draw, so the drawing session knows which files each
  fix touched. That is the anchor information the forced-routing runner uses. A measurement that
  hands it to a model must say so.
