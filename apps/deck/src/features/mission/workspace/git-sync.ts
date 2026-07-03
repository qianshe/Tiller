import type { FileDiffSummary } from "@tiller/shared";

export type GitStatusDiffFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

export function reconcileMissionDiffs(
  sessionDiffs: FileDiffSummary[],
  gitStatusFiles: GitStatusDiffFile[] | undefined,
) {
  if (!gitStatusFiles?.length) {
    return [];
  }

  const diffsByPath = new Map(
    sessionDiffs.map((diff) => [normalizeMissionDiffPath(diff.path), diff] as const),
  );

  return gitStatusFiles.map((file) => {
    const normalizedPath = normalizeMissionDiffPath(file.path);
    const existingDiff = diffsByPath.get(normalizedPath);
    const fallbackPatch = file.patch ?? "";
    const fallbackAdditions = file.additions ?? 0;
    const fallbackDeletions = file.deletions ?? 0;

    if (existingDiff) {
      return {
        ...existingDiff,
        additions: existingDiff.additions || fallbackAdditions,
        deletions: existingDiff.deletions || fallbackDeletions,
        patch: existingDiff.patch || fallbackPatch,
      } satisfies FileDiffSummary;
    }

    return {
      path: file.path,
      status: mapGitStatusToDiffStatus(file.indexStatus, file.worktreeStatus),
      additions: fallbackAdditions,
      deletions: fallbackDeletions,
      patch: fallbackPatch,
    } satisfies FileDiffSummary;
  });
}

export function shouldPrimeGitGraphLoad(
  currentGraph:
    | {
      loading?: boolean;
      lastUpdated?: string;
      commits?: Array<unknown>;
    }
    | undefined,
) {
  return !currentGraph?.loading &&
    !currentGraph?.lastUpdated &&
    (currentGraph?.commits?.length ?? 0) === 0;
}

function mapGitStatusToDiffStatus(indexStatus: string, worktreeStatus: string): FileDiffSummary["status"] {
  const combinedStatus = `${indexStatus}${worktreeStatus}`;
  if (combinedStatus.includes("A") || combinedStatus.includes("?")) {
    return "added";
  }
  if (combinedStatus.includes("D")) {
    return "deleted";
  }
  return "modified";
}

function normalizeMissionDiffPath(path: string) {
  return path.replace(/\\/g, "/");
}
