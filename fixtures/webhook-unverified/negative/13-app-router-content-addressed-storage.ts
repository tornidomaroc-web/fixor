// ASSUMED-PATH: app/api/uploads/route.ts
// Phase C — second non-webhook node:crypto use (content-addressed
// object storage). Hash output flows to `storage.put(`/blobs/...`,
// buffer)` — another enumerated non-signature sink. Acts as an
// OVERFIT GUARD for W1: it ensures the prompt tightening doesn't
// fit narrowly to "cache.get/set is the only non-webhook sink." A
// pass on this fixture is NOT evidence of strong calibration on its
// own — the load-bearing negative is WH-N1, whose createHash(body)
// shape literally mirrors what an HMAC verify computes. WH-N3
// passes even against weaker prompts and must be reported as
// "easy-negative overfit guard" in the baseline writeup, not as
// calibration evidence.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

const storage = {
  async put(_key: string, _data: Buffer): Promise<void> {},
};

export async function POST(req: Request) {
  const buffer = Buffer.from(await req.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  await storage.put(`/blobs/${fileHash}`, buffer);
  return NextResponse.json({ url: `/blobs/${fileHash}` });
}
