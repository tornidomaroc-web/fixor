import io, re, json, os, sys, subprocess, glob

D = sys.argv[1]
REPO = 'D:/RAGHAD JAD/Fixor-Final/fix-pairs-corpus/twenty'
verd = {}
for f in glob.glob(os.path.join(D, 'verdicts-batch*.json')):
    for v in json.load(io.open(f, encoding='utf-8'))['verdicts']:
        verd[v['file'][5:17]] = v


def hunks(sha12, path):
    s = io.open(os.path.join(D, f'diff-{sha12}.patch'), encoding='utf-8').read()
    for p in re.split(r'(?=^diff --git )', s, flags=re.M):
        if p.startswith(f'diff --git a/{path} '):
            return p.rstrip('\n')
    raise SystemExit('hunk not found ' + path)


def git(*a):
    return subprocess.check_output(['git', '-C', REPO] + list(a)).decode().strip()


def safety(h):
    return [l[1:].strip() for l in h.split('\n') if re.match(r'^\+\s*(//|/\*|\*|#)', l)]


SRV = 'packages/twenty-server/src/'
pairs = [
    dict(sha='0edc3a385c0cf35aa5b587e674ca4faa669246a2', path=SRV + 'engine/core-modules/auth/services/sign-in-up.service.ts', cls='admin-check', ans=(417, 448), primary=417,
         grounds="With workspace creation limited to server admins, the parent let any user with no workspaces yet (isFirstWorkspaceForUser) skip the canAccessFullAdminPanel check, and the sign-up path had no admin check at all; the fix narrows the bypass to an empty system and adds the explicit admin check on sign-up."),
    dict(sha='23aa859502a802e7c116bfb6d5586ce5379338a7', path=SRV + 'engine/core-modules/application/application-registration/application-registration.service.ts', cls='idor', ans=(64, 67), primary=64,
         grounds="findOneById took an ownerWorkspaceId scope but the where clause also accepted rows whose ownerWorkspaceId is NULL, so a caller from any workspace could act on an unowned registration by id; the fix removes the IsNull alternative so only the caller's tenant rows match."),
    dict(sha='77574594f2d652d9204f2aaef874a660bd16b197', path=SRV + 'engine/core-modules/admin-panel/admin-panel.resolver.ts', cls='admin-check', ans=(63, 86), primary=63,
         grounds="Four admin-panel queries, including the one that returns grouped environment variables, were guarded by ImpersonateGuard (canImpersonate) rather than by admin-panel access, so a user allowed to impersonate but not to use the admin panel could read them; the fix guards all four with a new AdminPanelGuard requiring canAccessFullAdminPanel. Grounds are moderate: the parent had a guard, the wrong one, and the commit subject reads as feature work."),
    dict(sha='921a0f01c8a9c78dd56ca0b237855cf5190c3ff5', path=SRV + 'engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-field-permission-validator.service.ts', cls='idor', ans=(190, 195), primary=190,
         grounds="The update validator checked that the referenced role exists and is editable but never that it belongs to the calling application, so one application could retarget a field permission onto another application's role; the fix adds validateRoleBelongsToCallerApplication, a check the create path already had."),
    dict(sha='921a0f01c8a9c78dd56ca0b237855cf5190c3ff5', path=SRV + 'engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-object-permission-validator.service.ts', cls='idor', ans=(170, 175), primary=170,
         grounds="Same shape as the field-permission validator in the same commit: the object-permission update path validated existence and editability of the referenced role but not that it belongs to the caller's application; the fix adds the ownership check."),
    dict(sha='921a0f01c8a9c78dd56ca0b237855cf5190c3ff5', path=SRV + 'engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-permission-flag-validator.service.ts', cls='idor', ans=(165, 170), primary=165,
         grounds="Same shape as the two sibling validators in the same commit: the permission-flag update path lacked the caller-application ownership check on the referenced role; the fix adds it."),
    dict(sha='cdd667b1066e96e52352fdc1d100e4d1af67ca00', path=SRV + 'engine/core-modules/server-route-trigger/server-route-trigger.service.ts', cls='auth-bypass', ans=(57, 119), primary=60,
         grounds="The public, unauthenticated /webhooks/server route dispatched any logic function found by universal identifier, including resolvers whose settings flag isAuthRequired, with no authentication check; the fix rejects those with RESOLVER_REQUIRES_AUTHENTICATION and narrows the lookup to functions that expose a server-route trigger."),
]
out_dir = 'docs/measurements/fix-pairs-2026-09-11/pairs'
os.makedirs(out_dir, exist_ok=True)
manifest = []
by_sha = {}
for p in pairs:
    by_sha.setdefault(p['sha'], []).append(p['path'])
for p in pairs:
    s12 = p['sha'][:12]
    v = verd[s12]
    h = hunks(s12, p['path'])
    sc = safety(h)
    rec = {
        'repository': 'twentyhq/twenty',
        'parentCommit': git('rev-parse', p['sha'] + '^'),
        'childCommit': p['sha'],
        'childDate': git('log', '-1', '--format=%ad', '--date=short', p['sha']),
        'file': p['path'], 'language': 'ts', 'class': p['cls'],
        'answerLineRange': {'file': 'parent', 'start': p['ans'][0], 'end': p['ans'][1], 'primaryLine': p['primary'],
                            'note': 'parent-file line numbers from the hunk headers; for an absent check the range covers where the check was missing'},
        'candidateSource': {'selector': 'shape-sample-twenty', 'how': 'path-only population, mechanical pre-screen, blind read; NOT the keyword selector', 'keywordCandidate': False},
        'measuringSessionReading': {'class': p['cls'], 'grounds': p['grounds'], 'reader': 'Claude Fable 5.1, session_01KS9wkmjZvHSWk8jNdHb4BE', 'date': '2026-09-11'},
        'secondReader': {'class': v['class'], 'sentence': v['reason'], 'answerLinesHint': v['answer_lines_hint'], 'blind': True, 'sawDetectorSource': False},
        'contested': v['class'] != p['cls'],
        'childSafetyAssertingComment': {'present': bool(sc), 'quotes': sc},
        'sameCommitSiblings': [x for x in by_sha[p['sha']] if x != p['path']],
        'admission': 'ADMITTED', 'exclusionReason': None,
        'diffHunk': h,
    }
    base = os.path.basename(p['path']).replace('.service.ts', '').replace('.resolver.ts', '')
    fn = f'twenty--{s12}--{base}.json'
    io.open(os.path.join(out_dir, fn), 'w', encoding='utf-8', newline='\n').write(json.dumps(rec, indent=1))
    manifest.append({'file': fn, 'class': p['cls'], 'childCommit': p['sha'], 'path': p['path'], 'contested': rec['contested'], 'admission': 'ADMITTED', 'selector': 'shape-sample-twenty'})
    print(fn, 'contested=', rec['contested'], 'safetyComment=', bool(sc))
io.open(os.path.join(out_dir, 'MANIFEST.json'), 'w', encoding='utf-8', newline='\n').write(json.dumps({'note': 'one entry per pair record; admission state and selector per pair', 'pairs': manifest}, indent=1))
print('records:', len(manifest))
