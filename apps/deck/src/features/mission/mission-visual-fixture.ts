import type {
  AcpAgentProvider,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";

type MissionVisualFixture = {
  helms: HelmSummary[];
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  statuses: Record<string, SessionStatus>;
  messages: Record<string, AgentMessage[]>;
  outputs: Record<string, CommandChunk[]>;
  toolCalls: Record<string, AgentToolCall[]>;
  diffs: Record<string, FileDiffSummary[]>;
  activeSessionId: string;
  selectedProjectId: string;
  selectedWorkspaceId: string;
  selectedAgentId: string;
};

export function shouldUseMissionVisualFixture() {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("visual") === "mission"
  );
}

export function createMissionVisualFixture({
  defaultDaemonHost,
  defaultDaemonPort,
}: {
  defaultDaemonHost: string;
  defaultDaemonPort: string;
}): MissionVisualFixture {
  const now = new Date().toISOString();
  const helmId = "visual-helm";
  const projectId = "visual-project";
  const workspaceId = "visual-workspace";
  const agentId = "visual-codex";
  const sessionId = "visual-session";
  const session: SessionSummary = {
    id: sessionId,
    projectId,
    projectName: "Tiller",
    helmId,
    workspaceId,
    workspaceName: "Tiller",
    agentId,
    agentName: "Codex",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    status: "running",
    createdAt: now,
    updatedAt: now,
    messageCount: 4,
    runtimeSessionId: "visual-acp-session",
    lastMessagePreview: "按 Zed 风格微调 任务页布局。",
  };

  return {
    helms: [
      {
        id: helmId,
        name: "Local Helm",
        host: defaultDaemonHost,
        port: Number(defaultDaemonPort),
      },
    ],
    workspaces: [
      { id: workspaceId, name: "Tiller", path: "D:/myProject/tools/Tiller" },
    ],
    projects: [
      {
        id: projectId,
        name: "Tiller",
        helmId,
        workspaceIds: [workspaceId],
        defaultWorkspaceId: workspaceId,
        defaultAgentId: agentId,
      },
    ],
    agents: [
      {
        id: agentId,
        name: "Codex",
        command: "codex-acp",
        args: ["-c", "model=gpt-5.5"],
        transport: "stdio",
        protocol: "acp",
      },
    ],
    sessions: [session],
    statuses: { [sessionId]: "running" },
    activeSessionId: sessionId,
    selectedProjectId: projectId,
    selectedWorkspaceId: workspaceId,
    selectedAgentId: agentId,
    messages: {
      [sessionId]: [
        {
          id: "visual-user-1",
          role: "user",
          text: `# ??????

?? Zed ? Agent Panel ???? ????`,
          timestamp: now,
        },
        {
          id: "visual-assistant-1",
          role: "assistant",
          text: `## ??/??

?? ?????? Zed-like ?????

- ????? / ?? rail
- ????????
- ???sticky composer
- ?????? inspector`,
          timestamp: now,
        },
      ],
    },
    outputs: {
      [sessionId]: [
        {
          id: "visual-output-1",
          commandId: "visual-command-1",
          text: `pnpm --filter @tiller/deck build
? built in 2.0s`,
          stream: "stdout",
          timestamp: now,
        },
      ],
    },
    toolCalls: {
      [sessionId]: [
        {
          id: "visual-tool-1",
          kind: "terminal",
          title: "pnpm --filter @tiller/deck build",
          status: "completed",
          commandId: "visual-command-1",
          output: "✓ built in 2.0s",
          stream: "stdout",
          timestamp: now,
          updatedAt: now,
        },
      ],
    },
    diffs: {
      [sessionId]: [
        {
          path: "apps/deck/src/App.tsx",
          status: "modified",
          additions: 44,
          deletions: 18,
        },
        {
          path: "apps/deck/src/styles.css",
          status: "modified",
          additions: 134,
          deletions: 0,
        },
      ],
    },
  };
}
