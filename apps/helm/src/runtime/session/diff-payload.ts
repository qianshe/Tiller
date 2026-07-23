import type { FileDiffSummary } from "@tiller/shared";
import type { SessionDiffBodyStore } from "@tiller/persistence";

export const MAX_INLINE_DIFF_PATCH_BYTES = 8 * 1024;
export const MAX_INLINE_DIFF_SNAPSHOT_BYTES = 256 * 1024;
export const DIFF_PATCH_PREVIEW_CHARS = 2 * 1024;

export function materializeDiffPayloads(
  sessionId: string,
  diffs: FileDiffSummary[],
  store: SessionDiffBodyStore,
) {
  let inlineBytes = 0;
  return diffs.map((diff) => {
    if (diff.patchTruncated && diff.patchRef) {
      return diff;
    }
    if (!diff.patch) {
      return diff;
    }
    const patchBytes = Buffer.byteLength(diff.patch, "utf8");
    if (
      patchBytes <= MAX_INLINE_DIFF_PATCH_BYTES &&
      inlineBytes + patchBytes <= MAX_INLINE_DIFF_SNAPSHOT_BYTES
    ) {
      inlineBytes += patchBytes;
      return { ...diff, patchTruncated: false };
    }
    const stored = store.putText({ sessionId, path: diff.path, text: diff.patch });
    return {
      ...diff,
      patch: diff.patch.slice(0, DIFF_PATCH_PREVIEW_CHARS),
      patchTruncated: true,
      patchRef: {
        id: stored.id,
        uri: stored.uri,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
      },
    };
  });
}
