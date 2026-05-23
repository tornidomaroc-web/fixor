// ASSUMED-PATH: app/routes/api.posts.$id.update.ts
// Phase E — Remix v2 missing-HOC-wrapper negative.
// No HOC wrapper, but body has an explicit inline auth check:
// `getServerSession` followed by a 401 return on missing session,
// AND scope filter keyed on `session.user.id`. Inline auth checks
// count as gating per the auth-bypass prompt's case 3 closing rule.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { getServerSession } from "~/services/session.server";
import { db } from "~/lib/db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  await db.post.update({
    where: { id: params.id, authorId: session.user.id },
    data: { title: body.title, body: body.body },
  });
  return json({ ok: true });
};
