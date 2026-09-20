# Arm A: corrections to the reading, 2026-09-19

Written after the run and before this directory was first committed. It corrects how the Arm A
result should be READ. It does not re-score it. The paired-rule count stays 0, the registered-rule
count stays 0, and the verdict stays FAIL. No prompt, detector, threshold or fixture was changed,
and nothing was re-recorded.

## What is in this directory, and what is not

Committed here: the frozen admission, the pre-registration, both amendments, the zero-spend trigger
dry run, the paid run's own result file, the four tools that produced it, the raw observer log, the
run log, the paired scorer's output, and a manifest of the corpus.

NOT committed: the corpus itself. It is 48 third-party source files, and this repository is public
(see the corpus-measurement block in `.gitignore`, which says as much for the same reason).
`arm-a-corpus-manifest-2026-09-19.tsv` carries the git blob hash of every one of those 48 files
with its repository and commit, so anyone can re-fetch and check them:
`gh api repos/<repo>/contents/<path>?ref=<commit> --jq .sha`. All 48 were checked against GitHub on
2026-09-19 and matched, and every fix commit's recorded parent matched GitHub's.

`.gitattributes` in this directory sets `* -text`. The files here carry recorded hashes over their
exact bytes, and `core.autocrlf` is true on the machine that produced them, so without that line
Git would have normalised CRLF to LF on commit and every recorded hash would have stopped matching
its own file on any non-Windows checkout.

Recorded hashes, sha256, all verified byte-for-byte at commit time:

| file | sha256 | recorded in |
|---|---|---|
| `known-answer-admission.md` | `1224650e3f3e9d14536cb62a5aff9f403c221bf7c73289e908a7a78acf3f9cb4` | the pre-registration, and `run-arm-a.cjs` |
| `field-trial-prereg-2026-09-19.md` | `3c9328572879c061b99a48af6db287d61b97f8296676ab977658faac9e2c9f4c` | `run-arm-a.cjs` |
| `field-trial-amendment-A1-2026-09-19.md` | `3317a1ae98ded2782709cf1f6e5fd87397d4f0e994fc3a1fe268cb090476f6cb` | `run-arm-a.cjs` |
| `field-trial-amendment-A1-cost-2026-09-19.md` | `edadfe38287f45256408c476ab5023c9fac5bd7c12fe619e296ec820a5883dad` | `run-arm-a.cjs` |
| `arm-a-payload-sizes-2026-09-19.jsonl` | `1d9bc1cde3d057614309a284c16fc6ae36e1906da6eefb3729fc0eb2413f44c7` | the A1 cost amendment |
| `tools/run-arm-a.cjs` | `2ebaa9628714b2cd2c117d7a7ed3ae4405ec0df7b757d839e81a5ee9d6ae81dc` | `arm-a-result-2026-09-19.json` |
| `tools/score-arm-a.cjs` | `fef506f93403e11cb14a681531f9984cab5a96e7013c01200c87e6054383be44` | `arm-a-result-2026-09-19.json` |
| `tools/score-paired.cjs` | `df92a3c9934e82b94ea571da487a03ec94c7716d8c79b155557b85b8dee46cba` | `arm-a-result-2026-09-19.json` |
| `tools/trial-observer.cjs` | `59a1eed4df278f06f1767123238fe13ddc89969d81ecf825a11b9ac2effc3b14` | `arm-a-result-2026-09-19.json` |

The three files copied in from the run directory, byte-identical by `cmp` at copy time:
`arm-a-observer-2026-09-19.jsonl` `f43a74b188c09d3e2c0e588be6212f563730c785578e6789d512f6abd18ba1e0`,
`arm-a-run-log-2026-09-19.jsonl` `d6338fe21d9e8a0c02769bc17c27e0b797fb6fcfac2c91561c70ebd08a68560a`,
`arm-a-score-paired-2026-09-19.json` `0013a5316f071981c01ea3cf8a96da7c3ecc3f824ee57a26663d2208c465a48b`.

## 1. Case 07 was scored against a different advisory's lines

The admission takes the FIRST fix commit an advisory cites. For case 07 that commit,
`2c1762b85acb84467ed5e799afe1499cd2f912e6`, fixes TWO advisories at once:

- **GHSA-j7xp-4mg9-x28r**, the admitted one: "IDOR in Knowledge Base File Removal that Allows Cross
  User File Deletion" (CWE-284). Its fix is one line restored in
  `packages/database/src/models/knowledgeBase.ts`: the ownership filter
  `eq(knowledgeBaseFiles.userId, this.userId)` in `removeFilesFromKnowledgeBase`, which had been
  left in the file commented out.
- **GHSA-wrrr-8jcv-wjf5**: "Improper Authorization in Presigned Upload" (CWE-73). Its fix is the
  `getFileMetadata` chain added across `src/server/modules/S3/index.ts`,
  `src/server/services/file/index.ts`, `src/server/services/file/impls/*` and
  `src/server/routers/lambda/file.ts`, so an upload's size comes from S3 instead of the client.

