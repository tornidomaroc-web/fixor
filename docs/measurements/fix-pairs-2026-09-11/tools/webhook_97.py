"""Webhook slice of the keyword arm: the diff packets for the 97 webhook-unverified keyword
candidates across the twelve fix-pair clones. Same diff instrument as shape_sample.py (EXT
and SKIP filters, `git show --format= --no-color <sha> -- <files>`, so no commit message
reaches a reader); the twenty-server PREFIX is dropped because the candidates span twelve
repositories. Blob fetches happen through each blobless clone's promisor remote when
`git show` runs. No API key, no model call. Reads git history only.

Usage: python webhook_97.py <corpus_root> <sha_list_glob> <out_dir>
  corpus_root   directory holding the twelve clones by bare name
  sha_list_glob glob over fix-pairs-candidate-counts.<repo>.webhook-unverified.shas
  out_dir       receives diff-<sha12>.patch per candidate and records.json (sha, repo,
                files, changed_lines, subject); records.json is NEVER shown to a reader.
"""
import sys, io, os, re, json, glob, subprocess

corpus, shaglob, outdir = sys.argv[1:4]
os.makedirs(outdir, exist_ok=True)
EXT = re.compile(r'\.(js|jsx|ts|tsx|py|go|rb|java|kt)$', re.I)
SKIP = re.compile(r'(^|/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(/|$)', re.I)
NAME = re.compile(r'fix-pairs-candidate-counts\.(.+)\.webhook-unverified\.shas$')


def git(repo, *a):
    return subprocess.run(['git', '-C', repo] + list(a), capture_output=True).stdout.decode('utf-8', 'replace')


records = []
for f in sorted(glob.glob(shaglob)):
    m = NAME.search(os.path.basename(f))
    if not m:
        continue
    name = m.group(1)
    repo = os.path.join(corpus, name)
    shas = [l.strip() for l in io.open(f, encoding='utf-8') if l.strip()]
    for sha in shas:
        names = git(repo, 'diff-tree', '--no-commit-id', '-r', '--name-only', sha).split('\n')
        names = [n for n in names if n]
        files = [n for n in names if EXT.search(n) and not SKIP.search(n)]
        diff = git(repo, 'show', '--format=', '--no-color', sha, '--', *files) if files else ''
        changed = [l for l in diff.split('\n') if (l.startswith('+') or l.startswith('-')) and not l.startswith('+++') and not l.startswith('---')]
        subj = git(repo, 'log', '-1', '--format=%s', sha).strip()
        date = git(repo, 'log', '-1', '--format=%cs', sha).strip()
        io.open(os.path.join(outdir, f'diff-{sha[:12]}.patch'), 'w', encoding='utf-8', newline='\n').write(diff)
        records.append({'sha': sha, 'repo': name, 'date': date, 'all_files': len(names), 'files': files,
                        'changed_lines': len(changed), 'bytes': len(diff.encode('utf-8')), 'subject': subj})
        sys.stderr.write(f'{name} {sha[:12]} files={len(files)}/{len(names)} changed={len(changed)}\n')

io.open(os.path.join(outdir, 'records.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps({
    'instrument': 'webhook_97.py: EXT and SKIP as shape_sample.py, no PREFIX, git show --format= --no-color',
    'count': len(records), 'records': records}, indent=1))
print(f'{len(records)} candidates; diffs in {outdir}')
