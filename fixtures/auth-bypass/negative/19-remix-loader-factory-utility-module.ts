// ASSUMED-PATH: app/lib/loader-factory.server.ts
// Phase E — Remix v2 over-match negative.
// This is a UTILITY module that happens to export `loader` and
// `action` as factory functions for use BY route files, but is
// itself NOT a route handler — it sits under app/lib/, not
// app/routes/. The Phase E path-aware filter (isRemixRoutePath) must
// drop the REMIX_HANDLER_DEF_RE match here so the file is NOT routed
// to the LLM. If the path filter fails, this fixture surfaces as a
// false positive against an obviously-safe factory module — that is
// the council-flagged over-match risk.
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";

export const loader = <T>(handler: (args: LoaderFunctionArgs) => Promise<T>) => {
  return async (args: LoaderFunctionArgs) => {
    const start = Date.now();
    const result = await handler(args);
    const ms = Date.now() - start;
    console.log("loader-timing", { ms });
    return json(result);
  };
};

export const action = <T>(handler: (args: ActionFunctionArgs) => Promise<T>) => {
  return async (args: ActionFunctionArgs) => {
    const start = Date.now();
    const result = await handler(args);
    const ms = Date.now() - start;
    console.log("action-timing", { ms });
    return json(result);
  };
};
