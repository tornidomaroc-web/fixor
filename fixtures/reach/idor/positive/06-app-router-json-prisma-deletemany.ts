// ASSUMED-PATH: app/api/keys/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: Request) {
  const { keyId } = await req.json();
  if (!keyId) {
    return NextResponse.json({ error: "keyId required" }, { status: 400 });
  }
  const result = await prisma.apiKey.deleteMany({ where: { id: keyId } });
  return NextResponse.json({ count: result.count });
}
