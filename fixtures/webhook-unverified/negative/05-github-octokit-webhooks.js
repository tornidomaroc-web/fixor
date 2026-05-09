const express = require("express");
const { Webhooks, createNodeMiddleware } = require("@octokit/webhooks");
const { reactToIssue } = require("../bot/issues");

const webhooks = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET });

webhooks.on("issues.opened", async ({ payload }) => {
  await reactToIssue({
    repo: payload.repository.full_name,
    issueNumber: payload.issue.number,
    title: payload.issue.title,
  });
});

const app = express();
app.use(createNodeMiddleware(webhooks, { path: "/webhook/github" }));

module.exports = app;
