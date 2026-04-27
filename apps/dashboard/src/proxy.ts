/**
 * Clerk middleware — protects every route except the sign-in / sign-up
 * catch-alls and Next's static asset paths.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Paddle posts here unauthenticated; the route handler verifies
  // the request body itself with PADDLE_WEBHOOK_SECRET (5D-3).
  "/api/billing/webhook",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  // Match every path except the static-file ones Next produces. Without
  // this exclusion, the middleware would inject Clerk on .css / .js /
  // image requests too — wasteful and breaks some hot-reload behaviour.
  matcher: ["/((?!_next|.*\\..*).*)"],
};
