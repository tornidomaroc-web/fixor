/**
 * Opportunistic dashboard-side state writes used by the onboarding
 * surface (5E-3 / 5E-4).
 *
 * The home page calls this on every render where a Clerk user is
 * signed in. Two side effects:
 *
 *   1. Populate `orgs.installer_email` for any of the user's
 *      accessible orgs that don't yet have one. This gives the
 *      backend's first-scan-email path (5E-4) somewhere to send
 *      to without requiring the operator to volunteer their
 *      email anywhere else.
 *
 * The function NEVER throws — onboarding writes must not break
 * the page render.
 */
import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs } from "@/db/schema";

export async function populateInstallerEmailIfMissing(
  allowedInstallationIds: string[],
  email: string,
): Promise<void> {
  if (allowedInstallationIds.length === 0) return;
  if (!email || !email.includes("@")) return;
  try {
    await db()
      .update(orgs)
      .set({ installerEmail: email })
      .where(
        and(
          inArray(orgs.githubInstallationId, allowedInstallationIds),
          isNull(orgs.installerEmail),
        ),
      );
  } catch {
    // Silent — onboarding state writes are best-effort.
  }
}

/**
 * Pulls the Clerk user's primary email. Returns null when no user
 * is signed in, when Clerk has no email on file, or when the SDK
 * call throws (network / auth issues during render).
 */
export async function readClerkUserEmail(
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const primaryId = user.primaryEmailAddressId;
    const primary = user.emailAddresses.find((e) => e.id === primaryId);
    return primary?.emailAddress ?? null;
  } catch {
    return null;
  }
}

