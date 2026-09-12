"""Census of the ten generated-content segments: which of them actually remove commits.

DESCRIPTIVE, NOT A WITNESS. It carries no prediction and no pre-registration, because it
predicts nothing: it is a complete enumeration of every non-merge commit reachable from each
clone HEAD, not a sample. It exists to settle, structurally rather than by choosing, the
ambiguity left by the failed W2-twenty arm in path-population-witness-2026-09-12.json:
dropping locales? from GEN left twenty's excluding-generated column at 11,747 exactly, and
that null does not distinguish (a) a prediction that picked a segment with no bite on twenty
from (b) a check blinded by the conjunction in the semantics.

The constants are IMPORTED from path_population.py and asserted unchanged; nothing is edited
in place and no constant is redeclared here. The ten per-segment regexes are a DECOMPOSITION
of the tracked GEN, and the decomposition is checked against it on every file encountered:
union_mismatch counts any file where "matches one of the ten" and "matches GEN" disagree. A
non-zero count there invalidates the whole table and is reported rather than repaired.

THREE FIGURES PER SEGMENT, plus a denominator. The first two were asked for; the third is
added because without it an idle segment cannot be told apart from an absent one, which is
exactly the question twenty poses:
  touches        commits with at least one qualifying file under that segment. Separates
                 "the segment never appears in this repository" from "it appears but never
                 decides".
  removes_alone  commits where EVERY qualifying file is under that segment, so the segment
                 would remove the commit if it were the only generated segment. The
                 segment's individual removal count.
  unique         commits removed by the full GEN that stop being removed when this segment
                 alone is dropped from it. An idle segment scores 0 here and 0 in
                 removes_alone; a redundant segment scores above 0 in removes_alone and 0
                 here. This is the drop-one-out quantity W2 perturbed.
Denominator, per repository: removed_by_full_GEN = path_population - excluding_generated.
Every figure in the table is a count of commits out of that repository's path_population.

R12: a finding on one repository is not transferred to any other. The table is per
repository for that reason and carries no corpus-wide row.

Trees only, GIT_NO_LAZY_FETCH=1 through path_population.git, zero spend, no API key, no
model call, no network.

Usage:  python gen_segment_census.py <corpus_dir> <out_json>
"""
import re, os, io, sys, json, time

import path_population as pp

# Decomposition of the tracked GEN into the ten segments selector-b.md point 2 names.
SEGMENTS = ['generated', 'locale', 'locales', 'i18n', 'translation', 'translations',
            'vendor', 'node_modules', 'dist', 'build']
SEG_RE = [(s, re.compile(r'(^|/)' + re.escape(s) + r'(/|$)', re.I)) for s in SEGMENTS]


