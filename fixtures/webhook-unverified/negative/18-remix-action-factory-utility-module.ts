// ASSUMED-PATH: app/utils/webhook-action-factory.server.ts
// Phase E — Remix v2 over-match negative for webhook-unverified.
// Utility module that exports `action` as a generic factory function
// for use BY route files. Path is `app/utils/...`, NOT `app/routes/...`
// — the Phase E path-aware filter (isRemixRoutePath) must drop the
// REMIX_HANDLER_DEF_RE match so this file is NOT routed to the
// webhook LLM. The file contains the word "webhook" in its filename
// (over-match risk for the existing webhook URL patterns too), but
// no Express/Flask/Rails/Go URL patterns match the file content, and
// `app_router_route_def` does not match (no HTTP-method name). Only
// `remix_handler_def` would match — and the path filter drops it.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export const action = <T>(
  handler: (args: ActionFunctionArgs) => Promise<T>,
) => {
  return async (args: ActionFunctionArgs) => {
    const result = await handler(args);
    return json(result);
  };
};
