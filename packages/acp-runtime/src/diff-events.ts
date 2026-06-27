import type { FileDiffSummary } from "@tiller/shared";

export function extractDiffFiles(updateType: string | undefined, update: any): FileDiffSummary[] | null {
  if (!/diff/iu.test(updateType ?? "")) {
    return null;
  }

  const files = Array.isArray(update.files) ? update.files : Array.isArray(update.diff?.files) ? update.diff.files : null;
  if (!files?.length) {
    return null;
  }

  return (files as Array<Record<string, unknown>>)
    .filter((item: Record<string, unknown>) => typeof item.path === "string" || typeof item.file === "string")
    .map((item: Record<string, unknown>) => {
      const patch = extractDiffPatch(item);
      return {
        path: String(item.path ?? item.file),
        status: item.status === "added" || item.status === "deleted" ? item.status : "modified",
        additions: typeof item.additions === "number" ? item.additions : countPatchLines(patch, "+"),
        deletions: typeof item.deletions === "number" ? item.deletions : countPatchLines(patch, "-"),
        ...(patch ? { patch } : {}),
      };
    });
}

function extractDiffPatch(item: Record<string, unknown>): string | undefined {
  const candidates = [item.patch, item.diff, item.hunk, item.content, item.text];
  for (const candidate of candidates) {
    const patch = normalizePatchCandidate(candidate);
    if (patch) {
      return patch;
    }
  }

  if (Array.isArray(item.hunks)) {
    const hunks = item.hunks.map(normalizePatchCandidate).filter((hunk): hunk is string => Boolean(hunk));
    return hunks.length ? hunks.join("\n") : undefined;
  }

  return undefined;
}

function normalizePatchCandidate(candidate: unknown): string | undefined {
  if (typeof candidate === "string") {
    const trimmed = candidate.trimEnd();
    return trimmed ? trimmed : undefined;
  }

  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    return normalizePatchCandidate(record.patch ?? record.diff ?? record.text ?? record.content);
  }

  return undefined;
}

function countPatchLines(patch: string | undefined, marker: "+" | "-") {
  if (!patch) {
    return 0;
  }

  const ignoredPrefix = marker === "+" ? "+++" : "---";
  return patch.split(/\r?\n/u).filter((line) => line.startsWith(marker) && !line.startsWith(ignoredPrefix)).length;
}
