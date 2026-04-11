import { FIXOR_PR_COMMENT_MARKER } from "./comment-constants";

/** GitHub issue comments are ~65k; stay under with headroom. */
export const DEFAULT_MAX_COMMENT_UTF8_BYTES = 58_000;

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Truncate `text` so its UTF-8 length is at most `maxBytes` (best-effort codepoint-safe).
 */
export function truncateUtf8ToMaxBytes(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const slice = text.slice(0, mid);
    if (utf8ByteLength(slice) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low).trimEnd();
}

export type CommentSizeGuardResult = {
  body: string;
  truncated: boolean;
  originalUtf8Bytes: number;
  finalUtf8Bytes: number;
};

/**
 * Keeps the Fixor marker at the end when present; inserts a truncation notice before it.
 */
export function applyCommentSizeGuard(
  body: string,
  maxUtf8Bytes: number = DEFAULT_MAX_COMMENT_UTF8_BYTES
): CommentSizeGuardResult {
  const originalUtf8Bytes = utf8ByteLength(body);
  if (originalUtf8Bytes <= maxUtf8Bytes) {
    return {
      body,
      truncated: false,
      originalUtf8Bytes,
      finalUtf8Bytes: originalUtf8Bytes,
    };
  }

  const markerIdx = body.lastIndexOf(FIXOR_PR_COMMENT_MARKER);
  const hasMarker = markerIdx >= 0;
  const prefix = hasMarker
    ? body.slice(0, markerIdx).trimEnd()
    : body.trimEnd();
  const suffix = hasMarker
    ? body.slice(markerIdx)
    : `\n\n${FIXOR_PR_COMMENT_MARKER}\n`;

  const notice =
    `\n\n---\n\n> **Note:** This comment was **truncated by Fixor** to stay within GitHub size limits ` +
    `(~${originalUtf8Bytes} bytes → limit ${maxUtf8Bytes} bytes UTF-8). Some fix details were omitted.\n`;

  const budgetForPrefix = maxUtf8Bytes - utf8ByteLength(notice) - utf8ByteLength(suffix) - 64;
  const safeBudget = Math.max(4096, budgetForPrefix);

  const truncatedPrefix = truncateUtf8ToMaxBytes(prefix, safeBudget);
  const newBody = `${truncatedPrefix}${notice}${suffix}`;
  const finalUtf8Bytes = utf8ByteLength(newBody);

  return {
    body: newBody,
    truncated: true,
    originalUtf8Bytes,
    finalUtf8Bytes,
  };
}
