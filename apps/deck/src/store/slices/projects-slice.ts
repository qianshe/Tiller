import type { ProjectSummary, WorkspaceSummary } from "@tiller/shared";
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

export type WorkspacesUpdater =
  | WorkspaceSummary[]
  | ((current: WorkspaceSummary[]) => WorkspaceSummary[]);

export type WorktreeGitUpdater =
  | Record<string, WorktreeGitState>
  | ((current: Record<string, WorktreeGitState>) => Record<string, WorktreeGitState>);

export type ProjectsSlice = {
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
  worktreeGitByProject: Record<string, WorktreeGitState>;
  setProjects: (updater: ProjectsUpdater) => void;
  setWorkspaces: (updater: WorkspacesUpdater) => void;
  setWorktreeGitByProject: (updater: WorktreeGitUpdater) => void;
};

export const createProjectsSlice: StateCreator<ProjectsSlice> = (set) => ({
  projects: [],
  workspaces: [],
  worktreeGitByProject: {},
  setProjects: (updater) =>
    set((state) => ({
      projects: typeof updater === "function" ? updater(state.projects) : updater,
    })),
  setWorkspaces: (updater) =>
    set((state) => ({
      workspaces:
        typeof updater === "function" ? updater(state.workspaces) : updater,
    })),
  setWorktreeGitByProject: (updater) =>
    set((state) => ({
      worktreeGitByProject:
        typeof updater === "function"
          ? updater(state.worktreeGitByProject)
          : updater,
    })),
});
