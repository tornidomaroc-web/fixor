/**
 * One-line, report-safe rendering of a thrown value.
 *
 * The full error (with stack) still goes to the log; this is the
 * operator-facing casualty note that appears in a scan report, a
 * WorkflowError message, or a SARIF notification.
 *
 * Shared by BOTH engines on purpose. Engine A (`cli/scan.ts`) and Engine B
 * (`workflows/auditor-workflow.ts`) both name their casualties, and two
 * copies of this would let the same failure render differently depending on
 * which engine saw it. The symmetry between the engines is a claim the
 * tracker makes; one implementation is what makes it true rather than
 * approximately true.
 */
export function errText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const text =
    err.name && err.name !== "Error"
      ? `${err.name}: ${err.message}`
      : err.message;
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}
