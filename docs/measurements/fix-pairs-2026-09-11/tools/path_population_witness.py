"""Negative witness for path_population.py.

WHY THIS EXISTS. The twelve-row reproduction of selector-b.md's sizing table shows that
matching constants produce matching counts. Nobody had shown the check FAILS when the rule
is wrong, so its discriminating power was assumed rather than measured. Every other gate in
this measurement earns a negative witness (#212 landed five negative fixtures, one per new
path class, each shown to fire under a neutral path and drop under its own; #213 did the
same for fixture 19; the blind reader instrument earned a planted live key called real and
a planted placeholder not). This one had not.

NOTHING IS PERTURBED IN PLACE. The tracked constants are imported and read, never assigned
to; each arm builds its own perturbed copy and passes it in as a parameter. There is no
restoration step, because nothing is broken that would need restoring: a restore line is a
line that must run and cannot enforce itself, which is the shape of the failure this
measurement already recorded against #214's first commit, whose body asserted two results
before its command had produced them. The module's digests are asserted identical before
and after regardless.

DEPARTURE IS MEASURED AGAINST THIS INSTRUMENT'S OWN UNPERTURBED RUN, never against the
sizing table. A witness that compared to the table would borrow the table's authority and
conflate "the perturbation departed" with "the instrument reproduces the table", which are
different claims and only one of them is being tested here.

R12. Each result is earned only for the repository it ran on. The arms are chosen where the
perturbed constant demonstrably has bite, except W2-caddy, which is chosen precisely where
it has none: four of the twelve repositories have equal path-population and
excluding-generated columns, so no perturbation of GEN can depart there. That arm records
the instrument's blind region rather than hiding it.

Zero spend, no API key, no model call. Trees only, GIT_NO_LAZY_FETCH=1 via path_population.

Usage:  python path_population_witness.py <corpus_dir> <out_json>
"""
import re, os, io, sys, json, hashlib

import path_population as pp

# --- perturbations ---------------------------------------------------------------------
# W1a: SKIP replaced by the WIDENED secrets-exposure copy of SKIP_PATH_RE (#212). Not a
# synthetic break: this is the rule a future session gets by resolving "the SKIP_PATH_RE
# segments" in selector-b.md against secrets-exposure.detector.ts instead of
# admin-check.detector.ts at 134ca122. Strictly wider than the recovered SKIP (scripts?
# admits singular script/, plus five added alternatives), so the population can only shrink.
SKIP_WIDENED = re.compile(
    r'(^|/)(test|tests|__tests__|spec|fixtures|examples?|scripts?|dev-tools|migrations?'
    r'|seed|seeds|demo|e2e|e2e-[a-z0-9-]+|api[_-]tests|app-tests)(/|$)', re.I)

# W1b: a basename exclusion the recovered rule does not have at all, ONE sub-rule only
# (#213's Go half), so a departure has exactly one cause.
SKIP_FILE_GO_TEST = re.compile(r'_test\.go$', re.I)

# W2: GEN with locales? dropped. One segment, the one the shape sample showed dominates
# twenty (47 of its 224 pre-screen positives were generated locale files).
GEN_NO_LOCALES = re.compile(
    r'(^|/)(generated|i18n|translations?|vendor|node_modules|dist|build)(/|$)', re.I)


def skip_plus_basename(base, basename_rx):
    """SKIP, plus a basename rule, as one callable with a .search the walker can use."""
    class _Combined(object):
        pattern = base.pattern + '   ||basename:' + basename_rx.pattern
        @staticmethod
        def search(path):
            return base.search(path) or basename_rx.search(path)
    return _Combined