The hunks the scorer used as case 07's target window, in `src/server/routers/lambda/file.ts` and
`src/server/services/file/index.ts`, belong to the SECOND advisory. The IDOR's own file,
`knowledgeBase.ts`, was in the corpus but no detector sent it to the model: it is a model-layer file
with no request-derived source, and its Drizzle `.delete().where(...)` is not one of idor's sink
patterns. The A1 prediction for case 07 ("idor reaches the file router; the fix adds the ownership
filter at that sink") therefore rested on a misreading of the diff.

Admission rule 4 bounds a fix commit by file count. It does not require that the commit fix only the
admitted advisory. A future admission should check that.

## 2. Case 05's root-cause file was never in the corpus

GHSA-fwcm-rqvw-j3p7 is unauthenticated tag-value disclosure through `/api/getTagValue`. The security
change is in `server/runtime/scripts/index.js`: `isAuthorisedByScriptName` returned `true` when the
named script did not exist, so a caller could name any script and pass the check. The admission's
`TEST_RE` excludes any path with a `scripts` segment, so that file was excluded from the corpus and
the model never saw it.

The exclusion is not only the harness's. Fixor's own `SKIP_PATH_RE` carries the same `scripts`
segment in all six detectors, so a full-repository scan would not have read that file either. What
remained in the corpus for case 05 was the `command/index.js` hunk, which changes a `400` status to
`401`, and the `node-red/index.js` hunk, which replaces a substring test on the URL
(`url.includes('/dashboard')`) with a check on `req.baseUrl`.

## 3. "Reaches the model" was counted by lane family, which overstates reach

The pre-registration counts a case as reaching the model when ANY detector of the case's lane FAMILY
calls. The access-control family is auth-bypass, admin-check and idor together. Under that rule,
cases 04 and 10 count as reached, but the detector that called was auth-bypass or admin-check, and
both advisories are IDOR. Read per lane instead of per family:

- idor called the model on the vulnerable file in 0 of the 3 idor cases (04, 07, 10). On 04 it found
  no source-sink pair at all; on 10 the nearest pair was 322 lines apart against a 200-line
  `PROXIMITY_THRESHOLD`; on 07 it read two files, neither of which held the IDOR.
- The end-to-end ceiling of "5 of 12" in the pre-registration is therefore a family-level figure.
  Per lane it is lower.

This changes no count in the result file. It changes what the word "reachable" there means.

## 4. The raw verdicts: 27 calls, 35 verdict objects, none vulnerable

`arm-a-result-2026-09-19.json` records a field `everyVerdictIsVulnerable: [false]`, which does not
state the fact that matters. The fact, read from `arm-a-observer-2026-09-19.jsonl`, the pass-through
log at the SDK boundary:

- **27 calls**, 13 at the vulnerable parents and 14 at the fixes, matching the zero-spend dry run
  case by case. No call failed, no call was refused by the observer's ceiling, and every response
  stopped on `tool_use`, so none was truncated.
- Those 27 calls carry **35 verdict objects**: 23 single verdicts, plus 12 pair verdicts inside the
  4 idor calls, which report one verdict per candidate source-sink pair.
- **0 of the 35** carry `isVulnerable` anything other than `false`.

So the zero is not an artifact of Fixor's emit policy, its report writer or the scorer. The model
was asked 35 times and answered no 35 times. Both report files and the scorer agree, and the
rehearsal against an always-vulnerable mock had already shown that the report-to-scorer path does
register hits when there are any.

## 5. The pre-registration is local and unanchored

Neither the admission, the pre-registration nor either amendment was committed or published before
the run. Their ordering rests on two local records:

- an internal hash chain: the admission's hash is inside the pre-registration; the hashes of the
  pre-registration and both amendments are in `run-arm-a.cjs`, which checks them before the first
  call and stops on a mismatch; `run-arm-a.cjs`'s own hash is in the result file;
- the authoring session's transcript, which shows each file written, and each file's current hash
  printed, before the first paid call at 17:55:04Z.

Both records are local and editable by the owner. The Anthropic Console usage window is external but
attests only to when calls happened, not to what any document said. **This commit is the first
public anchor, and it is made after the result.** Do not cite this as a git-anchored
pre-registration. Two orderings are disclosed in the documents themselves and repeated here: the
zero-spend trigger dry run ran BEFORE the pre-registration was written, and amendment A1 changed the
hit rule after a zero-spend rehearsal against a mock model, before any paid call.

## 6. A false positive of the hook scanner on this directory's own runner, and PR #230

`scripts/secrets_scan.py`, the pre-commit hook and CI tripwire, flags `tools/run-arm-a.cjs:103`
under its `generic assignment` pattern. The matched string is
`API_KEY = "fixor-rehearsal-placeholder-no-network"`, and that value is assigned only in the
runner's rehearsal branch (`if (!live)`), so that a rehearsal cannot reach the network. There is no
credential on that line. It is a FALSE POSITIVE. Gitleaks 8.24.3 flags nothing there, under the
repository config or under its 208 default rules with allowlisting disabled.

Record it as a false positive of the HOOK SCANNER, which carries 8 patterns. It is NOT a
measurement of the shipped `secrets-exposure` detector, which is a different instrument, with 16
patterns and its own false-alarm counts measured on named corpora. This must not be folded into
those numbers.

The finding blocked this record from landing: the required CI job `gitleaks + pattern scan` ends
with `python scripts/secrets_scan.py`, with no `--staged`, so it scans the whole tree of the
checked-out commit. **PR #230 (`chore/secrets-scan-placeholder-exception`) therefore lands first.**
It exempts the matched STRING through `FAKE_VALUES` rather than the path through `SKIP_FILES`, so
every other line of the runner stays scanned, and the exempted line's bytes are frozen by the
sha256 recorded in `arm-a-result-2026-09-19.json`, so the exemption cannot silently outlive what it
was written for. Its negative control: a temporary file carrying a different value of the same
shape is still flagged while the runner is not.

Nothing in this directory was edited to make a scan pass.

## What is not corrected here

The per-case causes above are one reader's analysis of the code and the diffs. No second,
independent method has been applied to them, so by the repository's own rule they are not settled.
The counts, the hashes, the call totals and the 35 verdict objects are mechanical and re-checkable
from the files in this directory.
