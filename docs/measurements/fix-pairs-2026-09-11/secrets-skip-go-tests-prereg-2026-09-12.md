# Pre-registration: Go `*_test.go` in the secrets-exposure skip rule, written before the run

Date: 2026-09-12. One change measured at a time: this is the step the 2026-09-12 skip-list
change (#212) deliberately left out and pre-registered as its own.

## The change (candidate)

The secrets-exposure copy only, again: `SKIP_FILE_RE` gains the alternative `_test\.go$`
(the Go convention for test files, which have no test-named directory). No segment changes.
The five sibling copies stay as they are, for the reason recorded on #212.

## Predicted effect, computed from the post-#212 flag sets (no run)

| corpus | flags today (after #212) | candidate removes | keeps | real among removed |
|---|---|---|---|---|
| 13 step-4 clones (mature) | 35 | 20 (grafana 17, gitea 3) | 15 | 0 |
| 43 ICP repositories | 5 | 0 | 5 | 0 |

The 20 paths are listed in `secrets-skip-go-tests-prereg-2026-09-12.json`. Pass condition:
mature 35 to exactly 15 with exactly those 20 paths gone and nothing added; ICP 5 to
exactly 5 with nothing removed and nothing added and the three real keys still flagged;
file denominators unchanged. Anything else is a stop.

## The miss class this creates, to be stated in the DOES NOT CLAIM row in the same commit

A credential sitting in a Go test file (`*_test.go`) is not detected by the secrets check,
deliberately. Evidence for the trade, from two corpora and not a property: the 20 Go
test-file flags removed on the mature corpus were all read blind on 2026-09-12 and none was
a real credential; the ICP corpus, TypeScript and JavaScript only, has no Go file among its
flags, so it says nothing either way about Go.
