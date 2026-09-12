"""Path population for selector B: the draw universe of stage P, as ordered sha lists.

PROVENANCE. EXT, SKIP and GEN below are COPIED VERBATIM from the job that produced the
sizing table in selector-b.md on 2026-09-11. That job ran as a stdin heredoc, wrote no
file, and died in its final JSON write (a Git-Bash path handed to a Windows Python) after
printing all twelve rows; its rows are therefore its own output and nothing in the table is
estimated. It was recovered on 2026-09-12 from the session transcript of the project
directory D--RAGHAD-JAD-Fixor-Final and is restored here rather than rewritten, so that the
rule of record is the rule that produced the table.

NAMED BY CONTENT, NOT BY SYMBOL. selector-b.md says "outside the SKIP_PATH_RE segments".
When it was written, all six detector copies of SKIP_PATH_RE and this instrument's SKIP
were one rule. #212 widened the secrets-exposure copy and #213 added _test.go to its
SKIP_FILE_RE, so that name now denotes two different rules depending on which detector is
read. SKIP below is character-identical to admin-check.detector.ts's SKIP_PATH_RE at
134ca122, which is the state at count time. Resolve by the pattern strings and their
digests recorded in the artifact, never by the symbol.

GEN equals the ten generated-content segments selector-b.md names in prose
(generated, locale, locales, i18n, translation, translations, vendor, node_modules,
dist, build); locales? and translations? carry the singular/plural pairs.

Trees only, zero spend, no API key, no model call. GIT_NO_LAZY_FETCH=1 is set for every
git invocation, so a blob fetch becomes an error rather than a silent download: the
tree-only claim is enforced, not intended.

Usage:  python path_population.py <corpus_dir> <out_dir>
"""
import subprocess, re, os, io, json, time, sys, hashlib

# --- the recovered constants, verbatim -------------------------------------------------
EXT = re.compile(r'\.(js|jsx|ts|tsx|py|go|rb|java|kt)$', re.I)
SKIP = re.compile(r'(^|/)(test|tests|__tests__|spec|fixtures|examples?|scripts|dev-tools|migrations?|seed|seeds|demo)(/|$)', re.I)
GEN = re.compile(r'(^|/)(generated|locales?|i18n|translations?|vendor|node_modules|dist|build)(/|$)', re.I)

# Generated-exclusion semantics. selector-b.md's prose admits two readings; the recovered
# job implements KEEP_IF_ANY_NONGENERATED. The other is carried here only so the witness
# harness can perturb the READING rather than a regex character.
KEEP_IF_ANY_NONGENERATED = 'keep-if-any-nongenerated'   # recovered job
DROP_IF_ANY_GENERATED = 'drop-if-any-generated'         # the plausible misreading

SHA40 = re.compile(r'^[0-9a-f]{40}$')


def digest(pattern):
    """sha256 of a compiled pattern's SOURCE STRING. Flags are recorded separately by the
    caller: re.I is not part of the string and a digest that ignored it would be blind to
    a case-sensitivity change."""
    return hashlib.sha256(pattern.pattern.encode('utf-8')).hexdigest()


def constants_manifest(ext=EXT, skip=SKIP, gen=GEN):
    """Both the plaintext and the digest. A digest alone is undiagnosable: a future session
    that finds a mismatch needs to see what moved, not only that something did."""
    return {
        name: {'pattern': rx.pattern, 'flags': 'IGNORECASE', 'sha256': digest(rx)}
        for name, rx in (('EXT', ext), ('SKIP', skip), ('GEN', gen))
    }


def git(repo, *args):
    env = dict(os.environ)
    env['GIT_NO_LAZY_FETCH'] = '1'          # a blob fetch is an error, not a download
    p = subprocess.run(['git', '-C', repo, *args], capture_output=True, env=env)
    if p.returncode != 0:
        raise RuntimeError('git ' + ' '.join(args) + ' in ' + repo + ' exited '
                           + str(p.returncode) + ': '
                           + p.stderr.decode('utf-8', 'replace')[-400:])
    return p.stdout.decode('utf-8', 'replace')


