import type {
  AcpAgentProvider,
  AgentMessage,
  AgentPromptImageContent,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
  ProjectSummary,
  SessionPromptQueueSnapshot,
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
  promptQueues: Record<string, SessionPromptQueueSnapshot>;
  diffs: Record<string, FileDiffSummary[]>;
  permissionRequests: Record<string, PermissionRequest>;
  approvalItemsById: Record<string, {
    sessionId: string;
    request: PermissionRequest;
    createdAt: string;
    resolving: boolean;
  }>;
  pendingApprovalIdsBySession: Record<string, string[]>;
  activeSessionId: string;
  openChatSessionIds: string[];
  focusedChatWindowId: string | null;
  selectedProjectId: string;
  selectedCwd: string;
  selectedAgentId: string;
};

const VISUAL_PROMPT_IMAGE_DATA =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIiB2aWV3Qm94PSIwIDAgMzIwIDE4MCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIxODAiIHJ4PSIyMCIgZmlsbD0iIzFmMjkzNyIvPjxjaXJjbGUgY3g9IjY0IiBjeT0iNTgiIHI9IjIyIiBmaWxsPSIjOTNjNWZkIiBvcGFjaXR5PSIwLjg1Ii8+PHRleHQgeD0iMzIiIHk9IjEzMiIgZmlsbD0iIzkzYzVmZCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjM0IiBmb250LXdlaWdodD0iNzAwIj5JTUcgQTwvdGV4dD48L3N2Zz4=";
const VISUAL_PROMPT_IMAGES: AgentPromptImageContent[] = [
  "visual-a.svg",
  "visual-b.svg",
  "visual-c.svg",
  "visual-d.svg",
].map((name) => ({
  type: "image",
  mimeType: "image/svg+xml",
  data: VISUAL_PROMPT_IMAGE_DATA,
  name,
}));

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

function shouldUseVisualStatusDemo(search: string) {
  return new URLSearchParams(search).get("visualStatusDemo") === "1";
}

