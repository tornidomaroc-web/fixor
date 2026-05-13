// ASSUMED-PATH: app/api/posts/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public blog posts: anyone can read a published post by id. There is
// no ownership concept on this model. The `Post` schema has no userId
// or authorId field (an `authorName` denormalized string is stored on
// the row for display only). Drafts are excluded by the `published`
// filter below; everything else is public on purpose.
//
//   model Post {
//     id          String   @id @default(cuid())
//     slug        String   @unique
//     title       String
//     body        String
//     authorName  String
//     published   Boolean  @default(false)
//     publishedAt DateTime?
//   }

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
