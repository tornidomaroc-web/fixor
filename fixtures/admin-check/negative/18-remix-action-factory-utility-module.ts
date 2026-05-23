// ASSUMED-PATH: app/utils/action-helpers.server.ts
// Phase E — Remix v2 over-match negative for admin-check.
// Utility module that exports `action` as a generic factory function
// (returns a new action wrapped with audit-log behavior). Lives under
// app/utils/, not app/routes/ — the Phase E path-aware filter must
// drop the REMIX_HANDLER_DEF_RE match so this file is NOT routed to
// the admin-check LLM. If the path filter fails, the LLM would see a
// generic helper and probably correctly judge it as non-vulnerable —
// but it would cost ~$0.012 per such file in the real world, which
// is the cost-blowup risk the filter prevents.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export const action = <T>(
  handler: (args: ActionFunctionArgs) => Promise<T>,
) => {
  return async (args: ActionFunctionArgs) => {
    const result = await handler(args);
    console.log("audit-log", { method: args.request.method, url: args.request.url });
    return json(result);
  };
};
