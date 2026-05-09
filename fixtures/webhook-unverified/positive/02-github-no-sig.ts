// ASSUMED-PATH: src/app/handlers/webhook-unverified/02-github-no-sig.ts
import type { Request, Response } from "express";
import { Router, json } from "express";
import { reactToIssue } from "../bot/issues.js";

const router = Router();

router.post(
  "/webhook/github",
  json({ limit: "5mb" }),
  async (req: Request, res: Response) => {
    const event = req.headers["x-github-event"] as string | undefined;
    const payload = req.body;

    if (event === "issues" && payload.action === "opened") {
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