function shouldUseVisualRestoreDemo(search: string) {
  return new URLSearchParams(search).get("visualRestore") === "1";
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
  const errorSessionId = "visual-session-error";
  const idleSessionId = "visual-session-idle";
  const visualSessionCount = resolveMissionVisualSessionCount(visualSearch);
  const visualStatusDemo = shouldUseVisualStatusDemo(visualSearch);
  const visualRestoreDemo = shouldUseVisualRestoreDemo(visualSearch);
  const activeVisualSessionId =
    visualRestoreDemo && visualSessionCount >= 2 ? secondarySessionId : sessionId;
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
  const errorSession: SessionSummary = {
    ...session,
    id: errorSessionId,
    agentName: "ClaudeCode",
    agentId: "visual-claude",
    status: "error",
    runtimeSessionId: "visual-acp-session-error",
    lastMessagePreview: "模拟错误状态用于 Dashboard 状态点验证。",
  };
  const idleSession: SessionSummary = {
    ...session,
    id: idleSessionId,
    agentName: "Codex",
    agentId: "visual-codex-idle",
    status: "idle",
    runtimeSessionId: "visual-acp-session-idle",
    lastMessagePreview: "模拟未选中空闲会话。",
  };
  const sessions = visualStatusDemo
    ? [{ ...session, status: "idle" as const }, secondarySession, errorSession, idleSession]
    : visualSessionCount >= 2 ? [session, secondarySession] : [session];
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
  const promptQueues: Record<string, SessionPromptQueueSnapshot> = {
    [sessionId]: {
      sessionId,
      inFlight: {
        id: "visual-prompt-0",
        sessionId,
        text: "当前正在执行的 Prompt。",
        clientMessageId: "visual-client-0",
        createdAt: now,
        updatedAt: now,
        status: "sending",
      },
      queued: [
        {
          id: "visual-prompt-1",
          sessionId,
          text: "复核 Prompt 队列是否显示在小窗口内部。",
          clientMessageId: "visual-client-1",
          createdAt: now,
          updatedAt: now,
          status: "queued",
        },
        {
          id: "visual-prompt-2",
          sessionId,
          text: "确认队列与 Plan 通过小窗口选项二选一展示。",
          clientMessageId: "visual-client-2",
          createdAt: now,
          updatedAt: now,
          status: "queued",
        },
      ],
    },
  };
  if (visualRestoreDemo && visualSessionCount >= 2) {
    promptQueues[secondarySessionId] = {
      sessionId: secondarySessionId,
      queued: [
        {
          id: "visual-secondary-prompt-1",
          sessionId: secondarySessionId,
          text: "恢复窗口中复核 Prompt 队列与 Plan 同时出现。",
          clientMessageId: "visual-secondary-client-1",
          createdAt: now,
          updatedAt: now,
          status: "queued",
        },
        {
          id: "visual-secondary-prompt-2",
          sessionId: secondarySessionId,
          text: "切换到 Plan 后确认浮层仍不参与布局。",
          clientMessageId: "visual-secondary-client-2",
          createdAt: now,
          updatedAt: now,
          status: "queued",
        },
      ],
    };
  }
  const permissionRequest: PermissionRequest = {
    id: "visual-permission-1",
    command: `Approve MCP tool call :: ${JSON.stringify({ server_name: "mcp_router", request: { name: "search_context" } })}`,
    reason: "需要读取代码上下文以完成 UI 复核。",
    cwd: "D:/myProject/tools/Tiller",
    options: [
      { decision: "allow", label: "同意" },
      { decision: "deny", label: "取消" },
    ],
  };
  const permissionRequests: PermissionRequest[] = [
    permissionRequest,
    {
      id: "visual-permission-2",
      command: "shell_command: pnpm --filter @tiller/deck test -- src/features/dashboard/ui/page.test.tsx",
      reason: "需要运行 Dashboard 页面测试确认活动流改动。",
      cwd,
      options: [
        { decision: "allow_session", label: "本会话允许" },
        { decision: "deny", label: "取消" },
      ],
    },
    {
      id: "visual-permission-3",
      command: "file.write apps/deck/src/features/dashboard/ui/activity-stream.tsx",
      reason: "需要写入 Dashboard 活动流组件。",
      cwd,
      options: [
        { decision: "allow", label: "同意" },
        { decision: "deny", label: "取消" },
      ],
    },
  ];

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
    statuses: visualStatusDemo
      ? {
        [sessionId]: "idle",
        [secondarySessionId]: "running",
        [errorSessionId]: "error",
        [idleSessionId]: "idle",
      }
      : Object.fromEntries(sessions.map((item) => [item.id, "running" as const])),
    activeSessionId: activeVisualSessionId,
    openChatSessionIds: visualStatusDemo
      ? [sessionId, secondarySessionId, errorSessionId]
      : sessions.map((item) => item.id),
    focusedChatWindowId: `session:${activeVisualSessionId}`,
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
- 只有源 Markdown 表格渲染为表格

\`\`\`mermaid
flowchart LR
  A[附件] --> B[预览]
\`\`\``,
          timestamp: now,
        },
        {
          id: "visual-user-2",
          role: "user",
          text: "继续执行 diff 渲染与权限审核复核。",
          attachments: VISUAL_PROMPT_IMAGES.map((image) => ({ ...image })),
          timestamp: now,
        },
        {
          id: "visual-assistant-2",
          role: "assistant",
          text: `为了复核浮层与滚动行为，这里追加一段较长的视觉夹具内容。

- 第一段：确认权限审核卡片仍然位于会话中部，不影响底部 dock。
- 第二段：确认 Markdown 内容向上滚动后，底部的 Prompt 队列浮层不会遮住最后一行。
- 第三段：当用户向上滚动离开底部时，回到底部按钮应该显示在 dock 上方。

这段内容只用于 \`visual=mission\` 开发夹具，真实会话不会受到影响。`,
          timestamp: now,
        },
        {
          id: "visual-user-3",
          role: "user",
          text: "继续追加几行内容，方便测试滚动到底部后的安全距离。",
          timestamp: now,
        },
        {
          id: "visual-assistant-3",
          role: "assistant",
          text: `底部安全距离检查：

1. 最后一段文本应能滚到 Prompt 队列或 Plan 浮层上方。
2. 浮层继续保持 absolute overlay，不参与小窗口布局。
3. 收起和展开都使用固定预留，不按展开高度重新计算。
4. 回到底部按钮应避开底部浮层。`,
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
    promptQueues,
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
    permissionRequests: Object.fromEntries(
      permissionRequests.map((request) => [request.id, request]),
    ),
    approvalItemsById: Object.fromEntries(
      permissionRequests.map((request) => [request.id, {
        sessionId,
        request,
        createdAt: now,
        resolving: false,
      }]),
    ),
    pendingApprovalIdsBySession: {
      [sessionId]: permissionRequests.map((request) => request.id),
    },
  };
}
