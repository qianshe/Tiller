import type { GitGraphState, GitStatusState } from "../../store/facade";
import type { GitScope } from "./types";

export {
  GIT_GRAPH_CACHE_TTL_MS,
  GIT_STATUS_CACHE_TTL_MS,
  isGitCacheFresh,
  requestGitGraph,
  requestGitStatus,
  refreshGitStatusAndGraph,
  reconcileGitDiffs,
  shouldPrimeGitGraphLoad,
  toGitFileDiff,
} from "./orchestration/status";
export { diffLineKey, parseDiffPatchLines, selectContiguousDiffLines } from "./utils/diff-comment-selection";
export type { ParsedDiffLine } from "./utils/diff-comment-selection";
export { GitDiffFileList } from "./ui/diff-file-list";
export { GitDiffDetail } from "./ui/diff-detail";
export {
  buildGitDiffTree,
  formatGitDiffStatus,
  renderGitDiffPatch,
  renderGitDiffStats,
  resolveGitDiffLineClass,
} from "./ui/diff-tree";
export type {
  GitDiffPointerMode,
  GitDiffSelectRangeHandler,
  GitDiffTreeNode,
} from "./ui/diff-tree";
export { useIsCoarsePointer, useLongPress } from "./hooks/use-pointer-input";
export type { GitDispatchResult, GitDisplayFile, GitPatchState, GitScope, GitScopeKey, GitScopeSnapshot, GitStatusFile, GitWorkspaceState } from "./types";

function isWindowsGitCwd(path: string) {
  const trimmedPath = path.trim();
  return /^[A-Za-z]:[\\/]/u.test(trimmedPath) || trimmedPath.startsWith("\\\\");
}

export function normalizeGitCwd(path: string) {
  const trimmedPath = path.trim();
  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\/$/u.test(normalizedPath)) {
    return normalizedPath;
  }
  const normalized = normalizedPath.replace(/\/+$/u, "");
  return normalized || (trimmedPath.startsWith("/") ? "/" : normalized);
}

export function gitCwdKey(path: string) {
  const normalized = normalizeGitCwd(path);
  return isWindowsGitCwd(path) ? normalized.toLowerCase() : normalized;
}

export function gitScopeKey(scope: GitScope): string {
  return `${scope.helmKey.trim()}::${scope.projectId.trim()}::${gitCwdKey(scope.cwd)}`;
}

export function resolveGitTrackingNotice(status: GitStatusState | undefined) {
  if (!status?.trackingStale && !status?.remoteRefreshError) {
    return undefined;
  }
  return status.remoteRefreshError
    ? `远端状态可能已过期：${status.remoteRefreshError}`
    : "远端状态可能已过期";
}

export function resolveGitStatus(
  states: Record<string, GitStatusState> | undefined,
  scope: GitScope,
) {
  if (!states) return undefined;
  return states[gitScopeKey(scope)];
}

export function resolveGitGraph(
  states: Record<string, GitGraphState> | undefined,
  scope: GitScope,
) {
  if (!states) return undefined;
  return states[gitScopeKey(scope)];
}
