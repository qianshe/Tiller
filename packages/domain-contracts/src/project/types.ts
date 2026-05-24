export type WorktreeSummary = {
  name: string;
  path: string;
  branch?: string;
  kind?: "root" | "git-worktree";
  summary?: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  helmId: string;
  path?: string;
  summary?: string;
  gitBranches?: string[];
  gitCurrentBranch?: string;
  worktrees?: WorktreeSummary[];
};
