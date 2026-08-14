import type { FileDiffSummary } from "@tiller/shared";
import {
  mapGitStatusToDiffStatus,
  reconcileGitDiffs as reconcileSharedGitDiffs,
  refreshGitStatusAndGraph as refreshSharedGitStatusAndGraph,
  shouldPrimeGitGraphLoad as shouldPrimeSharedGitGraphLoad,
} from "../../git/orchestration/status";

export type GitStatusDiffFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  patchTruncated?: boolean;
  patchRef?: import("@tiller/shared").StoredTextContentRef;
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
  return reconcileSharedGitDiffs(sessionDiffs, gitStatusFiles);
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
  return shouldPrimeSharedGitGraphLoad(currentGraph);
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
    scopeKey?: string;
    refreshRemote?: boolean;
    // Cached graph signature; lets the server answer "unchanged" without payload.
    graphSignature?: string;
  },
) {
  return refreshSharedGitStatusAndGraph(dispatch, opts);
}

export { mapGitStatusToDiffStatus };
