// ASSUMED-PATH: src/server/web/members/app.js
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
