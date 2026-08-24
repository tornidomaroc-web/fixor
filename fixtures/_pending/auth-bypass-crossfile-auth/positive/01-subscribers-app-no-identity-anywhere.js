// ASSUMED-PATH: src/server/web/subscribers/app.js
// ── HELD OUT OF THE CORPUS. DELETE THIS BLOCK BEFORE ENABLING (F1). ──
// Not in fixtures/auth-bypass/ and not in the manifest in
// src/test/specs/auth-bypass.replay-spec.ts. Same hold-out as the negative
// beside it, re-measured by a two-run npm test differential with both files
// present.
//
// NO SIDECAR, same reason as the negative: auth-bypass reads only
// SIDECAR_KINDS.ROUTE_GUARD (auth-bypass.detector.ts:692-695), whose slot is
// Remix-scoped, and the corpus is wired without sidecars
// (auth-bypass.replay-spec.ts:170). A single file is what production shows the
// model for this shape.
//
// Paired anchor: ../negative/01-members-app-handler-internal-auth.js. That file
// is the same module shape with identity plumbing present and its auth living
// cross-file. This one has no identity anywhere.
//
// Entering the gate is a SEPARATE, PAID decision. runReplayGate fails on
// "missing recordings for: ..." (replay-harness.ts:870), and only
// record:auth-bypass produces a recording, which spends and overwrites frozen
// evidence unless FIXOR_REPLAY_ROOT is redirected (CLAUDE.md §3).
//
// This block is model context. It must not travel into a recording.
// ── END HOLD-OUT BLOCK ──
const express = require('express');
const bodyParser = require('body-parser');

const accounts = require('../../services/accounts');
const billing = require('../../services/billing');
const shared = require('../shared');
const corsMiddleware = require('./middleware/cors');

module.exports = function setupSubscribersApp() {
    const subscribersApp = express();

    // Subscriber responses are per-caller and must not be cached.
    subscribersApp.use(shared.middleware.cacheControl('private'));

    // Support CORS for requests from the frontend.
    subscribersApp.use(corsMiddleware);

    // Public pricing table for the marketing site.
    subscribersApp.get('/api/plans', function (req, res) {
        return billing.listPlans()
            .then(plans => res.json({plans}));
    });

    subscribersApp.get('/api/subscriber/:id', function (req, res) {
        return accounts.getSubscriber(req.params.id)
            .then(subscriber => res.json({subscriber}));
    });

    subscribersApp.put('/api/subscriber/:id/email', bodyParser.json(), function (req, res) {
        return accounts.updateEmail(req.params.id, req.body.email)
            .then(subscriber => res.json({subscriber}));
    });

    subscribersApp.post('/api/subscriber/:id/subscription/cancel', function (req, res) {
        return billing.cancelSubscription(req.params.id)
            .then(() => res.status(204).end());
    });

    subscribersApp.delete('/api/subscriber/:id', function (req, res) {
        return accounts.deleteSubscriber(req.params.id)
            .then(() => res.status(204).end());
    });

    return subscribersApp;
};
