import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import type { StateCreator } from "zustand";

export type WorktreeGitState = {
  branches: string[];
  currentBranch?: string;
  message?: string;
  loading?: boolean;
};

export type GitStatusFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

export type GitStatusState = {
  projectId: string;
  cwd: string;
  branch: string;
  clean: boolean;
  files: GitStatusFile[];
  loading?: boolean;
  committing?: boolean;
  lastUpdated?: string;
  message?: string;
};

export type GitRef = {
  name: string;
  kind: "branch" | "tag" | "detached";
  isCurrent: boolean;
};

export type GitCommit = {
  hash: string;
  parents: string[];
  refs: GitRef[];
  subject: string;
  authorName: string;
  authoredAt: string;
  body?: string;
  changedFiles?: number;
  insertions?: number;
  deletions?: number;
};

export type GitGraphState = {
  projectId: string;
  cwd: string;
  head?: string;
  commits: GitCommit[];
  loading?: boolean;
  lastUpdated?: string;
  message?: string;
};

export type ProjectsUpdater =
  | ProjectSummary[]
  | ((current: ProjectSummary[]) => ProjectSummary[]);

export type WorktreesUpdater =
  | WorktreeSummary[]
  | ((current: WorktreeSummary[]) => WorktreeSummary[]);

export type WorktreeGitUpdater =
  | Record<string, WorktreeGitState>
  | ((current: Record<string, WorktreeGitState>) => Record<string, WorktreeGitState>);

export type GitStatusByWorktreeUpdater =
  | Record<string, GitStatusState>
  | ((current: Record<string, GitStatusState>) => Record<string, GitStatusState>);

export type GitGraphByWorktreeUpdater =
  | Record<string, GitGraphState>
  | ((current: Record<string, GitGraphState>) => Record<string, GitGraphState>);

export type ProjectsSlice = {
  projects: ProjectSummary[];
  worktrees: WorktreeSummary[];
  worktreeGitByProject: Record<string, WorktreeGitState>;
  gitStatusByWorktree: Record<string, GitStatusState>;
  gitGraphByWorktree: Record<string, GitGraphState>;
  setProjects: (updater: ProjectsUpdater) => void;
  setWorktrees: (updater: WorktreesUpdater) => void;
  setWorktreeGitByProject: (updater: WorktreeGitUpdater) => void;
  setGitStatusByWorktree: (updater: GitStatusByWorktreeUpdater) => void;
  setGitGraphByWorktree: (updater: GitGraphByWorktreeUpdater) => void;
};

export const createProjectsSlice: StateCreator<ProjectsSlice> = (set) => ({
  projects: [],
  worktrees: [],
  worktreeGitByProject: {},
  gitStatusByWorktree: {},
  gitGraphByWorktree: {},
  setProjects: (updater) =>
    set((state) => ({
      projects: typeof updater === "function" ? updater(state.projects) : updater,
    })),
  setWorktrees: (updater) =>
    set((state) => ({
      worktrees:
        typeof updater === "function" ? updater(state.worktrees) : updater,
    })),
  setWorktreeGitByProject: (updater) =>
    set((state) => ({
      worktreeGitByProject:
        typeof updater === "function"
          ? updater(state.worktreeGitByProject)
          : updater,
    })),
  setGitStatusByWorktree: (updater) =>
    set((state) => ({
      gitStatusByWorktree:
        typeof updater === "function"
          ? updater(state.gitStatusByWorktree)
          : updater,
    })),
  setGitGraphByWorktree: (updater) =>
    set((state) => ({
      gitGraphByWorktree:
        typeof updater === "function"
          ? updater(state.gitGraphByWorktree)
          : updater,
    })),
});
