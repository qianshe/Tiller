import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import {
  createGitStatusState,
  type GitGraphState,
  type GitStatusState,
} from "../../../store/facade";
import { toast } from "../../toast";
import { refreshGitStatusAndGraph, type GitDispatch, type GitDispatchResult } from "./git-sync";

type StoreUpdater<T> = T | ((current: T) => T);
type StoreSetter<T> = (updater: StoreUpdater<T>) => void;

/**
 * Everything a single Git operation needs, bound to one (projectId, cwd) pair.
 * The runners below stay React-free so they can be unit-tested directly;
 * useGitOperations assembles this context from store setters per invocation.
 */
export type GitOperationContext = {
  projectId: string;
  cwd: string;
  hasGraph: boolean;
  // Cached graph signature echoed to Helm so unchanged graphs skip the payload.
  graphSignature?: string;
  dispatch: GitDispatch;
  updateStatus: (updater: (current: GitStatusState) => GitStatusState) => void;
  patchGraph?: (patch: { loading: boolean; message?: string; error?: string }) => void;
  notify: {
    success: (message: string) => void;
    warning: (message: string) => void;
    error: (message: string) => void;
  };
  onCommitSuccess?: () => void;
  onDiscardSuccess?: (paths: string[]) => void;
};

/**
 * Helm reports remote fetch failures as ok:true + remoteRefreshError so the
 * local snapshot still applies; for user-facing Fetch feedback that counts
 * as a failure.
 */
export function resolveFetchOutcome(
  result: GitDispatchResult | undefined,
): { ok: boolean; errorMessage?: string } {
  if (result?.ok && !result.remoteRefreshError) {
    return { ok: true };
  }
  if (result?.ok) {
    return { ok: false, errorMessage: result.remoteRefreshError };
  }
  return { ok: false, errorMessage: result?.message };
}

export async function runGitRefresh(
  context: GitOperationContext,
  opts: { refreshRemote: boolean },
): Promise<GitDispatchResult> {
  const { projectId, cwd, hasGraph } = context;

  // Seed a complete loading state even when this worktree has never been refreshed.
  context.updateStatus((current) => ({
    ...current,
    loading: true,
    message: opts.refreshRemote ? "正在 Fetch..." : "正在刷新 Git...",
  }));
  if (hasGraph) {
    context.patchGraph?.({ loading: true });
  }

  try {
    const status = await refreshGitStatusAndGraph(context.dispatch, {
      projectId,
      cwd,
      hasGraph,
      refreshRemote: opts.refreshRemote,
      graphSignature: context.graphSignature,
    });
    if (!status?.ok && hasGraph) {
      // Status events clear the status entry's loading flag, but the graph
      // loading flag was set locally above and no graph refresh will follow.
      context.patchGraph?.({
        loading: false,
        message: status?.message,
        error: status?.message,
      });
    }
    return status;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : opts.refreshRemote ? "Fetch 失败" : "刷新 Git 失败";
    context.updateStatus((current) => ({
      ...current,
      loading: false,
      message,
      error: message,
    }));
    if (hasGraph) {
      context.patchGraph?.({ loading: false, message, error: message });
    }
    return { ok: false, message };
  }
}

export async function runGitFetch(context: GitOperationContext): Promise<GitDispatchResult> {
  const result = await runGitRefresh(context, { refreshRemote: true });
  const outcome = resolveFetchOutcome(result);
  if (outcome.ok) {
    context.notify.success("Fetch 成功");
  } else if (result?.ok) {
    // Snapshot applied but the remote fetch itself failed.
    context.notify.error(`Fetch 失败：${outcome.errorMessage}`);
  }
  return result;
}

