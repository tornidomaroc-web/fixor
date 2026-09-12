# Handoff: the fix-pair measurement as of 2026-09-12 (second revision)

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
  shape-sample draw with its 224 diffs and four verdict files.
- Instruments, tracked in `tools/` here: `shape_sample.py` (the seeded draw, pre-screen and
  diff fetch; the selector B draw reuses it with the generated-segment exclusion added) and
  `make_pairs.py` (pair records from patches plus blind verdicts).
- gitleaks 8.24.3 windows_x64 used for every replay this session sits in a previous
  session's scratchpad (`...\claude\D--RAGHAD-JAD-Fixor-Final\2681e4f3-...\scratchpad\gl\gitleaks.exe`);
  if absent, download the release, verify the zip sha256 starts 3f1a3557, and record it.
- This directory: `README.md` (protocol, #202), `keywords.json` (byte-identical since #202,
  28 `pattern_adjacent` marks), `shape-sample-twenty.md` and its result, verdicts and draw
  list (#203), `selector-b.md` (pre-registration, #204, sizing table complete, twelve rows,
  157,996 path-population commits excluding generated segments), `pairs/` (seven records,
  `MANIFEST.json`).

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
  absent from mature code" is a hypothesis, measured only for secrets (step 4: 80 flags on
  14 repositories, 0 real secrets).

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
| secrets-exposure | shape coverage; false alarms on 13 mature repos and on the ICP corpus; fixture catch; no spend | "Recognises these shapes; on M real files it raised F flags, of which W were wrong; never calls a model" |
| env-exposure | keyless reach count; false alarms on reaching files only with approved spend; no catch on real code by any selector we have | "Catches the authored shapes; on M real files it would have judged R and raised F flags"; no catch rate on real code, said plainly |
| webhook-unverified | decided by reading the 97 keyword candidates blind; otherwise as env-exposure, with the 34 replay recordings behind the fixture claim | conditional on the 97 |

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

## Next actions, in order (owner's order 2026-09-12)

1. SECRETS FALSE-ALARM READING. Rerun the 16-pattern list keyless over the 13 step-4 clones
   (the step-4 harness is `src/test/lib/production-scan.ts`, walker to synthetic diff per
   file to `SecretsExposureDetector.detect()`; May's run reported 80 findings on 71,611
   files across 14 repositories). Report today's flag count against May's 80 with the
   denominator of files scanned, then read every flag blind. Write
   `secrets-false-alarms-<date>.json` here with the corpus named and the readers' verdicts.
   Counts with denominators, never a rate. This touches no key: the shipped path has no
   model call and `FIXOR_SECRETS_LLM_OPT_IN` stays unset.
2. WEBHOOK 97. Read all 97 webhook keyword candidates blind (their sha lists are in the
   drafts directory, `fix-pairs-candidate-counts.<repo>.webhook-unverified.shas`); this is
   the webhook slice of the keyword arm, the arm's 150 otherwise unchanged. Under three
   fixes: the class is absent from this corpus by the only selector with vocabulary for it.
3. STAGE P of selector B: NOT DRAWN. 300 pre-screen positives, 25 per repository, seeds per
   repository HEAD, interleaved with the keyword arm's 150, read blind. Then rounds per
   `selector-b.md`.
4. Stage 1 reach instrument (keyless, on the IDOR rig's triple lock): not built.
5. Stage 2 (spend): only on the owner's approval by detector, against a computed number.

Process rules that bind every step: branch, pull request, merge only on the owner's explicit
command through the three-condition gate (required checks from app_id 15368, MERGEABLE OPEN,
head tree equal from API and local git; main's tree matching it is the only strong
confirmation; the other three are weak and labelled so); gitleaks replay over the staged
files both ways before every commit, raw candidates and findings; Measured date in every
commit body that carries a measurement; no key in the environment for anything in this
measurement; no `git fetch --prune`; no touching `feat/auth-bypass-enable-pending-pairs`;
when a wait goes long, diagnose by process age and file mtime, never by belief in a loop.
