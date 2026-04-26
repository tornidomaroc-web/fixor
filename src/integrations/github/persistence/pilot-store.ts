import * as fs from "fs";
import * as path from "path";

export const DEFAULT_PILOT_STORE_PATH = path.join(
  process.cwd(),
  "data",
  "fixor-pilot-store.json"
);

export type PilotExecutionRecord = {
  outcome: "completed";
  commentId: number;
  processedAt: string;
};

export type PilotCommentRecord = {
  commentId: number;
  updatedAt: string;
};

export type PilotStoreFileV1 = {
  version: 1;
  /** Key: `owner/repo/pullNumber/headSha` (lowercase owner/repo). */
  commentByRepoPullSha: Record<string, PilotCommentRecord>;
  /** Key: executionKey e.g. `owner/repo/pr-42/sha`. */
  executions: Record<string, PilotExecutionRecord>;
};

function emptyStore(): PilotStoreFileV1 {
  return { version: 1, commentByRepoPullSha: {}, executions: {} };
}

export function makeRepoPullShaKey(
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string
): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}/${pullNumber}/${headSha}`;
}

/**
 * Lightweight JSON file persistence for pilot comment ids and idempotent executions.
 * Not suitable for multi-process concurrent writes; use a single worker or external DB for scale.
 */
export class FilePilotStore {
  constructor(private readonly filePath: string) {}

  private read(): PilotStoreFileV1 {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as unknown;
      if (
        data &&
        typeof data === "object" &&
        (data as PilotStoreFileV1).version === 1 &&
        typeof (data as PilotStoreFileV1).commentByRepoPullSha === "object" &&
        typeof (data as PilotStoreFileV1).executions === "object"
      ) {
        return data as PilotStoreFileV1;
      }
    } catch {
      /* missing or corrupt */
    }
    return emptyStore();
  }

  private write(data: PilotStoreFileV1): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  getStoredCommentId(
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string
): number | undefined {
    const key = makeRepoPullShaKey(owner, repo, pullNumber, headSha);
    const rec = this.read().commentByRepoPullSha[key];
    return rec?.commentId;
  }

  setStoredCommentId(
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string,
    commentId: number
  ): void {
    const data = this.read();
    const key = makeRepoPullShaKey(owner, repo, pullNumber, headSha);
    data.commentByRepoPullSha[key] = {
      commentId,
      updatedAt: new Date().toISOString(),
    };
    this.write(data);
  }

  clearStoredCommentId(
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string
  ): void {
    const data = this.read();
    const key = makeRepoPullShaKey(owner, repo, pullNumber, headSha);
    delete data.commentByRepoPullSha[key];
    this.write(data);
  }

  getExecution(executionKey: string): PilotExecutionRecord | undefined {
    return this.read().executions[executionKey];
  }

  setExecutionCompleted(executionKey: string, commentId: number): void {
    const data = this.read();
    data.executions[executionKey] = {
      outcome: "completed",
      commentId,
      processedAt: new Date().toISOString(),
    };
    this.write(data);
  }

  /** Remove execution record (e.g. after manual rollback) so the same key can run again. */
  clearExecution(executionKey: string): void {
    const data = this.read();
    delete data.executions[executionKey];
    this.write(data);
  }
}

export function resolvePilotStorePath(explicit?: string): string {
  const p =
    explicit?.trim() ||
    process.env.FIXOR_PILOT_STORE_PATH?.trim() ||
    DEFAULT_PILOT_STORE_PATH;
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

/**
 * Stable idempotency key aligned with webhook `executionKey` convention.
 *
 * When `installationId` is provided (the canonical case for live GitHub
 * App webhooks), the key is scoped to `inst-<id>/<sha>`. SHAs are
 * content-addressed so two different commits cannot collide; pinning to
 * installation lets us share idempotency across PRs that share a head
 * sha within the same customer install (e.g. a PR closed and reopened,
 * or a stack of PRs targeting the same commit).
 *
 * When `installationId` is missing (CLI demos, integration tests), we
 * fall back to the legacy `owner/repo/pr-N/sha` shape. Both shapes
 * coexist in the JSON pilot store; the store is keyed by raw string,
 * so old pilot-mode entries continue to work.
 *
 * NOTE — Production today does NOT use this store (FIXOR_PILOT_ENABLED
 * defaults off on Railway). Postgres-backed scan_runs idempotency for
 * the live webhook path is tracked as a Phase 5B follow-up; see the
 * roadmap "Phase 5A close-out follow-ups" section.
 */
export function buildFixorExecutionKey(
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  installationId?: number | string | null,
): string {
  if (installationId !== undefined && installationId !== null) {
    return `inst-${String(installationId)}/${headSha}`;
  }
  return `${owner}/${repo}/pr-${pullNumber}/${headSha}`;
}
