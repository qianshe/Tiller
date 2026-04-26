import type {
  AcpAgentProvider,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";

export type ClientToDaemon =
  | {
      type: "workspace.list";
      requestId: string;
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
      provider: Pick<AcpAgentProvider, "id" | "name" | "kind" | "command" | "args" | "env" | "cwd" | "installHint" | "initializeTimeoutMs">;
    }
  | {
      type: "session.create";
      requestId: string;
      workspaceId: string;
      agentId: string;
    }
  | {
      type: "session.prompt";
      requestId: string;
      sessionId: string;
      text: string;
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
    };

export type DaemonToClient =
  | {
      type: "workspace.list.result";
      requestId: string;
      workspaces: WorkspaceSummary[];
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
      type: "error";
      requestId?: string;
      sessionId?: string;
      message: string;
      code?: string;
    };
