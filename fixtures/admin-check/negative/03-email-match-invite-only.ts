// ASSUMED-PATH: src/app/handlers/admin-check/03-email-match-invite-only.ts
import type { Request, Response } from "express";
import { db } from "../db/index.js";

interface AuthRequest extends Request {
  user?: { email: string };
  params: { id: string };
}

// Accept invite if the invitee's email matches the invite's target email.
// This grants membership of the invited org, not admin powers.
export async function acceptInvite(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const inviteId = req.params.id;
  const invite = await db
    .selectFrom("invites")
    .selectAll()
    .where("id", "=", inviteId)
    .executeTakeFirst();
  if (!invite) {
    res.status(404).end();
    return;
  }
  if (req.user?.email !== invite.invitee_email) {
    res.status(403).end();
    return;
  }
  await db
    .insertInto("org_members")
    .values({ user_id: req.user.email, org_id: invite.org_id, role: "member" })
    .execute();
  res.json({ joined: invite.org_id });
}
