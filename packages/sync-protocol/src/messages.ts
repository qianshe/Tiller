import type {
  AcpAgentProvider,
  AcpModelOption,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionDecision,
  PermissionRequest,
  ProjectFileSummary,
  ProjectSummary,
  SessionCleanupResult,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionStatus,
  SessionSummary,
  TrustedClientKind,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";

export type AcpDiscoveryCandidate = {
  id: string;
  name: string;
  command: string;
  args?: string[];
  available: boolean;
  configured: boolean;
};

export type ClientToHelm =
  | {
      type: "helm.list";
      requestId: string;
    }
  | {
      type: "helm.save";
      requestId: string;
      helm: HelmSummary;
    }
  | {
      type: "project.list";
      requestId: string;
    }
  | {
      type: "project.files.list";
      requestId: string;
      projectId: string;
      workspaceId?: string;
    }
  | {
      type: "project.save";
      requestId: string;
      project: ProjectSummary;
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
      type: "workspace.git.list";
      requestId: string;
      projectId: string;
    }
  | {
      type: "workspace.git.create";
      requestId: string;
      projectId: string;
      branchName: string;
    }
  | {
      type: "agent.list";
      requestId: string;
    }
  | {
      type: "agent.discover";
      requestId: string;
    }
  | {
      type: "agent.test";
      requestId: string;
      providerId: string;
    }
  | {
      type: "agent.model.options.get";
      requestId: string;
      providerId: string;
      workspaceId: string;
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
      agentMode?: string;
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
      limit?: number;
      before?: string;
    }
  | {
      type: "session.artifacts.get";
      requestId: string;
      sessionId: string;
      limit?: number;
      before?: string;
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
      clientMessageId?: string;
    }
  | {
      type: "session.configure";
      requestId: string;
      sessionId: string;
      agentMode?: string;
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
      type: "device.list";
      requestId: string;
    }
  | {
      type: "device.revoke";
      requestId: string;
      deviceId: string;
    }
  | {
      type: "device.pair";
      requestId: string;
      pairingCode: string;
      deviceId: string;
      deviceName: string;
      clientKind: TrustedClientKind;
    }
  | {
      type: "device.auth";
      requestId: string;
      deviceId: string;
      token: string;
    };

export type HelmToClient =
  | {
      type: "helm.list.result";
      requestId: string;
      helms: HelmSummary[];
    }
  | {
      type: "helm.save.result";
      requestId: string;
      ok: boolean;
      helmId: string;
      message: string;
    }
  | {
      type: "project.list.result";
      requestId: string;
      projects: ProjectSummary[];
    }
  | {
      type: "project.files.result";
      requestId: string;
      ok: boolean;
      projectId: string;
      workspaceId?: string;
      files: ProjectFileSummary[];
      message: string;
    }
  | {
      type: "project.save.result";
      requestId: string;
      ok: boolean;
      projectId: string;
      message: string;
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
      type: "workspace.git.result";
      requestId: string;
      ok: boolean;
      projectId: string;
      currentBranch?: string;
      branches: string[];
      workspaces: WorkspaceSummary[];
      selectedWorkspaceId?: string;
      message: string;
    }
  | {
      type: "agent.list.result";
      requestId: string;
      agents: AcpAgentProvider[];
    }
  | {
      type: "agent.discover.result";
      requestId: string;
      agents: AcpAgentProvider[];
      discoveredCount: number;
      candidates: AcpDiscoveryCandidate[];
      message: string;
    }
  | {
      type: "agent.test.result";
      requestId: string;
      ok: boolean;
      providerId: string;
      message: string;
    }
  | {
      type: "agent.model.options.result";
      requestId: string;
      ok: boolean;
      providerId: string;
      workspaceId: string;
      message: string;
      currentModelId?: string;
      modelOptions: AcpModelOption[];
      configOptions: SessionConfigOption[];
      state: { agentMode?: string; model?: string; reasoningEffort?: SessionReasoningEffort };
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
      nextCursor?: string;
      hasMore?: boolean;
    }
  | {
      type: "session.artifacts.result";
      requestId: string;
      sessionId: string;
      outputs: CommandChunk[];
      diffs: FileDiffSummary[];
      toolCalls: AgentToolCall[];
      nextCursor?: string;
      hasMore?: boolean;
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
      type: "session.config.options";
      sessionId: string;
      state: { agentMode?: string; model?: string; reasoningEffort?: SessionReasoningEffort };
      options: SessionConfigOption[];
    }
  | {
      type: "session.model.options";
      sessionId: string;
      currentModelId?: string;
      options: AcpModelOption[];
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
      type: "tool.call";
      sessionId: string;
      toolCall: AgentToolCall;
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
      trustedUntil?: string;
      deviceName?: string;
      message: string;
    }
  | {
      type: "device.auth.result";
      requestId: string;
      ok: boolean;
      trustedUntil?: string;
      requiresPairing?: boolean;
      message: string;
    }
  | {
      type: "device.list.result";
      requestId: string;
      devices: TrustedDeviceSummary[];
    }
  | {
      type: "device.revoke.result";
      requestId: string;
      ok: boolean;
      deviceId: string;
      message: string;
    }
  | {
      type: "error";
      requestId?: string;
      sessionId?: string;
      message: string;
      code?: string;
    };
