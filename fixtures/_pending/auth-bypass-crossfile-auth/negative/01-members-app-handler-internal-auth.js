// ASSUMED-PATH: src/server/web/members/app.js
// ── HELD OUT OF THE CORPUS. DELETE THIS BLOCK BEFORE ENABLING (F1). ──
// Not in fixtures/auth-bypass/ and not in the manifest in
// src/test/specs/auth-bypass.replay-spec.ts. Nothing reads this directory —
// same hold-out as fixtures/_pending/auth-bypass-blanket-use/, proved inert by
// a two-run npm test differential (0 differing lines after timestamps).
//
// NO SIDECAR, DELIBERATELY. auth-bypass reads exactly one sidecar kind,
// SIDECAR_KINDS.ROUTE_GUARD (auth-bypass.detector.ts:692-695), whose companion
// extension is `.route-guard.ts` and whose prompt slot is "PARENT ROUTE GUARDS
// (cross-file)", scoped by SYSTEM_PROMPT case 4 to Remix / React Router v7
// parent layouts only. The corpus is also wired without sidecars at all
// (auth-bypass.replay-spec.ts:170). So no sidecar can honestly carry Express
// handler-internal auth here, and a single file is the FAITHFUL encoding:
// in a real scan of this shape, the model sees exactly this and nothing more.
// Ground truth for the handler bodies is in ../PREDICTION.md, where it informs
// the human auditor without reaching the model.
//
// Entering the gate is a SEPARATE, PAID decision. runReplayGate fails on
// "missing recordings for: ..." (replay-harness.ts:870), and only
// record:auth-bypass produces a recording, which spends and overwrites frozen
// evidence (CLAUDE.md §3).
//
// This block is model context. It must not travel into a recording.
// ── END HOLD-OUT BLOCK ──
const express = require('express');
const bodyParser = require('body-parser');

const middleware = require('../../services/members/middleware');
const membersService = require('../../services/members');
const shared = require('../shared');
const corsMiddleware = require('./middleware/cors');

module.exports = function setupMembersApp() {
    const membersApp = express();

    // Members responses are per-caller and must not be cached.
    membersApp.use(shared.middleware.cacheControl('private'));

    // Support CORS for requests from the frontend.
    membersApp.use(corsMiddleware);

    // Global handling for signing in with ?token= magiclinks.
    membersApp.use(middleware.createSessionFromMagicLink);

    // Newsletter preferences, addressed by the uuid in the unsubscribe link.
    membersApp.get('/api/member/newsletters',
        middleware.authMemberByUuid,
        middleware.getMemberNewsletters
    );
    membersApp.put('/api/member/newsletters',
        bodyParser.json({limit: '50mb'}),
        middleware.authMemberByUuid,
        middleware.updateMemberNewsletters
    );

    // Get and update member data.
    membersApp.get('/api/member', middleware.getMemberData);
    membersApp.put('/api/member', bodyParser.json({limit: '50mb'}), middleware.updateMemberData);

    // Remove an email from the bounce suppression list.
    membersApp.delete('/api/member/suppression', middleware.deleteSuppression);

    // Manage session.
    membersApp.get('/api/session', middleware.getIdentityToken);
    membersApp.delete('/api/session', bodyParser.json({limit: '5mb'}), middleware.deleteSession);

    // Change the plan on an existing subscription.
    membersApp.put('/api/subscriptions/:id', membersService.api.middleware.updateSubscription);

    // Post-send feedback from a newsletter, addressed by uuid.
    membersApp.post('/api/feedback',
        bodyParser.json({limit: '50mb'}),
        middleware.loadMemberSession,
        middleware.authMemberByUuid,
        membersService.api.middleware.addFeedback
    );

    return membersApp;
};