async function runGitRemoteOperation(
  context: GitOperationContext,
  op: { method: string; flag: "pushing" | "pulling"; verb: "Push" | "Pull" },
): Promise<GitDispatchResult> {
  const { projectId, cwd } = context;
  context.updateStatus((current) => ({
    ...current,
    [op.flag]: true,
    message: `正在 ${op.verb}...`,
  }));

  try {
    const result = await context.dispatch(op.method, { projectId, cwd });
    if (result?.ok) {
      const refreshed = await runGitRefresh(context, { refreshRemote: false });
      if (refreshed?.ok) {
        context.notify.success(`${op.verb} 成功`);
      } else {
        context.notify.warning(`${op.verb} 已完成，但 Git 状态刷新失败`);
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : `${op.verb} 失败`;
    context.updateStatus((current) => ({ ...current, message, error: message }));
    return { ok: false, message };
  } finally {
    context.updateStatus((current) => ({ ...current, [op.flag]: false }));
  }
}

export function runGitPush(context: GitOperationContext) {
  return runGitRemoteOperation(context, {
    method: "project/git/push",
    flag: "pushing",
    verb: "Push",
  });
}

export function runGitPull(context: GitOperationContext) {
  return runGitRemoteOperation(context, {
    method: "project/git/pull",
    flag: "pulling",
    verb: "Pull",
  });
}

export async function runGitCommit(
  context: GitOperationContext,
  input: { message: string; paths: string[] },
): Promise<GitDispatchResult> {
  const { projectId, cwd, hasGraph } = context;
  context.updateStatus((current) => ({
    ...current,
    committing: true,
    message: "正在提交 Git 变更...",
  }));

  try {
    const result = await context.dispatch("project/git/commit", {
      projectId,
      cwd,
      message: input.message,
      paths: input.paths,
    });
    if (!result?.ok) {
      return result;
    }

    context.onCommitSuccess?.();
    context.notify.success("提交成功");
    if (hasGraph) {
      await context.dispatch("project/git/graph", {
        projectId,
        cwd,
        ...(context.graphSignature ? { knownSignature: context.graphSignature } : {}),
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交 Git 变更失败";
    context.updateStatus((current) => ({ ...current, message, error: message }));
    return { ok: false, message };
  } finally {
    context.updateStatus((current) => ({ ...current, committing: false }));
  }
}

export type GitFileDiffPayload = GitDispatchResult & {
  files?: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch?: string;
    patchTruncated?: boolean;
  }>;
};

/**
 * Batched on-demand patch fetch; the result event merges patch bodies back
 * into the status snapshot (see applyGitFileDiffResult).
 */
export async function runGitFileDiffs(
  context: GitOperationContext,
  paths: string[],
): Promise<GitFileDiffPayload> {
  if (paths.length === 0) {
    return { ok: false, message: "没有需要获取 diff 的文件" };
  }
  const { projectId, cwd } = context;
  return await context.dispatch("project/git/file_diff", {
    projectId,
    cwd,
    paths,
  }) as GitFileDiffPayload;
}

export async function runGitDiscard(
  context: GitOperationContext,
  paths: string[],
): Promise<GitDispatchResult> {
  const { projectId, cwd } = context;
  if (paths.length === 0) {
    return { ok: false, message: "请先选择要丢弃的改动" };
  }

  context.updateStatus((current) => ({
    ...current,
    discarding: true,
    message: "正在丢弃 Git 改动...",
    error: undefined,
  }));

  try {
    const result = await context.dispatch("project/git/discard", { projectId, cwd, paths });
    if (result?.ok) {
      context.onDiscardSuccess?.(paths);
      context.notify.success("已丢弃选中改动");
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "丢弃 Git 改动失败";
    context.updateStatus((current) => ({ ...current, message, error: message }));
    return { ok: false, message };
  } finally {
    context.updateStatus((current) => ({ ...current, discarding: false }));
  }
}

export function useGitOperations(options: {
  activeGitProjectId: string | null | undefined;
  activeGitCwd: string | null | undefined;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  dispatch: DispatchToHelm;
  gitGraphByWorktree: Record<string, GitGraphState>;
  setGitStatusByWorktree: StoreSetter<Record<string, GitStatusState>>;
  setGitGraphByWorktree?: StoreSetter<Record<string, GitGraphState>>;
  setSelectedCommitDiffPaths: StoreSetter<Set<string>>;
}) {
  const {
    activeGitProjectId,
    activeGitCwd,
    rpcClientRef,
    dispatch,
    gitGraphByWorktree,
    setGitStatusByWorktree,
    setGitGraphByWorktree,
    setSelectedCommitDiffPaths,
  } = options;

  const buildContext = useCallback((): GitOperationContext | null => {
    if (!activeGitProjectId || !activeGitCwd || !rpcClientRef.current) {
      return null;
    }
    const projectId = activeGitProjectId;
    const cwd = activeGitCwd;
    const client = rpcClientRef.current;
    return {
      projectId,
      cwd,
      hasGraph: Boolean(gitGraphByWorktree[cwd]),
      graphSignature: gitGraphByWorktree[cwd]?.signature,
      dispatch: (method, params) =>
        dispatch(client, method, params) as Promise<GitDispatchResult>,
      updateStatus: (updater) => {
        setGitStatusByWorktree((current) => ({
          ...current,
          [cwd]: updater(createGitStatusState(projectId, cwd, current[cwd])),
        }));
      },
      patchGraph: setGitGraphByWorktree
        ? (patch) => {
            setGitGraphByWorktree((prev) => {
              const graph = prev[cwd];
              // Runners only patch when hasGraph; skip if the entry vanished.
              return graph ? { ...prev, [cwd]: { ...graph, ...patch } } : prev;
            });
          }
        : undefined,
      notify: toast,
      onCommitSuccess: () => setSelectedCommitDiffPaths(new Set()),
      onDiscardSuccess: (paths) => {
        setSelectedCommitDiffPaths((current) => {
          const discarded = new Set(paths);
          return new Set(Array.from(current).filter((path) => !discarded.has(path)));
        });
      },
    };
  }, [
    activeGitProjectId,
    activeGitCwd,
    rpcClientRef,
    dispatch,
    gitGraphByWorktree,
    setGitStatusByWorktree,
    setGitGraphByWorktree,
    setSelectedCommitDiffPaths,
  ]);

  const refreshGitStatus = useCallback((refreshRemote: boolean) => {
    const context = buildContext();
    if (!context) {
      return Promise.resolve<GitDispatchResult>({ ok: false });
    }
    return runGitRefresh(context, { refreshRemote });
  }, [buildContext]);

  const handleRefreshGitStatus = useCallback(() => {
    void refreshGitStatus(false);
  }, [refreshGitStatus]);

  const handleFetch = useCallback(async () => {
    const context = buildContext();
    if (!context) {
      return { ok: false };
    }
    return runGitFetch(context);
  }, [buildContext]);

  const handlePush = useCallback(async () => {
    const context = buildContext();
    if (!context) {
      return;
    }
    return runGitPush(context);
  }, [buildContext]);

  const handlePull = useCallback(async () => {
    const context = buildContext();
    if (!context) {
      return;
    }
    return runGitPull(context);
  }, [buildContext]);

  const handleCommit = useCallback(async (message: string, paths: string[]) => {
    const context = buildContext();
    if (!context) {
      return;
    }
    return runGitCommit(context, { message, paths });
  }, [buildContext]);

  const handleDiscard = useCallback(async (paths: string[]) => {
    const context = buildContext();
    if (!context) {
      return { ok: false, message: "未选择 Git 工作区" };
    }
    return runGitDiscard(context, paths);
  }, [buildContext]);

  const handleFetchFileDiffs = useCallback(async (paths: string[]): Promise<GitFileDiffPayload> => {
    const context = buildContext();
    if (!context) {
      return { ok: false, message: "未选择 Git 工作区" };
    }
    return runGitFileDiffs(context, paths);
  }, [buildContext]);

  return {
    refreshGitStatus,
    handleRefreshGitStatus,
    handleFetch,
    handlePush,
    handlePull,
    handleCommit,
    handleDiscard,
    handleFetchFileDiffs,
  };
}
