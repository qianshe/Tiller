import type { FileDiffSummary, StoredTextContentRef } from "@tiller/shared";
import type { GitGraphState, GitStatusState } from "../../store/facade";

export type GitScope = {
  helmKey: string;
  projectId: string;
  cwd: string;
};

export type GitScopeKey = string;

export type GitDisplayFile = FileDiffSummary & {
  indexStatus?: string;
  worktreeStatus?: string;
};

export type GitStatusFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  patchTruncated?: boolean;
  patchRef?: StoredTextContentRef;
};

export type GitDispatchResult = {
  ok?: boolean;
  message?: string;
  remoteRefreshError?: string;
};

export type GitScopeSnapshot = {
  scope: GitScope;
  scopeKey: GitScopeKey;
  status?: GitStatusState;
  graph?: GitGraphState;
};

export type GitPatchState = {
  loading?: boolean;
  error?: string;
};

export type GitWorkspaceState =
  | "idle"
  | "loading"
  | "ready"
  | "clean"
  | "error"
  | "disconnected";
