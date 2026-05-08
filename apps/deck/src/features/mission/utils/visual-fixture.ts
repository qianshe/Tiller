import type {
  AcpAgentProvider,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
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
  permissionRequests: Record<string, PermissionRequest>;
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
          text: `请复核 Mission Review UI：Markdown、权限审核与 Diff 详情。`,
          timestamp: now,
        },
        {
          id: "visual-assistant-1",
          role: "assistant",
          text: `[⚔️金] 验证

**验证**：这是普通 Markdown 段落，不再转换成结构化卡片。

| 项目 | 内容 |
| --- | --- |
| 产物 | apps/deck/src/features/mission/ui/plain-messages.tsx |
| 根因 | 结构化渲染抢占了源 Markdown |

- 普通列表保持列表
- 只有源 Markdown 表格渲染为表格`,
          timestamp: now,
        },
        {
          id: "visual-user-2",
          role: "user",
          text: "继续执行 diff 渲染与权限审核复核。",
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
          kind: "tool",
          title: "mcp_router/search_context",
          status: "waiting_for_permission",
          commandId: "visual-command-1",
          output: "",
          stream: "stdout",
          timestamp: now,
          updatedAt: now,
        },
      ],
    },
    diffs: {
      [sessionId]: [
        {
          path: "apps/deck/src/features/mission/hooks/slash-commands.ts",
          status: "modified",
          additions: 3,
          deletions: 0,
          patch: [
            "diff --git a/apps/deck/src/features/mission/hooks/slash-commands.ts b/apps/deck/src/features/mission/hooks/slash-commands.ts",
            "index 111..222 100644",
            "@@ -1,2 +1,3 @@",
            " const keep = true;",
            "-const oldValue = 1;",
            "+const newValue = 2;",
          ].join("\n"),
        },
        {
          path: "apps/deck/src/features/mission/ui/slash-command-popup.tsx",
          status: "modified",
          additions: 12,
          deletions: 4,
          patch: [
            "diff --git a/apps/deck/src/features/mission/ui/slash-command-popup.tsx b/apps/deck/src/features/mission/ui/slash-command-popup.tsx",
            "@@ -8,2 +8,2 @@",
            "-const tone = 'raw';",
            "+const tone = 'polished';",
          ].join("\n"),
        },
        {
          path: "apps/helm/src/runtime/events.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: [
            "diff --git a/apps/helm/src/runtime/events.ts b/apps/helm/src/runtime/events.ts",
            "@@ -1 +1 @@",
            "-export const stale = true;",
            "+export const stale = false;",
          ].join("\n"),
        },
      ],
    },
    permissionRequests: {
      [sessionId]: {
        id: "visual-permission-1",
        command: `Approve MCP tool call :: ${JSON.stringify({ server_name: "mcp_router", request: { name: "search_context" } })}`,
        reason: "需要读取代码上下文以完成 UI 复核。",
        workspacePath: "D:/myProject/tools/Tiller",
        options: [
          { decision: "allow", label: "同意" },
          { decision: "deny", label: "取消" },
        ],
      },
    },
  };
}
