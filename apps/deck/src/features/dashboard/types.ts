import type { SessionActivitySummary } from "@tiller/shared";

export type DashboardSection =
  | "overview"
  | "tasks"
  | "git"
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

export type DashboardQuickCreateAgent = {
  id: string;
  name: string;
};

export type DashboardQuickCreateHelm = {
  key: string;
  name: string;
  endpoint: string;
  agents: DashboardQuickCreateAgent[];
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
  /** Optional task title used when promoting a prepared dashboard record. */
  title?: string;
  projectId?: string | null;
  helmKey: string;
  cwd?: string | null;
  agentId?: string | null;
  /** Prepared dashboard record to remove after successful promotion. */
  preparationId?: string;
  revision?: number;
};

export type DashboardQuickCreateRequest = DashboardQuickCreateRequestBase & (
  | {
      mode: "new";
      agentId?: string | null;
    }
  | {
      mode: "reuse";
      sessionId: string;
  }
);

export type DashboardQuickCreatePreset = {
  projectId?: string | null;
  helmKey?: string | null;
  cwd?: string | null;
  prompt?: string | null;
  title?: string | null;
  preparationId?: string | null;
  revision?: number;
  agentId?: string | null;
  focusTarget?: "project" | "agent";
};
