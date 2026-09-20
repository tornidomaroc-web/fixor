// Field trial Arm A: pass-through observer at the SDK boundary, with a spend ceiling.
//
// Loaded with `node --require`. Wraps Messages.prototype.create so every model
// call made by an UNMODIFIED `dist/cli/scan.js` is recorded: the model id the
// request asked for, the model id the response reports, token usage priced by
// the repository's own calculateCost, stop reason, and the tool input (the raw
// verdict). It never alters a request or a response.
//
// CEILING. Before each call it sums the priced cost of every call already
// recorded in TRIAL_OBSERVER_OUT (shared across invocations). If that running
// figure is above TRIAL_CEILING_USD, the call is refused before any network
// I/O, with an error carrying status 400 so the client's retry layer treats it
// as non-retryable and a refused call can never be retried into the count.
// That is the only branch that changes behaviour, and it can only prevent a
// request, never send one.
//
// Refuses to load without TRIAL_OBSERVER_OUT and TRIAL_CEILING_USD, so an
// unobserved or uncapped paid run cannot start by accident.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const out = process.env.TRIAL_OBSERVER_OUT;
const ceiling = Number(process.env.TRIAL_CEILING_USD);
if (!out) throw new Error("trial-observer: TRIAL_OBSERVER_OUT is not set; refusing to run unobserved");
if (!Number.isFinite(ceiling) || ceiling <= 0) {
  throw new Error("trial-observer: TRIAL_CEILING_USD is not a positive number; refusing to run uncapped");
}

const { calculateCost } = require(path.join(process.cwd(), "dist", "services", "cost-tracking.service.js"));
const { Messages } = require("@anthropic-ai/sdk/resources/messages");
const original = Messages.prototype.create;

function priced(model, usage) {
  if (!usage) return 0;
  return calculateCost({
    model,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
    cacheReadInputTokens: usage.cache_read_input_tokens || 0,
  });
}

function spentSoFar() {
  if (!fs.existsSync(out)) return 0;
  let sum = 0;
  for (const line of fs.readFileSync(out, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (typeof r.costUsd === "number") sum += r.costUsd;
  }
  return sum;
}

Messages.prototype.create = function observedCreate(body, options) {
  const started = new Date().toISOString();
  const tool = body && body.tools && body.tools[0] ? body.tools[0].name : "";
  const spent = spentSoFar();
  if (spent > ceiling) {
    fs.appendFileSync(
      out,
      JSON.stringify({ started, requestModel: body.model, tool, refused: true, spentBefore: spent, ceiling }) + "\n",
    );
    const err = new Error(`trial-observer: running cost $${spent.toFixed(4)} is above the $${ceiling} ceiling; call refused`);
    err.status = 400;
    return Promise.reject(err);
  }
  const promise = original.call(this, body, options);
  promise.then(
    (msg) => {
      const toolBlock = (msg.content || []).find((b) => b.type === "tool_use");
      fs.appendFileSync(
        out,
        JSON.stringify({
          started,
          ended: new Date().toISOString(),
          requestModel: body.model,
          responseModel: msg.model,
          tool,
          stopReason: msg.stop_reason,
          usage: msg.usage,
          costUsd: priced(body.model, msg.usage),
          toolInput: toolBlock ? toolBlock.input : null,
        }) + "\n",
      );
    },
    (err) => {
      fs.appendFileSync(
        out,
        JSON.stringify({
          started,
          ended: new Date().toISOString(),
          requestModel: body.model,
          tool,
          error: String((err && (err.status || err.name)) || err),
        }) + "\n",
      );
    },
  );
  return promise;
};
