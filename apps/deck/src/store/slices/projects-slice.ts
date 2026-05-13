import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import type { StateCreator } from "zustand";

export type WorktreeGitState = {
  branches: string[];
  currentBranch?: string;
  message?: string;
  loading?: boolean;
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

export type ProjectsSlice = {
  projects: ProjectSummary[];
  worktrees: WorktreeSummary[];
  worktreeGitByProject: Record<string, WorktreeGitState>;
  setProjects: (updater: ProjectsUpdater) => void;
  setWorktrees: (updater: WorktreesUpdater) => void;
  setWorktreeGitByProject: (updater: WorktreeGitUpdater) => void;
};

export const createProjectsSlice: StateCreator<ProjectsSlice> = (set) => ({
  projects: [],
  worktrees: [],
  worktreeGitByProject: {},
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
});
