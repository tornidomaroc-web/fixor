// ASSUMED-PATH: app/api/posts/route.ts
// Phase C — bare public-by-design read endpoint. No HOC wrapper at
// all, no auth signal, no destructive op. The "if every route on
// this router is unguarded, prefer LOW unless unambiguously
// destructive" heuristic applies — a GET returning a filtered list
// of PUBLISHED posts is a published-content feed, not a missing-
// middleware bypass.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const posts = await db.post.findMany({
    where: { published: true },
    take: 20,
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      publishedAt: true,
    },
  });
  return NextResponse.json({ posts });
}