def census_one(repo):
    head_before = pp.git(repo, 'rev-parse', 'HEAD').strip()
    t = time.time()
    out = pp.git(repo, 'log', '--no-merges', '--format=@@%H', '--name-only', 'HEAD')
    head_after = pp.git(repo, 'rev-parse', 'HEAD').strip()
    if head_before != head_after:
        raise RuntimeError('HEAD moved during the census of ' + repo + '; aborted')

    n = len(SEGMENTS)
    touches = [0] * n
    removes_alone = [0] * n
    unique = [0] * n
    nonmerge = path_pop = excl_gen = 0
    union_mismatch = 0

    for block in out.split('@@')[1:]:
        lines = block.strip().split('\n')
        sha = lines[0]
        files = [f for f in lines[1:] if f]
        nonmerge += 1
        if not pp.SHA40.match(sha):
            continue
        ok = [f for f in files if pp.EXT.search(f) and not pp.SKIP.search(f)]
        if not ok:
            continue
        path_pop += 1

        masks = []
        for f in ok:
            m = 0
            for i, (_, rx) in enumerate(SEG_RE):
                if rx.search(f):
                    m |= (1 << i)
            # the decomposition must agree with the tracked GEN on every file
            if bool(m) != bool(pp.GEN.search(f)):
                union_mismatch += 1
            masks.append(m)

        in_R = all(m != 0 for m in masks)        # removed by the full GEN
        if not in_R:
            excl_gen += 1                        # survives into the draw universe

        any_mask = 0
        all_mask = masks[0]
        for m in masks:
            any_mask |= m
            all_mask &= m
        for i in range(n):
            bit = 1 << i
            if any_mask & bit:
                touches[i] += 1
            if all_mask & bit:
                removes_alone[i] += 1
            # leaves R when this segment alone is dropped: some file matched only it
            if in_R and any(m == bit for m in masks):
                unique[i] += 1

    return {
        'repository': os.path.basename(repo),
        'head': head_before,
        'nonmerge_commits': nonmerge,
        'path_population': path_pop,
        'excluding_generated_segments': excl_gen,
        'removed_by_full_GEN': path_pop - excl_gen,
        'union_mismatch_files': union_mismatch,
        'seconds': round(time.time() - t, 1),
        'segments': {
            s: {'touches': touches[i], 'removes_alone': removes_alone[i], 'unique': unique[i]}
            for i, s in enumerate(SEGMENTS)
        },
    }


def main(corpus, out_json):
    before = pp.constants_manifest()
    repos = sorted(d for d in os.listdir(corpus)
                   if os.path.isdir(os.path.join(corpus, d, '.git')))
    rows = []
    for name in repos:
        r = census_one(os.path.join(corpus, name))
        rows.append(r)
        print(name.ljust(30) + ' pop ' + str(r['path_population'])
              + ' excl ' + str(r['excluding_generated_segments'])
              + ' removedByGEN ' + str(r['removed_by_full_GEN'])
              + ' mismatch ' + str(r['union_mismatch_files'])
              + '  ' + str(r['seconds']) + 's', flush=True)
        # written the moment the repository completes: a halt loses nothing already earned
        tmp = out_json + '.partial'
        io.open(tmp, 'w', encoding='utf-8', newline='\n').write(json.dumps(rows, indent=1))
    after = pp.constants_manifest()
    doc = {
        'measurement': 'census of the ten generated-content segments, per repository',
        'date': '2026-09-12',
        'zeroSpend': True, 'apiKeyPresent': False,
        'isA': 'a complete enumeration of every non-merge commit reachable from each clone '
               'HEAD, per repository, with every figure a count of commits out of that '
               "repository's path_population",
        'isNot': 'a sample, a rate, a witness, or a result transferable between '
                 'repositories (R12)',
        'settles': 'whether the W2-twenty null is explained by a segment with no bite on '
                   'twenty, or by the conjunction in the semantics blinding the check',
        'figures': {
            'touches': 'commits with at least one qualifying file under the segment',
            'removes_alone': 'commits where every qualifying file is under the segment',
            'unique': 'commits removed by the full GEN that stop being removed when this '
                      'segment alone is dropped',
            'denominator': 'removed_by_full_GEN = path_population - excluding_generated',
        },
        'constants_before': before, 'constants_after': after,
        'tracked_constants_untouched': before == after,
        'decomposition_check': 'union_mismatch_files counts files where "matches one of the '
                               'ten" and "matches the tracked GEN" disagree; any non-zero '
                               'count invalidates the table',
        'git': pp.git_version(),
        'repositories': rows,
        'total_union_mismatch_files': sum(r['union_mismatch_files'] for r in rows),
    }
    io.open(out_json, 'w', encoding='utf-8', newline='\n').write(json.dumps(doc, indent=1) + '\n')
    try:
        os.remove(out_json + '.partial')
    except OSError:
        pass
    print('tracked constants untouched: ' + str(doc['tracked_constants_untouched']), flush=True)
    print('total union mismatch files: ' + str(doc['total_union_mismatch_files']), flush=True)
    print('CENSUS DONE', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
