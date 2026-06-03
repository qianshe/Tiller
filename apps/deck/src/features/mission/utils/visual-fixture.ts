import type {
  AcpAgentProvider,
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";

type MissionVisualFixture = {
  helms: HelmSummary[];
  worktrees: WorktreeSummary[];
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  statuses: Record<string, SessionStatus>;
  messages: Record<string, AgentMessage[]>;
  outputs: Record<string, CommandChunk[]>;
  toolCalls: Record<string, AgentToolCall[]>;
  sessionPlans: Record<string, AgentPlan>;
  diffs: Record<string, FileDiffSummary[]>;
  permissionRequests: Record<string, PermissionRequest>;
  activeSessionId: string;
  openChatSessionIds: string[];
  focusedChatWindowId: string | null;
  selectedProjectId: string;
  selectedCwd: string;
  selectedAgentId: string;
};

export function shouldUseMissionVisualFixture() {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("visual") === "mission"
  );
}

export function resolveMissionVisualSessionCount(search: string) {
  const rawValue = new URLSearchParams(search).get("visualWindows");
  const count = Number(rawValue);
  return Number.isFinite(count) && count >= 2 ? 2 : 1;
}

export function createMissionVisualFixture({
  defaultDaemonHost,
  defaultDaemonPort,
  visualSearch = typeof window === "undefined" ? "" : window.location.search,
}: {
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  visualSearch?: string;
}): MissionVisualFixture {
  const now = new Date().toISOString();
  const helmId = "visual-helm";
  const projectId = "visual-project";
  const cwd = "D:/myProject/tools/Tiller";
  const agentId = "visual-codex";
  const sessionId = "visual-session";
  const secondarySessionId = "visual-session-secondary";
  const visualSessionCount = resolveMissionVisualSessionCount(visualSearch);
  const session: SessionSummary = {
    id: sessionId,
    projectId,
    projectName: "Tiller",
    helmId,
    cwd,
    worktreeName: "Tiller",
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
  const secondarySession: SessionSummary = {
    ...session,
    id: secondarySessionId,
    agentName: "OpenCode",
    agentId: "visual-opencode",
    worktreeName: "Tiller / secondary",
    runtimeSessionId: "visual-acp-session-secondary",
    lastMessagePreview: "验证多窗口 plan 浮层绑定。",
  };
  const sessions = visualSessionCount >= 2 ? [session, secondarySession] : [session];
  const sessionPlans: Record<string, AgentPlan> = {
    [sessionId]: {
      entries: [
        {
          content: "复核 Markdown 渲染",
          priority: "medium",
          status: "completed",
        },
        {
          content: "检查权限审核抽屉",
          priority: "medium",
          status: "in_progress",
        },
        {
          content: "确认 Diff 详情状态",
          priority: "low",
          status: "pending",
        },
      ],
      updatedAt: now,
    },
  };
  if (visualSessionCount >= 2) {
    sessionPlans[secondarySessionId] = {
      entries: [
        {
          content: "复核第二窗口 plan 绑定",
          priority: "medium",
          status: "completed",
        },
        {
          content: "确认第二窗口向上展开",
          priority: "high",
          status: "in_progress",
        },
      ],
      updatedAt: now,
    };
  }

  return {
    helms: [
      {
        id: helmId,
        name: "Local Helm",
        host: defaultDaemonHost,
        port: Number(defaultDaemonPort),
      },
    ],
    worktrees: [{ name: "Tiller", path: cwd }],
    projects: [
      {
        id: projectId,
        name: "Tiller",
        helmId,
        path: cwd,
        worktrees: [{ name: "Tiller", path: cwd }],
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
    sessions,
    statuses: Object.fromEntries(sessions.map((item) => [item.id, "running" as const])),
    activeSessionId: sessionId,
    openChatSessionIds: sessions.map((item) => item.id),
    focusedChatWindowId: `session:${sessionId}`,
    selectedProjectId: projectId,
    selectedCwd: cwd,
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
| 产物 | apps/deck/src/features/mission/conversation/plain-messages.tsx |
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
    sessionPlans,
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
          path: "apps/deck/src/features/mission/composer/slash-command-popup.tsx",
          status: "modified",
          additions: 12,
          deletions: 4,
          patch: [
            "diff --git a/apps/deck/src/features/mission/composer/slash-command-popup.tsx b/apps/deck/src/features/mission/composer/slash-command-popup.tsx",
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
        cwd: "D:/myProject/tools/Tiller",
        options: [
          { decision: "allow", label: "同意" },
          { decision: "deny", label: "取消" },
        ],
      },
    },
  };
}
