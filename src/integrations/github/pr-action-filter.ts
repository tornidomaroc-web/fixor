/**
 * Which pull_request deliveries start a scan.
 *
 * GitHub delivers every action of a subscribed event, so without this
 * filter a label, an edit, an assignment, a review request or a close each
 * ran a full scan of a commit Fixor had already scanned. Only these carry
 * code the last scan has not seen:
 *
 *   - opened       a new pull request.
 *   - synchronize  new commits on the head branch.
 *   - reopened     commits may have been pushed while it was closed, and a
 *                  pull request closed before the install was never scanned.
 *   - edited, only with `changes.base`: the base branch changed, so the diff
 *                  under review changed although the head did not. A title
 *                  or body edit changes no code.
 *
 * Every other action leaves head and base as they were, and the report
 * already on the pull request (which names the commit it covers) still
 * describes them. Draft pull requests are scanned like any other, so
 * `converted_to_draft` and `ready_for_review` are refused: the head they
 * carry was scanned when it was pushed. An action this list does not know
 * is refused, never scanned by default.
 *
 * Pure: no I/O and no environment reads. Called by routeGitHubWebhook
 * after the signature check and before the PR handler.
 */

export type PullRequestSkipReason =
  /** A documented action that changes neither the head nor the base. */
  | "action_not_scanned"
  /** A title or body edit; only a base change is scanned. */
  | "edited_without_base_change"
  /** A string action missing from GitHub's documented list (or `stacked`, listed there without a description). */
  | "action_unrecognized"
  /** No string `action` in the payload. */
  | "action_missing";

export type PullRequestScanDecision =
  | { scan: true; action: string }
  | { scan: false; action: string | null; reason: PullRequestSkipReason };

const SCANNED_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "synchronize",
  "reopened",
]);

/** GitHub's documented pull_request actions that carry no code. */
const NON_CODE_ACTIONS: ReadonlySet<string> = new Set([
  "assigned",
  "unassigned",
  "labeled",
  "unlabeled",
  "review_requested",
  "review_request_removed",
  "milestoned",
  "demilestoned",
  "locked",
  "unlocked",
  "auto_merge_enabled",
  "auto_merge_disabled",
  "enqueued",
  "dequeued",
  "converted_to_draft",
  "ready_for_review",
  "closed",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function decidePullRequestScan(
  payload: unknown,
): PullRequestScanDecision {
  const action = isRecord(payload) ? payload.action : undefined;
  if (typeof action !== "string") {
    return { scan: false, action: null, reason: "action_missing" };
  }
  if (SCANNED_ACTIONS.has(action)) {
    return { scan: true, action };
  }
  if (action === "edited") {
    const changes = (payload as Record<string, unknown>).changes;
    return isRecord(changes) && isRecord(changes.base)
      ? { scan: true, action }
      : { scan: false, action, reason: "edited_without_base_change" };
  }
  return {
    scan: false,
    action,
    reason: NON_CODE_ACTIONS.has(action)
      ? "action_not_scanned"
      : "action_unrecognized",
  };
}
