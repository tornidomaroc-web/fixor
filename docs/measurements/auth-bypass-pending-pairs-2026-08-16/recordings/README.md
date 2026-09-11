# Recordings for `auth-bypass-pending-pairs-2026-08-16.json`

These four files are the raw recorder output of the paid measurement described in the sibling artifact (`../../auth-bypass-pending-pairs-2026-08-16.json`). They are EVIDENCE, not fixtures.

- Recorded 2026-08-16 by `record-auth-bypass-fixtures` on branch `feat/auth-bypass-enable-pending-pairs` (PR #177, closed unmerged 2026-09-11; branch retained at 88ccbab as evidence).
- Model `claude-sonnet-4-6`, system prompt fingerprint `45a17ae07c26`. As of 2026-09-11 that is the fingerprint `main` ships; nothing on `main` has touched the auth-bypass detector, harness, or spec since the merge base 8161261.
- Each file's name is its request key (sha256 of the request), so the request payload each verdict was produced from is verifiable from the file itself. The artifact carries the verdicts and the reasoning; these carry the request.
- Copied byte-identical from the untracked working-tree files at `fixtures/replay/auth-bypass-multi/<key>.json`. SHA-256 at copy time:
  - `1ae4bed4…` ca4988b227d2a072304a839e2d06187e49f16f51501db8407164cb8648ac6040 (negative/25, verdict false@high)
  - `537ca3ee…` 352efd87c7903492a2691a1b1a646336255907f67c4613efa4f6bdd375d347d6 (positive/24, verdict false@high; result CONFOUNDED by an F1 comment, see artifact)
  - `5d474660…` 9b806a8f1202dce3cc467d02c4a4c1808f29044969fc29ec21c264b101c9aaa2 (negative/24, verdict false@high)
  - `e4e624a0…` 9320eeae77ce2ae1215119548c0ca4784e47c151298a891cf2221ae1308996be (positive/23, verdict false@high on a real inverted-ownership bypass: the clean finding)

## Why they live here and not in `fixtures/replay/`

`fixtures/replay/<detector>/` is the frozen corpus: `test:replay-auth-bypass` asserts each recording matches the corpus's designed intent (positives flag) and `test:recorded-medium-census` pins the corpus size (37 for auth-bypass). Two of these recordings document positives that did NOT flag, so in that directory they make both gates red for as long as the detector behaves as measured. The recorder's own output said: "A mismatch means the frozen response would misrepresent the detector's behavior. Review before committing; do not freeze it as-is."

No test, harness, or scanner reads `docs/measurements/`. Nothing here is loaded by the replay harness, the census, `run-fixture-tests`, or the prefilter tests.

## Do not

- Do not move or copy these into `fixtures/replay/`. That freezes a measured miss into a gate whose contract is that positives flag.
- Do not re-record without authorisation: a second run spends four more calls and overwrites.
- Do not cite `positive/24` (`537ca3ee…`) as evidence of anything; the artifact records why.
