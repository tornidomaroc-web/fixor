// ASSUMED-PATH: app/api/posts/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const post = await prisma.post.findUnique({
    where: { id: params.id },
  });

  if (!post || !post.published) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: post.id,
    slug: post.slug,
    title: post.title,
    body: post.body,
    authorName: post.authorName,
    publishedAt: post.publishedAt,
  });
}
