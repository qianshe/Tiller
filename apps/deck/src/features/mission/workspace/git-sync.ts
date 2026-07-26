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

export type GitDispatchResult = {
  ok?: boolean;
  message?: string;
  remoteRefreshError?: string;
};

export type GitDispatch = (
  method: string,
  params: Record<string, unknown>,
) => Promise<GitDispatchResult>;

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

/**
 * Sequential orchestration for explicit status refresh and Fetch actions:
 * status must resolve before graph is refreshed; refreshRemote controls
 * whether remote refs are fetched first,
 * and graph is only refreshed when the status result is ok and a graph
 * is already tracked for this worktree.
 *
 * The dispatch callback is bound to a specific RPC client by the caller,
 * so this function stays pure and unit-testable.
 */
export async function refreshGitStatusAndGraph(
  dispatch: GitDispatch,
  opts: {
    projectId: string;
    cwd: string;
    hasGraph: boolean;
    refreshRemote?: boolean;
    // Cached graph signature; lets the server answer "unchanged" without payload.
    graphSignature?: string;
  },
) {
  const status = await dispatch("project/git/status", {
    projectId: opts.projectId,
    cwd: opts.cwd,
    refreshRemote: opts.refreshRemote ?? false,
  });
  if (!status?.ok) {
    return status;
  }
  if (opts.hasGraph) {
    await dispatch("project/git/graph", {
      projectId: opts.projectId,
      cwd: opts.cwd,
      ...(opts.graphSignature ? { knownSignature: opts.graphSignature } : {}),
    });
  }
  return status;
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
