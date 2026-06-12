# -*- coding: utf-8 -*-
"""Fixor secrets scanner — pre-commit hook and CI tripwire (defense-in-depth next to gitleaks).

Lifted from rasw scripts/secrets_scan.py (2026-06-12). Scans tracked/working files for
credential patterns. Exit 1 on any finding.
Usage:
  python scripts/secrets_scan.py            # scan the whole working tree
  python scripts/secrets_scan.py --staged   # scan only git-staged files (pre-commit)
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS = [
    ("anthropic key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_\-]{32,}")),
    ("aws access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github token", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("jwt (supabase service/anon)", re.compile(r"eyJ[A-Za-z0-9_\-]{30,}\.[A-Za-z0-9_\-]{30,}\.[A-Za-z0-9_\-]{10,}")),
    ("paddle key", re.compile(r"pdl_(?:live|sdbx)_[A-Za-z0-9]{10,}")),
    # header alone is not a finding (docs/placeholders mention it); require a key body
    ("private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{40,}")),
    ("generic assignment", re.compile(r"""(?i)(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{24,}['"]""")),
]

# Canonical documentation-example values that are public by definition.
FAKE_VALUES = {"AKIAIOSFODNN7EXAMPLE"}

SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "test-output", ".claude"}
SKIP_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".woff", ".woff2", ".ico", ".zip", ".csv"}
# This scanner and its docs legitimately contain pattern text.
SKIP_FILES = {"scripts/secrets_scan.py", "docs/APP-ROUTER-COVERAGE-PLAN.md"}
# Fixor's own detector test corpus intentionally contains fake credentials.
SKIP_PREFIXES = ("fixtures/",)


def staged_files() -> list[Path]:
    out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
                         capture_output=True, text=True, cwd=ROOT)
    return [ROOT / line for line in out.stdout.splitlines() if line.strip()]


def all_files() -> list[Path]:
    files = []
    for p in ROOT.rglob("*"):
        if p.is_dir():
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        # .env is the sanctioned gitignored home of the local dev key; full-tree scans
        # don't flag it. --staged scans DO include it, so a force-add is still blocked.
        if p == ROOT / ".env":
            continue
        files.append(p)
    return files


def main() -> int:
    targets = staged_files() if "--staged" in sys.argv else all_files()
    findings = []
    for f in targets:
        rel = f.relative_to(ROOT).as_posix()
        if rel in SKIP_FILES or rel.startswith(SKIP_PREFIXES) or f.suffix.lower() in SKIP_SUFFIXES or not f.exists():
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for name, pat in PATTERNS:
            for m in pat.finditer(text):
                if m.group(0) in FAKE_VALUES:
                    continue
                line_no = text.count("\n", 0, m.start()) + 1
                findings.append(f"{rel}:{line_no}  [{name}]")

    if findings:
        print("SECRETS SCAN FAILED — potential credentials found (values not shown):")
        for f in findings:
            print("  " + f)
        return 1
    print(f"secrets scan clean ({len(targets)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
