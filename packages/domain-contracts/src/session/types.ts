export type SessionStatus = "starting" | "running" | "waiting_for_permission" | "idle" | "error" | "cancelled";

export type RuntimeResumeMode = "none" | "same-process" | "reconnect";

export type SessionResumeState = "history-only" | "resume-available" | "resume-unavailable";

export type SessionRestoreMethod = "client-reconnect" | "session/load" | "session/resume" | "ui-history";

export type SessionResumeInfo = {
  mode: RuntimeResumeMode;
  state: SessionResumeState;
  reason: string;
  checkedAt: string;
  providerId?: string;
  runtimeSessionId?: string;
  restoreMethod?: SessionRestoreMethod;
  lastSeenAt?: string;
};

export type SessionSummary = {
  id: string;
  projectId: string;
  projectName: string;
  helmId: string;
  cwd: string;
  worktreeName: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
  runtimeSessionId?: string;
  agentMode?: string;
  model?: string;
  resume?: SessionResumeInfo;
};
