import type { FileDiffSummary, ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { normalizeDiffPath, readWorktreeGitDiffs } from "../../sessions/facade";
import { summarizeLargeDiffs } from "../diff-limits";
import { createSessionEventPublisher } from "./event/publisher";
import { resolveStoredSessionWorktree } from "./worktree-resolution";

type SessionArtifactStore = {
  replaceDiffs(sessionId: string, diffs: FileDiffSummary[]): void;
};

type SessionRecord = {
  worktree: WorktreeSummary;
};

type SessionDiffHydrationOptions = {
  sessions: Map<string, SessionRecord>;
  sessionStore: { list(): SessionSummary[] };
  sessionArtifactStore: SessionArtifactStore;
  getProjects(): ProjectSummary[];
  getWorktrees(): WorktreeSummary[];
  createHandlerContext(): any;
};

export function createSessionDiffHydrationService(options: SessionDiffHydrationOptions) {
  async function hydrateDiffsFromWorktreeGit(sessionId: string, files: FileDiffSummary[]) {
    const worktree = resolveSessionWorktreeForSession(sessionId);
    if (!worktree) {
      return files;
    }

    const gitDiffs = await readWorktreeGitDiffs(worktree.path);
    if (!gitDiffs.length) {
      return files;
    }

    if (!files.length) {
      return gitDiffs;
    }

    const gitByPath = new Map(gitDiffs.map((file) => [normalizeDiffPath(file.path), file]));
    return files.map((file) => {
      const fromGit = gitByPath.get(normalizeDiffPath(file.path));
      return fromGit
        ? {
            ...file,
            additions: fromGit.additions,
            deletions: fromGit.deletions,
            patch: file.patch ?? fromGit.patch,
          }
        : file;
    });
  }

  async function publishDiffUpdate(sessionId: string, files: FileDiffSummary[]) {
    const diffs = summarizeLargeDiffs(await hydrateDiffsFromWorktreeGit(sessionId, files));
    options.sessionArtifactStore.replaceDiffs(sessionId, diffs);
    createSessionEventPublisher(options.createHandlerContext()).sessionUpdate(sessionId, {
      kind: "diff_update",
      files: diffs,
    });
  }

  function resolveSessionWorktreeForSession(sessionId: string) {
    const liveWorktree = options.sessions.get(sessionId)?.worktree;
    if (liveWorktree) {
      return liveWorktree;
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return null;
    }
    return resolveStoredSessionWorktree({
      summary,
      projects: options.getProjects(),
      worktrees: options.getWorktrees(),
    }) ?? null;
  }

  return {
    hydrateDiffsFromWorktreeGit,
    publishDiffUpdate,
  };
}
