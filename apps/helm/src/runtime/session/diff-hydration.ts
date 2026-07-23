import type { FileDiffSummary, ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";
import type { SessionDiffBodyStore } from "@tiller/persistence";
import { normalizeDiffPath } from "../../sessions/facade";
import { publishCanonicalSessionStateEvent } from "../events";
import { materializeDiffPayloads } from "./diff-payload";
import { resolveStoredSessionWorktree } from "./worktree-resolution";
import { createGitHydrationScheduler } from "./git-hydration-scheduler";

type SessionArtifactStore = {
  replaceDiffs(sessionId: string, diffs: FileDiffSummary[]): void;
};

type SessionRecord = {
  worktree: WorktreeSummary;
};

type SessionDiffHydrationOptions = {
  sessions: Map<string, SessionRecord>;
  sessionStore: { get(sessionId: string): SessionSummary | undefined };
  sessionArtifactStore: SessionArtifactStore;
  sessionDiffBodyStore: SessionDiffBodyStore;
  getProjects(): ProjectSummary[];
  getWorktrees(): WorktreeSummary[];
  createHandlerContext(): any;
};

export function createSessionDiffHydrationService(options: SessionDiffHydrationOptions) {
  const scheduler = createGitHydrationScheduler();
  async function hydrateDiffsFromWorktreeGit(sessionId: string, files: FileDiffSummary[]) {
    const worktree = resolveSessionWorktreeForSession(sessionId);
    if (!worktree) {
      return files;
    }

    const gitDiffs = await scheduler.hydrate(sessionId, worktree.path);
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
    const diffs = materializeDiffPayloads(
      sessionId,
      await hydrateDiffsFromWorktreeGit(sessionId, files),
      options.sessionDiffBodyStore,
    );
    options.sessionArtifactStore.replaceDiffs(sessionId, diffs);
    publishCanonicalSessionStateEvent(
      sessionId,
      { type: "diff-update", files: diffs },
      options.createHandlerContext(),
    );
  }

  function resolveSessionWorktreeForSession(sessionId: string) {
    const liveWorktree = options.sessions.get(sessionId)?.worktree;
    if (liveWorktree) {
      return liveWorktree;
    }

    const summary = options.sessionStore.get(sessionId);
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
    remove: scheduler.remove,
    dispose: scheduler.dispose,
  };
}