def walk(repo, ext=EXT, skip=SKIP, gen=GEN, no_renames=False, prefix=None,
         gen_semantics=KEEP_IF_ANY_NONGENERATED):
    """One repository. Returns counts, the two ordered sha lists, and the pinning fields.

    HEAD is read before and after the walk; a difference aborts THIS repository and no
    other, because a two-pass run that straddles a HEAD change silently mixes universes.
    """
    head_before = git(repo, 'rev-parse', 'HEAD').strip()
    t = time.time()
    args = ['log', '--no-merges', '--format=@@%H', '--name-only']
    if no_renames:
        args.append('--no-renames')
    args.append('HEAD')
    out = git(repo, *args)
    elapsed = round(time.time() - t, 1)
    head_after = git(repo, 'rev-parse', 'HEAD').strip()

    total = 0
    quoted = 0
    malformed = 0
    pop = []        # path population: EXT and not SKIP
    pop_nogen = []  # the draw universe: additionally surviving GEN
    for block in out.split('@@')[1:]:
        lines = block.strip().split('\n')
        sha = lines[0]
        files = [f for f in lines[1:] if f]
        total += 1
        if not SHA40.match(sha):
            # The recovered job splits on '@@'; a path containing '@@' would corrupt a
            # block. Counted rather than repaired, so the hazard is visible in the record.
            malformed += 1
            continue
        quoted += sum(1 for f in files if f.startswith('"'))
        ok = [f for f in files
              if (prefix is None or f.startswith(prefix))
              and ext.search(f) and not skip.search(f)]
        if ok:
            pop.append(sha)
            if gen_semantics == KEEP_IF_ANY_NONGENERATED:
                keep = any(not gen.search(f) for f in ok)
            elif gen_semantics == DROP_IF_ANY_GENERATED:
                keep = not any(gen.search(f) for f in ok)
            else:
                raise ValueError('unknown gen_semantics: ' + str(gen_semantics))
            if keep:
                pop_nogen.append(sha)

    if head_before != head_after:
        raise RuntimeError('HEAD moved during the walk of ' + repo + ': '
                           + head_before + ' -> ' + head_after
                           + '; this repository is aborted')

    return {
        'head': head_before,
        'head_after': head_after,
        'seed': int(head_before[:8], 16),
        'seed_hex': '0x' + head_before[:8],
        'nonmerge_commits': total,
        'path_population': len(pop),
        'path_population_excluding_generated_segments': len(pop_nogen),
        'quoted_paths': quoted,
        'malformed_blocks': malformed,
        'seconds': elapsed,
        'no_renames': no_renames,
        'gen_semantics': gen_semantics,
        'prefix': prefix,
        '_pop': pop,
        '_pop_nogen': pop_nogen,
    }


def write_list(path, shas):
    """Ordered, one identifier per line, WITH a trailing newline. The absence of one in
    twenty-server-population.shas already produced a 5,688-against-5,689 discrepancy in a
    landed artifact, because wc -l counts newlines and not records. Returns the parsed
    record count and the file digest; no caller counts lines."""
    body = '\n'.join(shas) + '\n'
    tmp = path + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(body)
    os.replace(tmp, path)                       # atomic: no half-written list survives
    back = io.open(path, encoding='utf-8').read()
    records = [l for l in back.split('\n') if l.strip()]
    return {'records': len(records),
            'sha256': hashlib.sha256(back.encode('utf-8')).hexdigest(),
            'bytes': len(back.encode('utf-8')),
            'file': os.path.basename(path)}


def git_version():
    return subprocess.run(['git', '--version'], capture_output=True).stdout.decode().strip()


def main(corpus, outdir):
    os.makedirs(outdir, exist_ok=True)
    repos = sorted(d for d in os.listdir(corpus)
                   if os.path.isdir(os.path.join(corpus, d, '.git')))
    print(git_version() + '; ' + str(len(repos)) + ' repositories', flush=True)
    for name in repos:
        repo = os.path.join(corpus, name)
        rec = {'repository': name, 'arms': {}}
        for arm, no_ren in (('as_recovered', False), ('no_renames', True)):
            r = walk(repo, no_renames=no_ren)
            pop, nogen = r.pop('_pop'), r.pop('_pop_nogen')
            if arm == 'as_recovered':          # the population is the as-recovered arm
                r['lists'] = {
                    'path_population': write_list(
                        os.path.join(outdir, name + '.path-population.shas'), pop),
                    'excluding_generated_segments': write_list(
                        os.path.join(outdir, name + '.path-population-nogen.shas'), nogen),
                }
            rec['arms'][arm] = r
            print('  ' + name.ljust(32) + arm.ljust(12)
                  + str(r['nonmerge_commits']).rjust(7)
                  + str(r['path_population']).rjust(7)
                  + str(r['path_population_excluding_generated_segments']).rjust(7)
                  + str(r['seconds']).rjust(8) + 's', flush=True)
        a, b = rec['arms']['as_recovered'], rec['arms']['no_renames']
        rec['arms_agree'] = (a['nonmerge_commits'], a['path_population'],
                             a['path_population_excluding_generated_segments']) == \
                            (b['nonmerge_commits'], b['path_population'],
                             b['path_population_excluding_generated_segments'])
        # Per repository, written the moment that repository completes: a halt loses
        # nothing already earned and leaves no partial list behind.
        tmp = os.path.join(outdir, name + '.json.tmp')
        io.open(tmp, 'w', encoding='utf-8').write(json.dumps(rec, indent=1))
        os.replace(tmp, os.path.join(outdir, name + '.json'))
    print('WALK DONE', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
