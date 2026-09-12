"""Shape sample on twenty, per the committed pre-registration. Reads git history only; blob
fetches happen through the blobless clone's promisor remote when `git show` is run.
No API key, no model call. Usage: python shape_sample.py <repo_dir> <population.shas> <keyword_sha_glob> <out_dir>
"""
import sys, io, os, re, json, random, subprocess, glob

repo, popfile, kwglob, outdir = sys.argv[1:5]
os.makedirs(outdir, exist_ok=True)
HEAD = subprocess.check_output(['git', '-C', repo, 'rev-parse', 'HEAD']).decode().strip()
SEED = int(HEAD[:8], 16)
S = 500
EXT = re.compile(r'\.(js|jsx|ts|tsx|py|go|rb|java|kt)$', re.I)
SKIP = re.compile(r'(^|/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(/|$)', re.I)
PREFIX = 'packages/twenty-server/src/'

pop = [l.strip() for l in io.open(popfile) if l.strip()]
kw = set()
for f in glob.glob(kwglob):
    kw.update(l.strip() for l in io.open(f) if l.strip())
rng = random.Random(SEED)
sample = rng.sample(pop, S)
io.open(os.path.join(outdir, 'shape-sample-twenty.sample.txt'), 'w').write('\n'.join(sample) + '\n')

SHAPES = {
    'auth-bypass': ('+', re.compile(r'guard|authenticat|isAuthenticated|currentUser|req\.user|session\.user|unauthorized|\b401\b|AuthGuard', re.I)),
    'admin-check': ('+', re.compile(r'\badmin|\brole\b|permission|forbidden|\b403\b|superuser', re.I)),
    'idor': ('+', re.compile(r'workspaceId|userId|ownerId|memberId|belongsTo|canAccess|where\s*[:(]\s*\{[^}]*\bid\b', re.I)),
    'env-exposure': ('-', re.compile(r'(process\.env|os\.environ|os\.Environ).*(res\.|json\(|log|stringify)|(res\.|json\(|log|stringify).*(process\.env|os\.environ|os\.Environ)', re.I)),
    'secrets-exposure': ('-', re.compile(r'(key|secret|token|password)\w*\s*[:=]\s*["\'][^"\']{16,}["\']', re.I)),
    'webhook-unverified': ('+', re.compile(r'signature|hmac|timingSafeEqual|\bverify|constructEvent', re.I)),
}
MAX_LINES = 600
records = []
for i, sha in enumerate(sample):
    names = subprocess.run(['git', '-C', repo, 'diff-tree', '--no-commit-id', '-r', '--name-only', sha], capture_output=True).stdout.decode('utf-8', 'replace').split('\n')
    files = [f for f in names if f.startswith(PREFIX) and EXT.search(f) and not SKIP.search(f)]
    diff = subprocess.run(['git', '-C', repo, 'show', '--format=', '--no-color', sha, '--'] + files, capture_output=True).stdout.decode('utf-8', 'replace')
    changed = [l for l in diff.split('\n') if (l.startswith('+') or l.startswith('-')) and not l.startswith('+++') and not l.startswith('---')]
    rec = {'sha': sha, 'index': i, 'files': files, 'changed_lines': len(changed), 'keyword_candidate': sha in kw, 'too_large': len(changed) > MAX_LINES, 'prescreen': []}
    if not rec['too_large']:
        for cls, (sign, rx) in SHAPES.items():
            hits = [l for l in changed if l.startswith(sign) and rx.search(l)]
            if hits:
                rec['prescreen'].append({'class': cls, 'hits': len(hits), 'example': hits[0][:160]})
        if rec['prescreen']:
            io.open(os.path.join(outdir, f'diff-{sha[:12]}.patch'), 'w', encoding='utf-8').write(diff)
    subj = subprocess.run(['git', '-C', repo, 'log', '-1', '--format=%s', sha], capture_output=True).stdout.decode('utf-8', 'replace').strip()
    rec['subject'] = subj
    records.append(rec)
    if i % 50 == 0:
        print(f'{i}/{S}', flush=True)

summary = {
    'head': HEAD, 'seed': SEED, 'population': len(pop), 'sample': S,
    'too_large': sum(r['too_large'] for r in records),
    'keyword_candidates_in_sample': sum(r['keyword_candidate'] for r in records),
    'prescreen_positive': sum(1 for r in records if r['prescreen']),
    'prescreen_positive_not_keyword': sum(1 for r in records if r['prescreen'] and not r['keyword_candidate']),
    'by_class_prescreen': {cls: sum(1 for r in records if any(p['class'] == cls for p in r['prescreen'])) for cls in SHAPES},
}
io.open(os.path.join(outdir, 'records.json'), 'w', encoding='utf-8').write(json.dumps({'summary': summary, 'records': records}, indent=1))
print(json.dumps(summary, indent=1))
