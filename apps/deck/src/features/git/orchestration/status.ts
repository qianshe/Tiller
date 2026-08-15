import type { FileDiffSummary } from "@tiller/shared";
import type { GitDispatchResult, GitStatusFile } from "../types";

export const GIT_STATUS_CACHE_TTL_MS = 60_000;
export const GIT_GRAPH_CACHE_TTL_MS = 5 * 60_000;

const inFlightStatusRequests = new Map<string, Promise<GitDispatchResult>>();
const inFlightGraphRequests = new Map<string, Promise<GitDispatchResult>>();

export type GitDispatch = (
  method: string,
  params: Record<string, unknown>,
) => Promise<GitDispatchResult>;

export function isGitCacheFresh(
  lastUpdated: string | undefined,
  ttlMs: number,
  now = Date.now(),
) {
  if (!lastUpdated || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return false;
  }
  const updatedAt = Date.parse(lastUpdated);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  const age = now - updatedAt;
  return age >= 0 && age < ttlMs;
}

function resolveRequestScopeKey(
  scopeKey: string | undefined,
  projectId: string,
  cwd: string,
) {
  return scopeKey ?? `${projectId}::${normalizeGitPath(cwd)}`;
}

function trackInFlightRequest(
  requests: Map<string, Promise<GitDispatchResult>>,
  key: string,
  createRequest: () => Promise<GitDispatchResult>,
) {
  const existing = requests.get(key);
  if (existing) {
    return existing;
  }

  const request = createRequest();
  requests.set(key, request);
  request.then(
    () => {
      if (requests.get(key) === request) requests.delete(key);
    },
    () => {
      if (requests.get(key) === request) requests.delete(key);
    },
  );
  return request;
}

export function requestGitStatus(
  dispatch: GitDispatch,
  opts: {
    projectId: string;
    cwd: string;
    scopeKey?: string;
    refreshRemote?: boolean;
  },
) {
  const scopeKey = resolveRequestScopeKey(opts.scopeKey, opts.projectId, opts.cwd);
  const refreshRemote = opts.refreshRemote ?? false;
  const requestKey = `${scopeKey}:status:${refreshRemote ? "remote" : "local"}`;
  return trackInFlightRequest(inFlightStatusRequests, requestKey, () =>
    dispatch("project/git/status", {
      projectId: opts.projectId,
      cwd: opts.cwd,
      refreshRemote,
    }),
  );
}

export function requestGitGraph(
  dispatch: GitDispatch,
  opts: {
    projectId: string;
    cwd: string;
    scopeKey?: string;
    knownSignature?: string;
  },
) {
  const scopeKey = resolveRequestScopeKey(opts.scopeKey, opts.projectId, opts.cwd);
  const signature = opts.knownSignature ?? "";
  const requestKey = `${scopeKey}:graph:${signature}`;
  return trackInFlightRequest(inFlightGraphRequests, requestKey, () =>
    dispatch("project/git/graph", {
      projectId: opts.projectId,
      cwd: opts.cwd,
      ...(opts.knownSignature ? { knownSignature: opts.knownSignature } : {}),
    }),
  );
}

export function mapGitStatusToDiffStatus(
  indexStatus: string,
  worktreeStatus: string,
): FileDiffSummary["status"] {
  const combinedStatus = `${indexStatus}${worktreeStatus}`;
  if (combinedStatus.includes("A") || combinedStatus.includes("?")) {
    return "added";
  }
  if (combinedStatus.includes("D")) {
    return "deleted";
  }
  return "modified";
}

export function toGitFileDiff(file: GitStatusFile): FileDiffSummary {
  return {
    path: file.path,
    status: mapGitStatusToDiffStatus(file.indexStatus, file.worktreeStatus),
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    ...(file.patch ? { patch: file.patch } : {}),
    ...(file.patchTruncated ? { patchTruncated: true } : {}),
    ...(file.patchRef ? { patchRef: file.patchRef } : {}),
  };
}

export function reconcileGitDiffs(
  sessionDiffs: FileDiffSummary[],
  gitStatusFiles: GitStatusFile[] | undefined,
) {
  if (!gitStatusFiles?.length) {
    return [];
  }

  const diffsByPath = new Map(
    sessionDiffs.map((diff) => [normalizeGitPath(diff.path), diff] as const),
  );

  return gitStatusFiles.map((file) => {
    const existingDiff = diffsByPath.get(normalizeGitPath(file.path));
    if (!existingDiff) {
      return toGitFileDiff(file);
    }
    return {
      ...existingDiff,
      additions: existingDiff.additions || file.additions || 0,
      deletions: existingDiff.deletions || file.deletions || 0,
      ...(existingDiff.patch || file.patch ? { patch: existingDiff.patch || file.patch } : {}),
      ...(file.patchTruncated ? { patchTruncated: true } : {}),
      ...(file.patchRef ? { patchRef: file.patchRef } : {}),
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

export async function refreshGitStatusAndGraph(
  dispatch: GitDispatch,
  opts: {
    projectId: string;
    cwd: string;
    scopeKey?: string;
    hasGraph?: boolean;
    refreshRemote?: boolean;
    graphSignature?: string;
  },
) {
  const status = await requestGitStatus(dispatch, {
    projectId: opts.projectId,
    cwd: opts.cwd,
    scopeKey: opts.scopeKey,
    refreshRemote: opts.refreshRemote,
  });
  if (!status?.ok || !opts.hasGraph) {
    return status;
  }
  await requestGitGraph(dispatch, {
    projectId: opts.projectId,
    cwd: opts.cwd,
    scopeKey: opts.scopeKey,
    knownSignature: opts.graphSignature,
  });
  return status;
}

export function toGitScopeFromPayload(
  helmKey: string,
  payload: { projectId?: unknown; cwd?: unknown },
) {
  return typeof payload.projectId === "string" && typeof payload.cwd === "string"
    ? { helmKey, projectId: payload.projectId, cwd: payload.cwd }
    : undefined;
}

function normalizeGitPath(path: string) {
  return path.replace(/\\/g, "/");
}
