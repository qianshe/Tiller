import type {
  AcpAgentProvider,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionDecision,
  PermissionRequest,
  ProjectSummary,
  SessionCleanupResult,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";

export type ClientToDaemon =
  | {
      type: "helm.list";
      requestId: string;
    }
  | {
      type: "project.list";
      requestId: string;
    }
  | {
      type: "workspace.list";
      requestId: string;
    }
  | {
      type: "workspace.save";
      requestId: string;
      workspace: WorkspaceSummary;
    }
  | {
      type: "agent.list";
      requestId: string;
    }
  | {
      type: "agent.test";
      requestId: string;
      providerId: string;
    }
  | {
      type: "agent.save";
      requestId: string;
      provider: Pick<AcpAgentProvider, "id" | "name" | "kind" | "command" | "args" | "env" | "cwd" | "installHint" | "initializeTimeoutMs" | "defaultAgent">;
    }
  | {
      type: "session.create";
      requestId: string;
      projectId: string;
      workspaceId: string;
      agentId: string;
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    }
  | {
      type: "session.list";
      requestId: string;
    }
  | {
      type: "session.messages.list";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "session.artifacts.get";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "session.resume.check";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "session.resume.start";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "session.prompt";
      requestId: string;
      sessionId: string;
      text: string;
    }
  | {
      type: "session.configure";
      requestId: string;
      sessionId: string;
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    }
  | {
      type: "permission.respond";
      requestId: string;
      permissionRequestId: string;
      decision: PermissionDecision;
    }
  | {
      type: "session.cancel";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "session.cleanup";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "device.pair";
      requestId: string;
      pairingCode: string;
    }
  | {
      type: "device.auth";
      requestId: string;
      token: string;
    };

export type DaemonToClient =
  | {
      type: "helm.list.result";
      requestId: string;
      helms: HelmSummary[];
    }
  | {
      type: "project.list.result";
      requestId: string;
      projects: ProjectSummary[];
    }
  | {
      type: "workspace.list.result";
      requestId: string;
      workspaces: WorkspaceSummary[];
    }
  | {
      type: "workspace.save.result";
      requestId: string;
      ok: boolean;
      workspaceId: string;
      message: string;
    }
  | {
      type: "agent.list.result";
      requestId: string;
      agents: AcpAgentProvider[];
    }
  | {
      type: "agent.test.result";
      requestId: string;
      ok: boolean;
      providerId: string;
      message: string;
    }
  | {
      type: "agent.save.result";
      requestId: string;
      ok: boolean;
      providerId: string;
      message: string;
    }
  | {
      type: "session.created";
      requestId: string;
      session: SessionSummary;
    }
  | {
      type: "session.list.result";
      requestId: string;
      sessions: SessionSummary[];
    }
  | {
      type: "session.messages.list.result";
      requestId: string;
      sessionId: string;
      messages: AgentMessage[];
    }
  | {
      type: "session.artifacts.result";
      requestId: string;
      sessionId: string;
      outputs: CommandChunk[];
      diffs: FileDiffSummary[];
    }
  | {
      type: "session.resume.result";
      requestId: string;
      sessionId: string;
      resume: SessionResumeInfo;
    }
  | {
      type: "session.resume.start.result";
      requestId: string;
      sessionId: string;
      ok: boolean;
      resume: SessionResumeInfo;
      message: string;
    }
  | {
      type: "session.cleanup.result";
      requestId: string;
      result: SessionCleanupResult;
    }
  | {
      type: "session.updated";
      requestId: string;
      session: SessionSummary;
    }
  | {
      type: "session.status";
      sessionId: string;
      status: SessionStatus;
      message?: string;
    }
  | {
      type: "agent.message";
      sessionId: string;
      message: AgentMessage;
    }
  | {
      type: "permission.request";
      sessionId: string;
      permissionRequest: PermissionRequest;
    }
  | {
      type: "permission.resolved";
      sessionId: string;
      permissionRequestId: string;
      decision: PermissionDecision;
    }
  | {
      type: "command.output";
      sessionId: string;
      commandId: string;
      chunk: CommandChunk;
    }
  | {
      type: "diff.update";
      sessionId: string;
      files: FileDiffSummary[];
    }
  | {
      type: "device.pair.result";
      requestId: string;
      ok: boolean;
      token?: string;
      message: string;
    }
  | {
      type: "device.auth.result";
      requestId: string;
      ok: boolean;
      message: string;
    }
  | {
      type: "error";
      requestId?: string;
      sessionId?: string;
      message: string;
      code?: string;
    };
