/**
 * Constructed inputs for the L-006 / L-009 mechanism witnesses.
 *
 * CONSTRUCTION IS THE GROUND TRUTH. These files are authored so that what they
 * contain is known by construction, not inferred by an AST. No parser is
 * involved and none is needed: we wrote the vulnerability, so we know it is
 * there, and we wrote the handler boundaries, so we know where they are.
 *
 * They are held as string constants rather than files under `fixtures/` for two
 * reasons: `fixtures/` is enumerated by the replay corpus (a new dir there
 * would perturb the 26-fixture manifest that PR #95-#97 froze), and
 * `SKIP_PATH_RE` (idor.detector.ts:204-205) skips any path containing
 * `/fixtures/`, so a real production scan would never see them anyway.
 *
 * Paths are realistic (`src/routes/...`) because the artifact reports them, but
 * the rig drives `analyzeFile` directly, which applies no path filter.
 */
import type { ProbeInput } from "./idor-structure-rig";

/**
 * L-006 WITNESS. A genuine, unguarded IDOR whose only sink is an ORM WRITE.
 *
 * The vulnerability, by construction: `requireAuth` establishes WHO the caller
 * is. Nothing establishes WHETHER this document is theirs. `req.params.id`
 * flows unguarded into the write predicate, so any authenticated caller can
 * rename any document. This is a textbook write-variant IDOR (OWASP BOLA).
 *
 * There is NO read anywhere in the file. That is the whole point: the
 * read-then-write idiom (which `documentController.ts` uses twice, correctly)
 * would put a sink in the file and defeat the witness.
 *
 * PREDICTED, from source: `prisma.document.update` matches no entry of
 * SINK_PATTERNS (idor.detector.ts:173-202 — all 15 are reads), so
 * `sinkHits.length === 0` and `analyzeFile` returns [] at the early return
 * (idor.detector.ts:803-807). The model is never reached.
 */
export const L006_WRITE_ONLY: ProbeInput = {
  id: "L-006/write-only-unguarded",
  path: "src/routes/documents-write.ts",
  lang: "ts",
  content: `import { Router } from "express";

import { prisma } from "../db/client";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * PATCH /documents/:id - rename a document.
 *
 * requireAuth proves the caller is SOMEBODY. It does not prove the document is
 * THEIRS. The id goes from the request straight into the write predicate.
 */
router.patch("/documents/:id", requireAuth, async (req, res) => {
  const updated = await prisma.document.update({
    where: { id: req.params.id },
    data: { title: req.body.title },
  });

  res.json(updated);
});

export default router;
`,
};

/**
 * L-006 READ CONTROL. Byte-for-byte the same shape as L006_WRITE_ONLY except
 * the ORM verb: `update` -> `findUnique`, write predicate -> read predicate.
 *
 * WHY THIS EXISTS. Without it, the write-only result is an anecdote: "this file
 * returned []" is consistent with the write gap AND with some unrelated flaw in
 * how the file was constructed. Holding everything constant but the VERB
 * isolates the verb as the cause. The control must reach the model; the write
 * must not. That contrast is the experiment.
 *
 * PREDICTED: `.findUnique(` matches `prisma_find_unique`, so sinkHits is
 * non-empty, a pair forms, and `callLlm` is reached (observable under the lock
 * as ReplayFixtureMissing).
 */
export const L006_READ_CONTROL: ProbeInput = {
  id: "L-006/read-control",
  path: "src/routes/documents-read.ts",
  lang: "ts",
  content: `import { Router } from "express";

import { prisma } from "../db/client";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * GET /documents/:id - fetch a document.
 *
 * Same unguarded shape as the PATCH route, but the id lands in a READ.
 */
router.get("/documents/:id", requireAuth, async (req, res) => {
  const found = await prisma.document.findUnique({
    where: { id: req.params.id },
  });

  res.json(found);
});

export default router;
`,
};

/**
 * L-009 WITNESS. Two route handlers. The SOURCE is in handler A. The only SINK
 * is in handler B. The id never reaches that sink, and handler B's own lookup
 * is correctly owner-scoped, so this file contains NO IDOR.
 *
 * By construction:
 *   - handler A (`GET /documents/:id`) has a source and NO sink: it echoes the
 *     id back without touching the database.
 *   - handler B (`GET /stats`) has a sink and NO source: it reads the caller's
 *     own stats row, scoped by `req.user.id` (which matches no SOURCE pattern).
 *
 * So the ONLY pair the detector can form is cross-handler. That is the witness:
 * `enumerateSinkPairs` (idor.detector.ts:540-570) has no scope awareness and
 * pairs each sink with its nearest source by LINE DISTANCE only. The two are
 * well inside PROXIMITY_THRESHOLD = 200.
 *
 * PREDICTED: one pair, source line inside handler A, sink line inside handler
 * B, reaching `callLlm`. The model is asked to judge a data flow that does not
 * exist. `HANDLER_A_LINES` / `HANDLER_B_LINES` below are the construction-time
 * boundaries the witness asserts against.
 */
export const L009_CROSS_HANDLER: ProbeInput = {
  id: "L-009/cross-handler-pair",
  path: "src/routes/mixed-handlers.ts",
  lang: "ts",
  content: `import { Router } from "express";

import { prisma } from "../db/client";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * Handler A. GET /documents/:id/echo - reflects the requested id back to the
 * caller for the client-side router. Touches no database.
 */
router.get("/documents/:id/echo", requireAuth, async (req, res) => {
  const documentId = req.params.id;

  res.json({
    documentId,
    requestedAt: new Date().toISOString(),
  });
});

/**
 * Handler B. GET /stats - the caller's OWN usage summary.
 *
 * Correctly scoped: the predicate is the authenticated caller's id, taken from
 * the session, never from the request path. There is no IDOR here.
 */
router.get("/stats", requireAuth, async (req, res) => {
  const summary = await prisma.usageStats.findFirst({
    where: { ownerId: req.user.id },
  });

  res.json(summary ?? { documents: 0, storageBytes: 0 });
});

export default router;
`,
};

/**
 * Construction-time handler boundaries for L009_CROSS_HANDLER (1-indexed,
 * inclusive), each spanning its doc comment through its closing `});`.
 * Verified against the numbered file body: the source lands on line 13 and the
 * sink on line 28, so the two ranges are disjoint and the pair must cross them.
 */
export const L009_HANDLER_A_LINES = { start: 8, end: 19 } as const;
export const L009_HANDLER_B_LINES = { start: 21, end: 33 } as const;

export const CONSTRUCTED_INPUTS: ProbeInput[] = [
  L006_WRITE_ONLY,
  L006_READ_CONTROL,
  L009_CROSS_HANDLER,
];