ARMS = [
    # id, repository, kwargs for the perturbed run, prediction
    ('W1a', 'discourse', dict(skip=SKIP_WIDENED),
     {'path_population': 'decrease', 'excluding_generated': 'decrease'},
     'SKIP replaced by the widened secrets copy; strictly wider, so both columns can only '
     'fall. discourse carries script/import_scripts/, singular, which the recovered SKIP '
     'does not exclude and the widened one does.'),
    ('W1b', 'grafana', dict(skip=skip_plus_basename(pp.SKIP, SKIP_FILE_GO_TEST)),
     {'path_population': 'decrease', 'excluding_generated': 'decrease'},
     'A _test.go basename exclusion the recovered rule has not got at all. Go repository.'),
    ('W1b', 'gitea', dict(skip=skip_plus_basename(pp.SKIP, SKIP_FILE_GO_TEST)),
     {'path_population': 'decrease', 'excluding_generated': 'decrease'},
     'Same single sub-rule, second Go repository.'),
    ('W2', 'twenty', dict(gen=GEN_NO_LOCALES),
     {'path_population': 'unchanged', 'excluding_generated': 'increase'},
     'GEN narrowed, so more commits keep a non-generated qualifying file. The excluding-'
     'generated column can only rise, bounded above by the path-population column, which '
     'GEN does not touch. twenty has the largest gap in the corpus.'),
    ('W2', 'caddy',
     dict(gen=GEN_NO_LOCALES),
     {'path_population': 'unchanged', 'excluding_generated': 'unchanged'},
     'THE BLIND REGION. caddy path-population equals excluding-generated in the sizing '
     'table, so GEN removes nothing there and no perturbation of it can depart. Recorded, '
     'not hidden: the check has no power against a broken GEN in this repository.'),
    ('W3', 'twenty', dict(gen_semantics=pp.DROP_IF_ANY_GENERATED),
     {'path_population': 'unchanged', 'excluding_generated': 'decrease'},
     'The READING, not a regex character: "drop the commit if any qualifying file is '
     'generated" instead of "keep it if any qualifying file is not". Strictly stronger '
     'exclusion, so the column can only fall.'),
]


def direction(baseline, perturbed):
    if perturbed > baseline:
        return 'increase'
    if perturbed < baseline:
        return 'decrease'
    return 'unchanged'


def main(corpus, out_json):
    before = pp.constants_manifest()
    results = []
    baselines = {}
    for arm_id, repo_name, kwargs, prediction, rationale in ARMS:
        repo = os.path.join(corpus, repo_name)
        if repo_name not in baselines:
            b = pp.walk(repo)
            b.pop('_pop'); b.pop('_pop_nogen')
            baselines[repo_name] = b
            print('baseline ' + repo_name.ljust(12)
                  + str(b['path_population']).rjust(7)
                  + str(b['path_population_excluding_generated_segments']).rjust(7),
                  flush=True)
        base = baselines[repo_name]
        p = pp.walk(repo, **kwargs)
        p.pop('_pop'); p.pop('_pop_nogen')
        observed = {
            'path_population': direction(base['path_population'], p['path_population']),
            'excluding_generated': direction(
                base['path_population_excluding_generated_segments'],
                p['path_population_excluding_generated_segments']),
        }
        holds = observed == prediction
        # The bound on W2's increase: it can never exceed the path-population column.
        bound_ok = (p['path_population_excluding_generated_segments']
                    <= p['path_population'])
        results.append({
            'arm': arm_id, 'repository': repo_name, 'rationale': rationale,
            'perturbation': {k: (v.pattern if hasattr(v, 'pattern') else v)
                             for k, v in kwargs.items()},
            'baseline': {'path_population': base['path_population'],
                         'excluding_generated':
                             base['path_population_excluding_generated_segments']},
            'perturbed': {'path_population': p['path_population'],
                          'excluding_generated':
                              p['path_population_excluding_generated_segments']},
            'predicted': prediction, 'observed': observed,
            'prediction_holds': holds, 'bound_holds': bound_ok,
        })
        print(arm_id + ' ' + repo_name.ljust(12)
              + ' base ' + str(base['path_population']) + '/'
              + str(base['path_population_excluding_generated_segments'])
              + '  perturbed ' + str(p['path_population']) + '/'
              + str(p['path_population_excluding_generated_segments'])
              + '  predicted ' + json.dumps(prediction)
              + '  observed ' + json.dumps(observed)
              + ('  HOLDS' if holds and bound_ok else '  FAILED'), flush=True)

    after = pp.constants_manifest()
    untouched = before == after
    every = all(r['prediction_holds'] and r['bound_holds'] for r in results)
    out = {
        'measurement': 'negative witness for path_population.py',
        'date': '2026-09-12',
        'zeroSpend': True, 'apiKeyPresent': False,
        'isA': 'a measurement of whether the reproduction check departs when the rule is '
               'deliberately wrong, on the repositories named and no others',
        'isNot': 'evidence that the definition of path population is right, and not a '
                 'result transferable to any repository not listed here (R12)',
        'constants_before': before, 'constants_after': after,
        'tracked_constants_untouched': untouched,
        'git': pp.git_version(),
        'arms': results,
        'every_prediction_holds': every,
    }
    io.open(out_json, 'w', encoding='utf-8').write(json.dumps(out, indent=1))
    print('tracked constants untouched: ' + str(untouched), flush=True)
    print('EVERY PREDICTION HOLDS: ' + str(every), flush=True)
    if not untouched or not every:
        sys.exit(1)          # a failed witness stops the chain; it does not warn and pass


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
