import type { SessionActivitySummary } from "@tiller/shared";

export type DashboardSection =
  | "overview"
  | "tasks"
  | "automations"
  | "issues"
  | "agents"
  | "settings";

export type DashboardActivityTrendPoint = {
  date: string;
  promptCount: number;
  toolCallCount: number;
};

export type DashboardActivitySummary = SessionActivitySummary;

export type DashboardRecentActivitySummary = {
  recentActivityCount: number;
  sparklinePoints: number[];
};

export type DashboardQuickCreateAgent = {
  id: string;
  name: string;
};

export type DashboardQuickCreateIdleSession = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  updatedAt: string;
};

export type DashboardQuickCreateProject = {
  /** Stable value for a project option when two Helms expose the same project id. */
  key?: string;
  /** Project id as understood by the selected Helm. */
  projectId?: string;
  id: string;
  name: string;
  /** Git branch selected as the working directory for the task. */
  branch?: string;
  cwd?: string | null;
  helmKey?: string;
  helmName?: string;
  helmEndpoint?: string;
  agents?: DashboardQuickCreateAgent[];
  /** Idle sessions scoped to this exact Helm, project, and worktree. */
  idleSessions?: DashboardQuickCreateIdleSession[];
};

type DashboardQuickCreateRequestBase = {
  prompt: string;
  projectId: string;
  helmKey: string;
  cwd: string | null;
};

export type DashboardQuickCreateRequest = DashboardQuickCreateRequestBase & (
  | {
      mode: "new";
      agentId: string;
    }
  | {
      mode: "reuse";
      sessionId: string;
    }
);
