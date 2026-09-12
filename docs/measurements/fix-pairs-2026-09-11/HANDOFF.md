# Handoff: the fix-pair measurement as of 2026-09-12 (sixth revision)

This file is the durable state of the measurement. It lives beside the pre-registrations
because they are the only tracked, swept surface the measurement has: CLAUDE.md is
gitignored and its own rule forbids derived facts there, and a session's context is not a
record (an approved paragraph was lost between two sessions on 2026-09-11 and had to be
resupplied verbatim). A fresh session continues from here without reading a word of the
sessions that wrote it. Update this file in the same commit as any change it describes.

## Goal, and the owner's ruling on what may be said

Three numbers per shipped detector on real code (owner's definition of "ready for a first
customer"): known defects caught, missed, false alarms raised. Counts, never rates; the
10-pair floor per detector counts DISTINCT COMMITS (same-commit siblings are one); the
corpus is mature open source, not the customer's code, and every claim names its corpus.

Owner's ruling 2026-09-12: a detector with a measured false-alarm number and no measured
catch number goes in front of a customer, in exactly the licensed sentence in the table
below and no shorter one, in sales copy included.

## Where things are

- Fix-pair clones: `../fix-pairs-corpus/<name>` relative to this checkout, twelve
  repositories, blobless and no-checkout, 697 MB at clone time (twenty grew to 121 MB from
  the shape sample's blob fetches). Lemmy excluded (Rust).
- Step-4 evidence clones: `test-output/step4-scans/repos/`, 13 shallow clones (the step-4
  table names 14 repositories and 16 sub-scans; only these 13 are on disk, and the manifest
  `step4-corpus-2026-05-15.json` forbids re-cloning or rebuilding twenty's deleted index).
  The secrets rerun below walks working trees and needs no index.
- ICP corpus: `test-output/icp-corpus/`, 43 TS/JS shallow clones, manifest
  `icp-corpus-2026-07-17.json`. Customer-shaped code; short histories.
- Working files (untracked, on disk): `../drafts-2026-09-11-tree-scan/` beside the checkout:
  keyword candidate counts and per-repository sha lists, `selector-b-population.txt`, the
  shape-sample draw with its 224 diffs and four verdict files;
  `secrets-rerun-2026-09-12/` (the 13 per-repository harness outputs of the secrets
  false-alarm rerun, snippets redacted by the harness) and
  `secrets-false-alarms-2026-09-12-verdicts/` (the seven blind reader files and the
  aggregate with the three grounds audits, written before any count was computed);
  `webhook-97-2026-09-12/` (the 97 webhook keyword-candidate diffs as `diff-<sha12>.patch`
  plus `records.json`, which maps sha to repository and is never shown to a reader) and
  `webhook-97-2026-09-12-verdicts/` (one file per blind reader batch, each written by a
  single Write call after the batch's last packet was read, and the aggregate; the reading
  was interrupted by a session limit at 05:17 on 2026-09-12 with nine batches complete and
  three never written, and resumes from those three). Raw reader files stay in the drafts
  directory as the shape sample's did; the consolidated verdicts land in the artifact.
- Instruments, tracked in `tools/` here: `shape_sample.py` (the seeded draw, pre-screen and
  diff fetch; the selector B draw reuses it with the generated-segment exclusion added),
  `make_pairs.py` (pair records from patches plus blind verdicts) and `webhook_97.py` (the
  diff packets for the 97 webhook keyword candidates: same EXT and SKIP filters and the same
  `git show --format=` call as `shape_sample.py`, no twenty-server PREFIX, twelve clones).
- gitleaks 8.24.3 windows_x64 used for every replay this session sits in a previous
  session's scratchpad (`...\claude\D--RAGHAD-JAD-Fixor-Final\2681e4f3-...\scratchpad\gl\gitleaks.exe`);
  if absent, download the release, verify the zip sha256 starts 3f1a3557, and record it.
- This directory: `README.md` (protocol, #202), `keywords.json` (byte-identical since #202,
  28 `pattern_adjacent` marks), `shape-sample-twenty.md` and its result, verdicts and draw
  list (#203), `selector-b.md` (pre-registration, #204, sizing table complete, twelve rows,
  157,996 path-population commits excluding generated segments), `pairs/` (seven records,
  `MANIFEST.json`), `secrets-false-alarms-2026-09-12.json` (the secrets false-alarm
  reading, #206: corpus, instrument, locks, controls, every flag with its three verdicts).

## What is fixed and may not be edited

- README.md: admission rules; the three populations (catch/miss on the parent answer range,
  false alarm on the child at the same range, everything else Population C, unread); reach
  rules (out-of-scope removes; any other stop is a miss; reaching blind is a miss with no
  spend); the floor; the stage-2 cost rule and halt ceiling.
- shape-sample-twenty.md: thresholds and consequences; scored and landed.
- selector-b.md: selector B's definition with the blind reader inside it; precision check
  (USABLE >= 12 of 300, UNUSABLE <= 5, REFUSED 6 to 11); read cap 2,100 in rounds of 50 per
  repository; the keyword list as COMPARISON ARM with its 150-read status test (>= 6
  reinstates, <= 2 stays an arm, 3 to 5 refused); the sibling rule.

## What was found, and what it forbids concluding

- Keyword selector, twelve repositories: admin-check 620 candidates of which 710 message
  matches come from the single word "rbac"; webhook 97; idor 52; secrets 44; auth-bypass
  38; env-exposure 2. The list stays byte-identical.
- Shape sample on twenty (500 of 5,689 server commits, read blind): 5 class fixes, all 5
  outside the keyword selector; MISSES A LOT at the threshold exactly; 0 of 11 keyword
  candidates in the sample was a fix. Forbidden: any rate; anything about the other eleven
  repositories; anything about pre-screen negatives.
- CORRECTION recorded 2026-09-12: the pre-screen fired 0 times for env-exposure and 4 times
  for secrets-exposure across 421 readable diffs, and 23 times for webhook with 0 fixes. A
  pre-screen that never fires cannot tell absence from blindness, so for env-exposure and
  secrets the fix-pair route is UNINFORMATIVE, not "the class is absent". "The class is
  absent from mature code" is a hypothesis, measured only for secrets (step 4, May: 72
  secrets flags on the worklist, 74 in the scan output, 14 repositories, 0 real; the "80"
  the earlier revisions quoted is the worklist total for BOTH detectors, secrets 72 plus
  admin-check 8, and was never a secrets number).
- SECRETS FALSE-ALARM READING, done 2026-09-12 (`secrets-false-alarms-2026-09-12.json`,
  #206). The 16-pattern shipped path, the step-4 harness unmodified (blob 49b9a64c), keyless
  under the replay triple lock in an environment built from scratch, over the 13 step-4
  clones: 58 flags on 65,566 files. May on the same 13 clones: 59 flags on the same 65,566
  (per-repository file counts identical). The one difference is twenty's
  `url.password = '********'` line, removed by the redaction-shape exemption that landed
  after May's scan; the sixteenth pattern (openai_project_key) fired 0 times. A second pass
  calling only `SecretsExposureDetector.detect()` gave the same 58 by file, line and pattern
  with 0 throws. All 58 read blind, three readers each (two protocol, one adversarial told
  to answer "real credential" whenever the packet could not rule it out): 58 not a
  credential, 0 real credential, 0 disagreements; every grounds sentence audited, 0
  failures; a planted live-key packet was called real by all three and a planted placeholder
  not, so the reader instrument can say "real". By shape: password_literal 42 (33 in source
  paths, 9 under test paths the detector's skip list does not name: `api_tests/`,
  `app-tests/`, `e2e-playwright/`, `*.spec.ts`, `*.test.tsx`), private_key_literal 7 (three
  are empty strings), aws_access_key 3, postgres_url_password 3, jwt_secret_literal 2,
  slack_webhook_hardcoded 1. Ten of the 33 source-path password flags are discourse
  `script/import_scripts/` operator placeholders (singular `script/`, outside `SKIP_PATH_RE`).
  Forbidden: any rate; anything about catch; anything about the ICP corpus or cal.com;
  reading these shapes as a change request (the skip list is a detector decision, not a
  measurement result).
- WEBHOOK 97, done 2026-09-12 (`webhook-keyword-97-2026-09-12.json`, #207). All 97 webhook
  keyword candidates across the twelve clones read blind as source-file diffs without the
  commit message, two fresh readers each (one protocol, one skeptic of a zero told to name a
  class whenever the diff could not rule it out), a third fresh reader on the five
  disagreements, three planted controls all called correctly. Result: 3 webhook-unverified
  fixes among the 97, all three agreed by both lenses, all three in discourse, three
  distinct commits (0442741f8cbb Patreon signature compared with `==` and computed on a
  blank secret; e1d4b1637cff Mailpace webhook processed with no signature check while every
  sibling verified; c3070288ea05 five email-provider webhooks processed with no verification
  at all). Three is NOT under three: the pre-registered absence consequence does not fire,
  by one commit. Also found, other classes: 2 auth-bypass (strapi a4723b48c348 JWT verify
  with no algorithm restriction; twenty 40d7e740ef58 token type unchecked), 1 idor
  (discourse 4459742becdb modal resume unbound from its target user). The five A/B
  disagreements all settled to none. Two defect removals were recorded as none because they
  sit outside every class scope (a timing-safe compare in a password-reset code check and
  in an SSO signature check). Forbidden: any rate; treating 3 of 97 as a property of the
  class rather than of this selector; anything about webhook fixes described without the
  keyword vocabulary (stage P, not drawn, is the instrument for those). The reading was
  interrupted by a session limit at 05:17 with nine batches complete and three never
  written; the artifact records the single-write property that made the surviving files
  whole, the re-run of the three in the next window, and the caveat that a tool call proves
  a packet was requested, not absorbed.
- SECRETS ICP READING, done 2026-09-12 (`secrets-false-alarms-icp-2026-09-12.json`, #208).
  The same instrument as the mature-code reading, unchanged (harness blob 49b9a64c, detector
  blob e50c7c37, replay triple lock, six controls re-run and passed, second pass identical
  with 0 throws), over the 43 ICP clones (every HEAD equal to the manifest sha): 12 flags on
  4,772 files across 43 repositories, 5 repositories carrying a flag. All 12 read blind by
  three readers each, controls both correct: 9 not a credential, 3 real credential, 0
  disagreements. THE THREE REAL ONES are all in ONE repository, three full-length Google
  API key literals (google_api_key) in production command handlers of a bot, each used in a
  live request. This is the less mature population and therefore the number the owner
  would have to stand behind with a customer; beside the mature-code number and never
  merged with it: mature 58 flags on 65,566 files, 58 wrong, 0 real; ICP 12 flags on 4,772
  files, 9 wrong, 3 real. The artifact omits the repository and file of the three real flags
  because this repository is public and a locator to a live key is a disclosure; the full
  record stays in the untracked drafts directory. Forbidden: any rate; anything about
  catch; treating three keys in one repository as a property of the population.
- SECRETS ROW COMPLETED 2026-09-12 (#210, relanded from #209 whose first commit carried
  three replay findings in the shape artifact), the first detector in this project with all
  three numbers measured on the shipped path. (1) Shape coverage
  (`secrets-shape-coverage-2026-09-12.json`): against the 208 default rules of gitleaks
  8.24.3, extracted from the CI binary, Fixor's 16 patterns cover 5 (aws-access-token,
  gcp-api-key, openai-api-key, slack-webhook-url, stripe-access-token, each with a named
  narrower scope), partly cover 2 (private-key, generic-api-key) and do not cover 201;
  of the 16 patterns 9 have a counterpart in that ruleset and 7 do not (anthropic_key,
  postgres_url_password, stripe_live_publishable and the four context shapes). Settled by
  synthetic samples run through both instruments; gitleaks' default rules fire on only 2
  of our 29 fixtures because the fixture literals are authored fakes. (3) Fixture catch on
  the shipped path (`secrets-fixture-catch-2026-09-12.json`): 16 of 16 positives flagged
  with their pinned pattern, 0 of 13 negatives flagged, 0 model call attempts, keyless
  under the lock; this replaces the 20/20 figure recorded with the LLM path on. Forbidden:
  any rate; reading "covers 5 of 208" as a quality claim in either direction (the 201 are
  mostly provider token formats no customer asked for; the sentence says what is covered
  and nothing about what is not).

## The redefinition for secrets-exposure (adopted 2026-09-12)

secrets-exposure's shipped path is regex-only and never calls the model. Its three numbers
are redefined as: (1) shape coverage against a reference ruleset (the gitleaks default
rules of the CI binary), (2) false alarms on real code with the denominator of files
scanned, on the 13 step-4 clones and on the ICP corpus, and (3) fixture catch (the 20/20
suite). It DROPS OUT of fix pairs: reading fix commits to prove a regex matches its own
pattern spends the finite reading budget for nothing. The 16 patterns as of main
2a0ca13: supabase_service_role, next_public_service_role, next_public_suspicious,
firebase_admin_import, stripe_live_secret, anthropic_key, openai_project_key,
google_api_key, stripe_live_publishable, aws_access_key, aws_secret_literal,
jwt_secret_literal, private_key_literal, password_literal, postgres_url_password,
slack_webhook_hardcoded (`PREFILTER_PATTERNS` in `secrets-exposure.detector.ts`).

## Licensed sentence per detector (what the owner may say to a first customer)

| detector | number obtainable | licensed sentence |
|---|---|---|
| admin-check | catch, miss, false alarm on fix pairs, about 24 commits under the cap; literal tier keyless | "On N real fixes in mature open source it caught k and missed m, with f false alarms on the fixed files" |
| idor | same, about 24 commits | same, with the single-file co-location bound stated beside it |
| auth-bypass | same, about 12 commits, borderline for the floor | same if the floor holds; a case list and no number if not |
| secrets-exposure | ROW COMPLETE 2026-09-12, all on the shipped path, one instrument, no spend: shape coverage 5 of 208 gitleaks 8.24.3 default rules covered and 2 partly, 9 of 16 patterns with a counterpart (`secrets-shape-coverage-2026-09-12.json`); false alarms 13 step-4 clones 58 flags on 65,566 files, 58 wrong, 0 real (`secrets-false-alarms-2026-09-12.json`) and 43 ICP repositories 12 flags on 4,772 files, 9 wrong, 3 real in one repository (`secrets-false-alarms-icp-2026-09-12.json`); fixture catch 16 of 16 positives, 0 of 13 negatives flagged (`secrets-fixture-catch-2026-09-12.json`) | "Fixor's secrets check matches sixteen fixed credential shapes and never calls a model: on 4,772 files across 43 public TypeScript and JavaScript repositories of the size and age of a typical customer it raised 12 flags, 9 of them not credentials and 3 of them real API keys; on 65,566 files across 13 mature open-source repositories it raised 58 flags, all 58 not credentials; it flagged 16 of 16 authored positive fixtures and 0 of 13 authored negatives; and of the 208 rules in the gitleaks 8.24.3 default set it covers 5 outright and 2 in part." Every clause measured; the corpora named; no rate; nothing about what it misses on real code, which is unmeasured and must stay unsaid |
| env-exposure | keyless reach count; false alarms on reaching files only with approved spend; no catch on real code by any selector we have | "Catches the authored shapes; on M real files it would have judged R and raised F flags"; no catch rate on real code, said plainly |
| webhook-unverified | the 97 read 2026-09-12: 3 fixes, 3 distinct commits, all discourse (Ruby); the absence consequence did not fire, by one commit; whether the three are admitted as pairs is decided under README.md's admission rules, not here, and 3 is under the 10-commit floor either way | until the floor is met: a case list and no number; the fixture claim stands on the 34 replay recordings; no catch rate on real code, said plainly |

## The records

Seven records in `pairs/`, all from twenty, all `selector: shape-sample-twenty`, all
ADMITTED, none contested. 5 distinct commits, 7 pairs: 0edc3a385c0c admin-check (child
carries a safety-asserting comment, recorded, not stripped); 23aa859502a8 idor;
77574594f2d6 admin-check (grounds marked moderate); 921a0f01c8a9 idor, three sibling
records with ONE blind verdict copied across them, counted as one; cdd667b1066e auth-bypass.

## Blind reading protocol (verbatim intent, so the next session runs the same instrument)

Fresh subagents, batches of at most 56 diffs, permitted to read ONLY
`docs/detector-capabilities.md` and the diff files; never detector source, fixtures,
scripts; never told which selector, arm or repository a diff came from. Verdict per diff:
one of the six classes or "none", one sentence, the defect lines quoted. "Fix" means the
parent state had the defect and the commit removes it; feature work, refactors, renames,
new permission features, tests, and anything where the defect is not evident from the diff
alone are "none". Verdicts are saved to disk in the drafts directory before anything is
computed from them. For flag readings (not diffs) the same readers see the flagged line
with its file context and answer "real credential" or "not a credential" with one sentence.

KNOWN LIMIT OF THE READING INSTRUMENT (recorded 2026-09-12, a property of the protocol,
not of a run): a packet carries the relative path of every file it touches, and a path such
as `packages/twenty-server/` or a Go import path such as `github.com/grafana/grafana/pkg/`
names the repository even though the reader is never told it. It cannot be closed by path
masking without destroying the judgement the protocol asks for: the reader needs the path
to tell a route handler from a test, a server package from a client bundle, a migration
from a service; and the repository name recurs inside file content (Go import paths,
package imports, class prefixes), so masking the path alone leaves the leak and masking the
content alters the evidence. What the blindness actually protects is the selector, the arm
and the reason a packet is present, none of which is inferable from the packet. In force
since the 2026-09-12 readings: packets renamed to opaque ids, batches shuffled across
repositories, no commit message in a packet, one fresh reader per batch, and this limit
stated beside every verdict count.

## Next actions, in order (owner's order 2026-09-12)

1. SECRETS FALSE-ALARM READING: DONE 2026-09-12, `secrets-false-alarms-2026-09-12.json`
   (#206), summarised under "What was found". The item as first written compared against
   "May's 80"; that figure was both detectors' worklist total, and the secrets comparison is
   59 on the same 13 clones (74 across all 16 May sub-scans on 71,611 files). No key was in
   the environment; the shipped path made no model call; `FIXOR_SECRETS_LLM_OPT_IN` stayed
   unset. Still owed on the secrets row, in no owner-set order: the ICP corpus reading with
   this same instrument and protocol (redefinition part 2, second half); shape coverage
   against the gitleaks 8.24.3 default rules (part 1); fixture catch rerun on the shipped
   path, since the 20/20 log was recorded with the LLM path on (part 3).
2. WEBHOOK 97: DONE 2026-09-12, `webhook-keyword-97-2026-09-12.json` (#207), summarised
   under "What was found": 3 fixes of 97, the absence consequence did not fire. The keyword
   arm's 150 are otherwise unchanged. Owed from it: the admission decision for the three
   webhook fixes and the three other-class fixes under README.md's admission rules (the
   parent answer range, blind verdict, sibling rule), and pair records for those admitted;
   `make_pairs.py` is twenty-specific and needs its repository and path assumptions lifted
   before a discourse or strapi record can be written with it.
3. SECRETS ICP READING: DONE 2026-09-12, `secrets-false-alarms-icp-2026-09-12.json` (#208).
   SECRETS ROW: COMPLETE 2026-09-12 (#210), shape coverage and shipped-path fixture catch
   landed; the licensed sentence in the table above is the first the owner may publish
   with every word measured. Next on secrets, in this order: the owner's approval of the
   upstream notice for the three ICP keys (draft in the drafts directory, not sent); the
   skip-list change (the 19 addressable flags) as detector work on its own PR; then the
   re-measure of BOTH false-alarm corpora on the new instrument, side by side with these.
4. STAGE P of selector B: NOT DRAWN. 300 pre-screen positives, 25 per repository, seeds per
   repository HEAD, interleaved with the keyword arm's 150, read blind. Then rounds per
   `selector-b.md`.
5. Stage 1 reach instrument (keyless, on the IDOR rig's triple lock): not built.
6. Stage 2 (spend): only on the owner's approval by detector, against a computed number.

Standing ruling (owner, 2026-09-12) on the 19 addressable secrets flags, ten discourse
operator placeholders under `script/` and nine under test paths the skip list does not
name: NOT fixed yet. A skip-list change before the measurements are done would leave the 58
measured on a corpus-and-list pair that no longer ships. Order: measure (mature code done,
ICP next, both on this instrument), then fix, then re-measure both corpora on the new
instrument, each instrument's numbers kept side by side and never merged. The same entry
in `docs/REMEDIATION-PROGRESS.md` under L-023 carries the ruling for detector work.

Process rules that bind every step: branch, pull request, merge only on the owner's explicit
command through the three-condition gate (required checks from app_id 15368, MERGEABLE OPEN,
head tree equal from API and local git; main's tree matching it is the only strong
confirmation; the other three are weak and labelled so); gitleaks replay over the staged
files both ways before every commit, raw candidates and findings; Measured date in every
commit body that carries a measurement; no key in the environment for anything in this
measurement; no `git fetch --prune`; no touching `feat/auth-bypass-enable-pending-pairs`;
when a wait goes long, diagnose by process age and file mtime, never by belief in a loop.
