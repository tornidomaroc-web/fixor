// ASSUMED-PATH: src/server/web/subscribers/app.js
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
