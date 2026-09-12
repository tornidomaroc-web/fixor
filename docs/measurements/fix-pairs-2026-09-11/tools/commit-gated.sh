#!/usr/bin/env bash
# Commit gate for the fix-pair measurement. Every check that guards a commit runs
# in THIS script, each exits non-zero on failure, and the commit is the last line,
# so nothing can be joined after a failure with a semicolon. Added 2026-09-12 after
# two chains that day ran past a failed check (a replay that printed findings and
# exited 0; a comparison that printed false and was skipped).
#
# This file is TRACKED on purpose. The previous session's copy lived in a scratchpad
# and was gone by the next morning, as was the counting job behind selector-b.md's
# sizing table, which had to be recovered from a session transcript.
#
# Usage:  GITLEAKS=/path/to/gitleaks.exe tools/commit-gated.sh <message-file>
# Stages nothing. Stage first, then run this.

set -euo pipefail

MSG_FILE="${1:?usage: commit-gated.sh <message-file>}"
[ -f "$MSG_FILE" ] || { echo "FAIL: message file not found: $MSG_FILE" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

GITLEAKS="${GITLEAKS:-$(command -v gitleaks || true)}"
[ -n "$GITLEAKS" ] && [ -x "$GITLEAKS" ] || {
  echo "FAIL: gitleaks binary not found. Set GITLEAKS=/path/to/gitleaks" >&2; exit 1; }

SELECTOR_B="docs/measurements/fix-pairs-2026-09-11/selector-b.md"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAGE="$TMP/staged"; EMPTY="$TMP/empty"
mkdir -p "$STAGE" "$EMPTY"

# ---------------------------------------------------------------- CHECK 1
# Something is staged.
mapfile -t STAGED < <(git diff --cached --name-only --diff-filter=ACMR)
[ "${#STAGED[@]}" -gt 0 ] || { echo "FAIL check 1: nothing staged" >&2; exit 1; }
echo "check 1 ok: ${#STAGED[@]} staged path(s)"

# ---------------------------------------------------------------- CHECK 2
# Staged-blob hash match: the worktree file must equal what is staged, so the
# bytes reviewed are the bytes committed. Expressed as git's own index-vs-worktree
# diff, which applies the same .gitattributes eol filters the index does.
DIRTY="$(git diff --name-only -- "${STAGED[@]}")"
[ -z "$DIRTY" ] || {
  echo "FAIL check 2: staged paths edited after staging:" >&2
  echo "$DIRTY" >&2; exit 1; }
for f in "${STAGED[@]}"; do
  printf 'check 2   %s  %s\n' "$(git ls-files -s -- "$f" | awk '{print substr($2,1,12)}')" "$f"
done
echo "check 2 ok: index equals worktree for every staged path"

# ---------------------------------------------------------------- CHECK 3
# selector-b.md is a PRE-REGISTRATION. Any edit to it must be purely additive:
# zero deleted lines. "Touching no existing figure" becomes a gate, not a promise.
if git diff --cached --name-only --diff-filter=ACMR | grep -qxF "$SELECTOR_B"; then
  NUMSTAT="$(git diff --cached --numstat -- "$SELECTOR_B")"
  DELETED="$(printf '%s' "$NUMSTAT" | awk '{print $2}')"
  [ "$DELETED" = "0" ] || {
    echo "FAIL check 3: $SELECTOR_B deletes $DELETED line(s); edits must be additive" >&2
    git diff --cached -- "$SELECTOR_B" >&2; exit 1; }
  echo "check 3 ok: $SELECTOR_B additive only (0 deleted lines)"
else
  echo "check 3 ok: $SELECTOR_B not staged"
fi

# ---------------------------------------------------------------- CHECK 4/5
# gitleaks replay over the staged CONTENT, both ways. The staged bytes are
# materialised from the index, never read from the worktree.
for f in "${STAGED[@]}"; do
  mkdir -p "$STAGE/$(dirname "$f")"
  git show ":$f" > "$STAGE/$f"
done

assert_clean () {  # <label> <report-path> <exit-code-of-run>
  local label="$1" report="$2" rc="$3"
  [ "$rc" = "0" ] || { echo "FAIL $label: gitleaks exited $rc" >&2; cat "$report" >&2 || true; exit 1; }
  [ -s "$report" ] || { echo "FAIL $label: no report written at $report" >&2; exit 1; }
  # Exit code alone is not believed: the report must itself be an empty array.
  python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
if d:
    print('FAIL '+sys.argv[2]+': '+str(len(d))+' finding(s)',file=sys.stderr)
    for x in d[:10]:
        print('  ',x.get('File'),x.get('RuleID'),x.get('Description'),file=sys.stderr)
    sys.exit(1)
" "$report" "$label"
}

# Way A - FINDINGS: repo semantics, repo config, repo .gitleaksignore.
set +e
"$GITLEAKS" dir "$STAGE" -c "$REPO_ROOT/.gitleaks.toml" -i "$REPO_ROOT" \
  --report-format json --report-path "$TMP/findings.json" \
  --no-banner --redact --exit-code 7 --log-level error
RC_A=$?
set -e
assert_clean "check 4 (findings, repo config)" "$TMP/findings.json" "$RC_A"
echo "check 4 ok: 0 findings under the repo config"

# Way B - RAW CANDIDATES: gitleaks default rules, no repo config, no ignore file,
# gitleaks:allow comments disregarded. Nothing the repo allowlists can hide here.
rm -f "$STAGE/.gitleaks.toml" "$STAGE/.gitleaksignore"
set +e
GITLEAKS_CONFIG= GITLEAKS_CONFIG_TOML= "$GITLEAKS" dir "$STAGE" -i "$EMPTY" \
  --ignore-gitleaks-allow \
  --report-format json --report-path "$TMP/raw.json" \
  --no-banner --redact --exit-code 7 --log-level error
RC_B=$?
set -e
assert_clean "check 5 (raw candidates, default rules)" "$TMP/raw.json" "$RC_B"
echo "check 5 ok: 0 raw candidates under the default rules"

# ---------------------------------------------------------------- COMMIT
# Last line. Nothing runs after it, and nothing above it can be bypassed.
git commit -F "$MSG_FILE"
