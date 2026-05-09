import type { Request, Response } from "express";
import express, { Router } from "express";
import crypto from "node:crypto";
import { reactToIssue } from "../bot/issues.js";

const router = Router();
const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function verifyGithubSig(
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const mac = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const expected = Buffer.from(`sha256=${mac}`, "utf8");
  const supplied = Buffer.from(header, "utf8");
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, supplied);
}

router.post(
  "/webhook/github",
  express.raw({ type: "application/json", limit: "5mb" }),
  async (req: Request, res: Response) => {
    if (
      !verifyGithubSig(
        req.body,
        req.headers["x-hub-signature-256"] as string | undefined,
      )
    ) {
      res.status(401).end();
      return;
    }
    const payload = JSON.parse(req.body.toString());
    if (
      req.headers["x-github-event"] === "issues" &&
      payload.action === "opened"
    ) {
      await reactToIssue({
        repo: payload.repository.full_name,
        issueNumber: payload.issue.number,
        title: payload.issue.title,
      });
    }
    res.status(200).end();
  },
);

export default router;
