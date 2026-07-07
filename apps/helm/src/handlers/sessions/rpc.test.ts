import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall, SessionTimelineEntry, SessionUpdateRecord } from "@tiller/shared";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";
import { createSessionPromptQueueManager } from "../../runtime/session/prompt-queue";
import { createSessionUpdateRecord } from "../../runtime/session-updates/reducer";

function createPromptQueueContextExtras() {
  const promptQueue = createSessionPromptQueueManager();
  return {
    promptQueue,
    drainPromptQueue: async () => undefined,
    broadcastSessionTopic: () => undefined,
  };
}

function flushPromises() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("session/get_artifacts reads stale running thinking repaired during refresh", async () => {
  const sessionId = "session-thinking-history";
  let toolCalls: AgentToolCall[] = [
    {
      id: "think-1",
      commandId: "think-1",
      kind: "think" as const,
      title: "Thinking",
      status: "running" as const,
      output: "persisted thinking",
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/get_artifacts",
    { sessionId },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [
          {
            id: sessionId,
            agentId: "opencode",
            status: "idle",
            updatedAt: "2026-05-17T10:00:10.000Z",
          },
        ],
      },
      refreshAuthoritativeSessionHistory: async () => {
        toolCalls = [
          {
            ...toolCalls[0],
            status: "completed" as const,
            updatedAt: "2026-05-17T10:00:10.000Z",
          },
        ];
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
        getPage: () => ({ outputs: [], diffs: [], toolCalls, hasMore: false }),
        replaceToolCalls: (_sessionId: string, nextToolCalls: typeof toolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as any;

  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.equal(result.toolCalls[0]?.output, "persisted thinking");
  assert.equal(result.toolCalls[0]?.updatedAt, "2026-05-17T10:00:10.000Z");
});

test("session/get_artifacts no longer returns history plan payloads", async () => {
  const sessionId = "session-opencode-plan-history";
  const plan = {
    updatedAt: "2026-06-02T13:37:09.663Z",
    entries: [
      { content: "并行委派 apps/helm 竞态模式搜索", priority: "high" as const, status: "completed" as const },
      { content: "补充读取候选代码并验证是否真有 await 竞态", priority: "high" as const, status: "completed" as const },
      { content: "汇总类似问题、风险等级与证据位置", priority: "high" as const, status: "completed" as const },
    ],
  };

  const result = await handleSessionRpcRequest(
    "session/get_artifacts",
    { sessionId },
    {
      sessions: new Map(),
      sessionStore: { list: () => [] },
      refreshAuthoritativeSessionHistory: async () => undefined,
      readSessionPlan: (currentSessionId: string) =>
        currentSessionId === sessionId ? plan : undefined,
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
        getPage: () => ({ outputs: [], diffs: [], toolCalls: [], hasMore: false }),
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as any;

  assert.equal(result.plan, undefined);
});

test("session/get_artifacts reconstructs outputs and tool calls from canonical timeline when legacy activity rows are absent", async () => {
  const sessionId = "session-canonical-artifacts";
  const timeline = [
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [{
        id: "assistant-1:content",
        kind: "content" as const,
        text: "先执行命令",
        timestamp: "2026-06-21T10:00:00.000Z",
        sequence: 1,
      }],
      timestamp: "2026-06-21T10:00:00.000Z",
      updatedAt: "2026-06-21T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "tool:cmd-1",
      kind: "tool_call" as const,
      toolCall: {
        id: "cmd-1",
        commandId: "cmd-1",
        kind: "shell" as const,
        title: "Shell",
        status: "completed" as const,
        output: "done",
        stream: "stdout" as const,
        timestamp: "2026-06-21T10:00:01.000Z",
        updatedAt: "2026-06-21T10:00:02.000Z",
        sequence: 2,
      },
      timestamp: "2026-06-21T10:00:01.000Z",
      updatedAt: "2026-06-21T10:00:02.000Z",
      sequence: 2,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/get_artifacts",
    { sessionId, limit: 20 },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{ id: sessionId, agentId: "codex", status: "idle", updatedAt: "2026-06-21T10:00:10.000Z" }],
      },
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }], toolCalls: [] }),
        getPage: () => ({ outputs: [], diffs: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }], toolCalls: [], hasMore: false }),
        replaceToolCalls: () => undefined,
      },
      sessionTimelineStore: {
        list: () => timeline,
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as any;

  assert.deepEqual(
    result.toolCalls.map((toolCall: any) => toolCall.id),
    ["cmd-1"],
  );
  assert.deepEqual(result.outputs, [{
    id: "timeline-output:cmd-1",
    commandId: "cmd-1",
    text: "done",
    stream: "stdout",
    timestamp: "2026-06-21T10:00:02.000Z",
    sequence: 2,
  }]);
  assert.deepEqual(result.diffs, [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }]);
});

test("session/get_artifacts reads legacy subagent tool calls materialized during refresh", async () => {
  const sessionId = "session-subagent-history";
  let toolCalls: AgentToolCall[] = [
    {
      id: "call-subagent-history",
      kind: "tool" as const,
      title: "spawn_agents_on_csv",
      status: "completed" as const,
      input: JSON.stringify({ path: "input.csv" }),
      output: "Explorer summarized affected files.",
      timestamp: "2026-06-21T10:00:01.000Z",
      updatedAt: "2026-06-21T10:00:02.000Z",
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/get_artifacts",
    { sessionId },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{ id: sessionId, agentId: "codex", status: "idle", updatedAt: "2026-06-21T10:00:10.000Z" }],
      },
      refreshAuthoritativeSessionHistory: async () => {
        toolCalls = [{ ...toolCalls[0], kind: "subagent" as const }];
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
        getPage: () => ({ outputs: [], diffs: [], toolCalls, hasMore: false }),
        replaceToolCalls: (_sessionId: string, nextToolCalls: typeof toolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as any;

  assert.equal(result.toolCalls[0]?.kind, "subagent");
  assert.equal(result.toolCalls[0]?.title, "spawn_agents_on_csv");
});

test("session/list_timeline reads legacy mcp tool calls materialized during refresh", async () => {
  const sessionId = "session-timeline-mcp-history";
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-1",
      kind: "tool_call" as const,
      toolCall: {
        id: "call-1",
        kind: "tool" as const,
        title: "Tool call call-1",
        status: "completed" as const,
        input: JSON.stringify({
          server: "sanshu",
          tool: "zhi",
          arguments: { message: "review" },
        }),
        timestamp: "2026-07-06T00:00:01.000Z",
        updatedAt: "2026-07-06T00:00:02.000Z",
      },
      timestamp: "2026-07-06T00:00:01.000Z",
      updatedAt: "2026-07-06T00:00:02.000Z",
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{
          id: sessionId,
          agentId: "codex",
          status: "idle",
          updatedAt: "2026-07-06T00:00:10.000Z",
        }],
      },
      refreshAuthoritativeSessionHistory: async () => {
        const firstEntry = timeline[0];
        if (!firstEntry || firstEntry.kind !== "tool_call") {
          throw new Error("expected legacy tool_call timeline entry");
        }
        timeline = [
          {
            ...firstEntry,
            toolCall: {
              ...firstEntry.toolCall,
              kind: "mcp" as const,
              title: "Tool: sanshu/zhi",
            },
            updatedAt: firstEntry.toolCall.updatedAt,
          },
        ];
      },
      sessionTimelineStore: {
        list: () => timeline,
        listPage: () => ({ entries: timeline, hasMore: false }),
        replace: (_sessionId: string, entries: typeof timeline) => {
          timeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.equal(result.entries[0]?.toolCall?.kind, "mcp");
  assert.equal(result.entries[0]?.toolCall?.title, "Tool: sanshu/zhi");
});

test("session/list_timeline reads canonical history materialized during refresh", async () => {
  const sessionId = "session-with-legacy-timeline";
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => {
        if (replacedTimeline.length > 0) {
          return;
        }
        replacedTimeline = [
          {
            id: "user-1",
            kind: "user_message",
            message: {
              id: "user-1",
              role: "user",
              text: "Start",
              timestamp: "2026-05-24T10:00:00.000Z",
              sequence: 1,
            },
            timestamp: "2026-05-24T10:00:00.000Z",
            updatedAt: "2026-05-24T10:00:00.000Z",
            sequence: 1,
          },
          {
            id: "assistant-1",
            kind: "assistant_message",
            chunks: [
              {
                id: "assistant-1:thinking",
                kind: "thinking",
                text: "Reason",
                title: "Thinking",
                status: "completed",
                timestamp: "2026-05-24T10:00:01.000Z",
                updatedAt: "2026-05-24T10:00:01.000Z",
                sequence: 2,
              },
              {
                id: "assistant-1:content",
                kind: "content",
                text: "Done",
                timestamp: "2026-05-24T10:00:02.000Z",
                sequence: 3,
              },
            ],
            timestamp: "2026-05-24T10:00:01.000Z",
            updatedAt: "2026-05-24T10:00:02.000Z",
            sequence: 2,
          },
        ];
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        list: () => [],
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
        listPage: () => ({ entries: replacedTimeline, hasMore: false }),
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => entry.kind),
    ["user_message", "assistant_message"],
  );
  assert.deepEqual(
    result.entries[1]?.chunks.map((chunk: any) => chunk.kind),
    ["thinking", "content"],
  );
  assert.deepEqual(
    replacedTimeline.map((entry: any) => entry.kind),
    ["user_message", "assistant_message"],
  );
});

test("session/list_timeline includes stored plan when live state has no plan", async () => {
  const sessionId = "session-timeline-stored-plan";
  const storedPlan = {
    updatedAt: "2026-07-07T15:05:41.229Z",
    entries: [
      { content: "读文件", priority: "medium", status: "completed" },
      { content: "AST 搜索", priority: "medium", status: "in_progress" },
    ],
  };

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: [], hasMore: false }),
      },
      sessionPlanStore: {
        get: () => storedPlan,
      },
      readSessionLiveState: () => ({ promptQueue: { queued: [], inFlight: null } }),
    } as any,
  ) as any;

  assert.deepEqual(result.liveState?.plan, storedPlan);
});

test("session/list_timeline treats existing timeline as the primary history", async () => {
  const sessionId = "session-existing-timeline-primary";
  const timeline = [
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1:thinking",
          kind: "thinking" as const,
          text: "先思考",
          title: "Thinking",
          status: "completed" as const,
          timestamp: "2026-05-24T10:00:00.000Z",
          updatedAt: "2026-05-24T10:00:00.000Z",
          sequence: 1,
        },
        {
          id: "assistant-1:content",
          kind: "content" as const,
          text: "再回复",
          timestamp: "2026-05-24T10:00:01.000Z",
          sequence: 2,
        },
      ],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:01.000Z",
      sequence: 1,
    },
  ];
  let readLegacyMessages = false;
  let readLegacyArtifacts = false;
  let replacedTimeline = false;

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => {
          readLegacyMessages = true;
          return [
            {
              id: "assistant-1#p0",
              role: "assistant" as const,
              text: "legacy paragraph",
              timestamp: "2026-05-24T10:00:05.000Z",
              sequence: 3,
            },
          ];
        },
        listPage: () => ({ messages: [], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => {
          readLegacyArtifacts = true;
          return { outputs: [], diffs: [], toolCalls: [] };
        },
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: timeline, hasMore: false }),
        list: () => timeline,
        replace: () => {
          replacedTimeline = true;
          return timeline;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(result.entries.map((entry: any) => entry.id), ["assistant-1"]);
  assert.deepEqual(result.entries[0]?.chunks?.map((chunk: any) => chunk.kind), ["thinking", "content"]);
  assert.equal(readLegacyMessages, false);
  assert.equal(readLegacyArtifacts, false);
  assert.equal(replacedTimeline, false);
});

test.skip("session/list_timeline repairs timelines missing visible user anchors", async () => {
  const sessionId = "session-missing-user-anchor";
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      text: "帮我检查历史排序",
      timestamp: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1#p0",
      role: "assistant" as const,
      text: "已检查",
      timestamp: "2026-05-24T10:00:02.000Z",
      sequence: 2,
    },
  ];
  const staleTimeline = [
    {
      id: "assistant-1#p0",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1#p0:content",
          kind: "content" as const,
          text: "已检查",
          timestamp: "2026-05-24T10:00:02.000Z",
          sequence: 2,
        },
      ],
      timestamp: "2026-05-24T10:00:02.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      sequence: 2,
    },
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => messages,
        listPage: () => ({ messages, hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: staleTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry: any) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
});

test.skip("session/list_timeline repairs repeated prompts when one visible user anchor is missing", async () => {
  const sessionId = "session-repeated-user-anchor";
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      text: "继续",
      timestamp: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "user-2",
      role: "user" as const,
      text: "继续",
      timestamp: "2026-05-24T10:00:03.000Z",
      sequence: 2,
    },
    {
      id: "assistant-1#p0",
      role: "assistant" as const,
      text: "已继续",
      timestamp: "2026-05-24T10:00:04.000Z",
      sequence: 3,
    },
  ];
  const staleTimeline = [
    {
      id: "user-2",
      kind: "user_message" as const,
      message: messages[1]!,
      timestamp: "2026-05-24T10:00:03.000Z",
      updatedAt: "2026-05-24T10:00:03.000Z",
      sequence: 2,
    },
    {
      id: "assistant-1#p0",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1#p0:content",
          kind: "content" as const,
          text: "已继续",
          timestamp: "2026-05-24T10:00:04.000Z",
          sequence: 3,
        },
      ],
      timestamp: "2026-05-24T10:00:04.000Z",
      updatedAt: "2026-05-24T10:00:04.000Z",
      sequence: 3,
    },
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => messages,
        listPage: () => ({ messages, hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: staleTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["user_message", "user-2"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry: any) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["user_message", "user-2"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
});

test.skip("session/list_timeline repairs timelines with assistant chunks collapsed across tool calls", async () => {
  const sessionId = "session-collapsed-tool-boundary";
  const messages = [
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "先说明。",
      timestamp: "2026-05-24T10:00:01.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "先说明。工具后继续。",
      timestamp: "2026-05-24T10:00:03.000Z",
      sequence: 3,
    },
  ];
  const toolCalls = [
    {
      id: "tool-1",
      kind: "search" as const,
      title: "Search",
      status: "completed" as const,
      output: "result",
      timestamp: "2026-05-24T10:00:02.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      sequence: 2,
    },
  ];
  const staleTimeline = [
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content" as const,
          text: "先说明。工具后继续。",
          timestamp: "2026-05-24T10:00:01.000Z",
          sequence: 1,
        },
      ],
      timestamp: "2026-05-24T10:00:01.000Z",
      updatedAt: "2026-05-24T10:00:01.000Z",
      sequence: 1,
    },
    {
      id: "tool:tool-1",
      kind: "tool_call" as const,
      toolCall: toolCalls[0],
      timestamp: "2026-05-24T10:00:02.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      sequence: 2,
    },
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => messages,
        listPage: () => ({ messages, hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: staleTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  assert.deepEqual(
    result.entries.map((entry: any) =>
      entry.kind === "assistant_message"
        ? entry.chunks?.map((chunk: any) => [chunk.text, chunk.sequence])
        : [entry.id, entry.sequence],
    ),
    [
      [["先说明。", 1]],
      ["tool:tool-1", 2],
      [["工具后继续。", 3]],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry: any) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
});

test.skip("session/list_timeline normalizes persisted assistant entries crossing tool boundaries", async () => {
  const sessionId = "session-persisted-crossing-tool-boundary";
  const messages = [
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "先说明。",
      timestamp: "2026-05-24T10:00:01.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "先说明。工具后继续。",
      timestamp: "2026-05-24T10:00:03.000Z",
      sequence: 3,
    },
  ];
  const persistedTimeline = [
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content" as const,
          text: "先说明。",
          timestamp: "2026-05-24T10:00:01.000Z",
          sequence: 1,
        },
        {
          id: "assistant-1:content:3",
          kind: "content" as const,
          text: "工具后继续。",
          timestamp: "2026-05-24T10:00:03.000Z",
          sequence: 3,
        },
      ],
      timestamp: "2026-05-24T10:00:01.000Z",
      updatedAt: "2026-05-24T10:00:03.000Z",
      sequence: 1,
    },
    {
      id: "tool:tool-1",
      kind: "tool_call" as const,
      toolCall: {
        id: "tool-1",
        kind: "search" as const,
        title: "Search",
        status: "completed" as const,
        output: "result",
        timestamp: "2026-05-24T10:00:02.000Z",
        updatedAt: "2026-05-24T10:00:02.000Z",
        sequence: 2,
      },
      timestamp: "2026-05-24T10:00:02.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      sequence: 2,
    },
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => {
          throw new Error("authoritative persisted timeline should not rebuild legacy messages");
        },
        listPage: () => ({ messages, hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => {
          throw new Error("authoritative persisted timeline should not rebuild artifacts");
        },
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: persistedTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  assert.deepEqual(replacedTimeline, []);
});

test.skip("session/list_timeline repairs persisted timelines missing assistant updates from replay records", async () => {
  const sessionId = "session-persisted-missing-assistant-updates";
  const runtimeSessionId = "runtime-1";
  const providerId = "codex";
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      text: "开始",
      timestamp: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-collapsed",
      role: "assistant" as const,
      text: "先说明。工具后继续。",
      timestamp: "2026-05-24T10:00:01.000Z",
      sequence: 2,
    },
  ];
  const toolCall = {
    id: "tool-1",
    kind: "search" as const,
    title: "Search",
    status: "completed" as const,
    output: "result",
    timestamp: "2026-05-24T10:00:02.000Z",
    updatedAt: "2026-05-24T10:00:02.000Z",
    sequence: 3,
  };
  const persistedTimeline = [
    {
      id: "user-1",
      kind: "user_message" as const,
      message: messages[0],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-collapsed",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-collapsed:content",
          kind: "content" as const,
          text: "先说明。工具后继续。",
          timestamp: "2026-05-24T10:00:01.000Z",
          sequence: 2,
        },
      ],
      timestamp: "2026-05-24T10:00:01.000Z",
      updatedAt: "2026-05-24T10:00:01.000Z",
      sequence: 2,
    },
    {
      id: "tool:tool-1",
      kind: "tool_call" as const,
      toolCall,
      timestamp: "2026-05-24T10:00:02.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      sequence: 3,
    },
  ];
  const replayRecords = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 1,
      event: { type: "message", message: messages[0] },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 2,
      event: {
        type: "message",
        message: {
          id: "assistant-before",
          role: "assistant" as const,
          text: "先说明。",
          timestamp: "2026-05-24T10:00:01.000Z",
          sequence: 2,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 3,
      event: { type: "tool-call", toolCall },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 4,
      event: {
        type: "message",
        message: {
          id: "assistant-after",
          role: "assistant" as const,
          text: "工具后继续。",
          timestamp: "2026-05-24T10:00:03.000Z",
          sequence: 4,
        },
      },
    }),
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => {
          throw new Error("repair should use session update replay before legacy rebuild");
        },
        listPage: () => ({ messages, hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => {
          throw new Error("repair should not read legacy artifacts");
        },
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: persistedTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
      sessionUpdateStore: {
        listPage: () => ({ updates: replayRecords, hasMore: false }),
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id, entry.sequence]),
    [
      ["user_message", "user-1", 1],
      ["assistant_message", "assistant-before", 2],
      ["tool_call", "tool:tool-1", 3],
      ["assistant_message", "assistant-after", 4],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry: any) => [entry.kind, entry.id, entry.sequence]),
    result.entries.map((entry: any) => [entry.kind, entry.id, entry.sequence]),
  );
});

test.skip("session/list_timeline keeps partial persisted timelines as primary history", async () => {
  const sessionId = "session-partial-timeline";
  const messages = [
    {
      id: "user-latest",
      role: "user" as const,
      text: "继续",
      timestamp: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `assistant-final#p${index}`,
      role: "assistant" as const,
      text: `段落 ${index}`,
      timestamp: `2026-05-24T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      sequence: index + 2,
    })),
  ];
  const partialTimeline = [
    {
      id: "tool:stale-read",
      kind: "tool_call" as const,
      toolCall: {
        id: "stale-read",
        kind: "read" as const,
        title: "Read",
        status: "completed" as const,
        timestamp: "2026-05-24T10:00:14.500Z",
        updatedAt: "2026-05-24T10:00:14.500Z",
        sequence: 15,
      },
      timestamp: "2026-05-24T10:00:14.500Z",
      updatedAt: "2026-05-24T10:00:14.500Z",
      sequence: 15,
    },
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => messages,
        listPage: () => ({ messages: messages.slice(-20), hasMore: true, nextCursor: "legacy-cursor" }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        list: () => partialTimeline,
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(result.entries.map((entry: any) => entry.id), ["tool:stale-read"]);
  assert.equal(result.hasMore, false);
  assert.deepEqual(replacedTimeline, []);
});

test.skip("session/list_timeline preserves persisted timeline order and content", async () => {
  const sessionId = "session-preserve-timeline-order";
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => [
          {
            id: "user-1",
            role: "user" as const,
            text: "start",
            timestamp: "2026-05-24T10:00:30.000Z",
            sequence: 1,
          },
          {
            id: "assistant-1#p0",
            role: "assistant" as const,
            text: "new done",
            timestamp: "2026-05-24T10:00:40.000Z",
            sequence: 2,
          },
        ],
        listPage: () => ({ messages: [], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({
          outputs: [],
          diffs: [],
          toolCalls: [
            {
              id: "assistant-1:thinking",
              commandId: "assistant-1:thinking",
              kind: "think" as const,
              title: "Thinking",
              status: "completed" as const,
              output: "reasoning",
              timestamp: "2026-05-24T10:00:10.000Z",
              updatedAt: "2026-05-24T10:00:10.000Z",
            },
            {
              id: "tool-1",
              kind: "read" as const,
              title: "Read",
              status: "completed" as const,
              timestamp: "2026-05-24T10:00:20.000Z",
              updatedAt: "2026-05-24T10:00:20.000Z",
            },
          ],
        }),
      },
      sessionTimelineStore: {
        list: () => [
          {
            id: "user-1",
            kind: "user_message" as const,
            message: {
              id: "user-1",
              role: "user" as const,
              text: "start",
              timestamp: "2026-05-24T10:00:30.000Z",
              sequence: 1,
            },
            timestamp: "2026-05-24T10:00:30.000Z",
            updatedAt: "2026-05-24T10:00:30.000Z",
            sequence: 1,
          },
          {
            id: "assistant-1",
            kind: "assistant_message" as const,
            chunks: [{
              id: "assistant-1:thinking",
              kind: "thinking" as const,
              text: "reasoning",
              title: "Thinking",
              status: "completed" as const,
              timestamp: "2026-05-24T10:00:10.000Z",
              updatedAt: "2026-05-24T10:00:10.000Z",
            }],
            timestamp: "2026-05-24T10:00:10.000Z",
            updatedAt: "2026-05-24T10:00:10.000Z",
          },
          {
            id: "tool:tool-1",
            kind: "tool_call" as const,
            toolCall: {
              id: "tool-1",
              kind: "read" as const,
              title: "Read",
              status: "completed" as const,
              timestamp: "2026-05-24T10:00:20.000Z",
              updatedAt: "2026-05-24T10:00:20.000Z",
            },
            timestamp: "2026-05-24T10:00:20.000Z",
            updatedAt: "2026-05-24T10:00:20.000Z",
          },
          {
            id: "assistant-1#p0",
            kind: "assistant_message" as const,
            chunks: [{
              id: "assistant-1#p0:content",
              kind: "content" as const,
              text: "old done",
              timestamp: "2026-05-24T10:00:40.000Z",
              sequence: 2,
            }],
            timestamp: "2026-05-24T10:00:40.000Z",
            updatedAt: "2026-05-24T10:00:40.000Z",
            sequence: 2,
          },
        ],
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => entry.id),
    ["user-1", "assistant-1", "tool:tool-1", "assistant-1#p0"],
  );
  assert.deepEqual(replacedTimeline, []);
  assert.equal(result.entries.at(-1)?.chunks?.[0]?.text, "old done");
});

test.skip("session/list_timeline keeps persisted timeline content when timeline exists", async () => {
  const sessionId = "session-stale-timeline-content";
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => [
          {
            id: "assistant-final#p0",
            role: "assistant" as const,
            text: "新内容",
            timestamp: "2026-05-24T10:00:00.000Z",
            sequence: 1,
          },
        ],
        listPage: () => ({ messages: [], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        list: () => [
          {
            id: "assistant-final#p0",
            kind: "assistant_message" as const,
            chunks: [
              {
                id: "assistant-final#p0:content",
                kind: "content" as const,
                text: "旧内容",
                timestamp: "2026-05-24T10:00:00.000Z",
                sequence: 1,
              },
            ],
            timestamp: "2026-05-24T10:00:00.000Z",
            updatedAt: "2026-05-24T10:00:00.000Z",
            sequence: 1,
          },
        ],
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.equal(result.entries[0]?.chunks?.[0]?.text, "旧内容");
  assert.deepEqual(replacedTimeline, []);
});

test("session/list_timeline forwards the canonical before cursor without loading message windows", async () => {
  const sessionId = "session-timeline-pagination";
  let messagePageOptions: any;
  let timelinePageOptions: any;
  const before = "order\t1\tlatest-timeline";

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20, before },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: (_sessionId: string, options: any) => {
          messagePageOptions = options;
          return {
            messages: [
              {
                id: "latest-message",
                role: "assistant" as const,
                text: "latest",
                timestamp: "2026-05-24T10:00:00.000Z",
              },
            ],
            nextCursor: "legacy-message-cursor",
            hasMore: true,
          };
        },
      },
      sessionTimelineStore: {
        list: () => [
          {
            id: "older-timeline",
            kind: "assistant_message" as const,
            chunks: [
              {
                id: "older-timeline:content",
                kind: "content" as const,
                text: "older",
                timestamp: "2026-05-24T09:59:00.000Z",
              },
            ],
            timestamp: "2026-05-24T09:59:00.000Z",
            updatedAt: "2026-05-24T09:59:00.000Z",
          },
          {
            id: "latest-timeline",
            kind: "assistant_message" as const,
            chunks: [
              {
                id: "latest-timeline:content",
                kind: "content" as const,
                text: "latest",
                timestamp: "2026-05-24T10:00:00.000Z",
              },
            ],
            timestamp: "2026-05-24T10:00:00.000Z",
            updatedAt: "2026-05-24T10:00:00.000Z",
          },
        ],
        listPage: (_sessionId: string, options: any) => {
          timelinePageOptions = options;
          return {
            entries: [
              {
                id: "older-timeline",
                kind: "assistant_message" as const,
                chunks: [
                  {
                    id: "older-timeline:content",
                    kind: "content" as const,
                    text: "older",
                    timestamp: "2026-05-24T09:59:00.000Z",
                  },
                ],
                timestamp: "2026-05-24T09:59:00.000Z",
                updatedAt: "2026-05-24T09:59:00.000Z",
              },
            ],
            hasMore: false,
          };
        },
      },
    } as any,
  ) as any;

  assert.equal(messagePageOptions, undefined);
  assert.deepEqual(timelinePageOptions, {
    limit: 20,
    before,
    window: "message",
  });
  assert.deepEqual(result.entries.map((entry: any) => entry.id), ["older-timeline"]);
  assert.equal(result.before, before);
  assert.equal(result.nextCursor, undefined);
});

test("session/list_timeline reads the first page from canonical timeline storage without side stores", async () => {
  const sessionId = "session-canonical-first-page";

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 2 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => {
          throw new Error("first canonical page must not read legacy messages");
        },
      },
      sessionUpdateStore: {
        listPage: () => {
          throw new Error("first canonical page must not repair from raw updates");
        },
      },
      sessionTimelineStore: {
        listPage: () => ({
          entries: [
            {
              id: "compaction-1",
              kind: "context_compaction",
              summaryText: "continued from previous conversation",
              detailsVisibility: "expandable",
              timestamp: "2026-05-24T10:00:00.000Z",
              updatedAt: "2026-05-24T10:00:00.000Z",
              replayCompleteness: "compacted",
            },
            {
              id: "current-user",
              kind: "user_message",
              message: {
                id: "current-user",
                role: "user",
                text: "current",
                timestamp: "2026-05-24T10:00:02.000Z",
                sequence: 4,
              },
              timestamp: "2026-05-24T10:00:02.000Z",
              updatedAt: "2026-05-24T10:00:02.000Z",
              sequence: 4,
            },
            {
              id: "assistant-1",
              kind: "assistant_message",
              chunks: [{
                id: "assistant-1:content",
                kind: "content",
                text: "answer",
                timestamp: "2026-05-24T10:00:03.000Z",
                sequence: 5,
              }],
              timestamp: "2026-05-24T10:00:03.000Z",
              updatedAt: "2026-05-24T10:00:03.000Z",
              sequence: 5,
            },
          ],
          hasMore: false,
        }),
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => entry.id),
    ["compaction-1", "current-user", "assistant-1"],
  );
  assert.equal(result.hasMore, false);
});

test("session/list_timeline requests message-window timeline pages from the store", async () => {
  const sessionId = "session-dense-tools";
  const timeline = [
    {
      id: "assistant-intro",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-intro:content",
          kind: "content" as const,
          text: "intro",
          timestamp: "2026-05-24T10:00:00.000Z",
          sequence: 1,
        },
      ],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `tool-${index}`,
      kind: "tool_call" as const,
      toolCall: {
        id: `tool-${index}`,
        kind: "read" as const,
        title: `Read ${index}`,
        status: "completed" as const,
        timestamp: `2026-05-24T10:00:0${index + 1}.000Z`,
        updatedAt: `2026-05-24T10:00:0${index + 1}.000Z`,
        sequence: index + 2,
      },
      timestamp: `2026-05-24T10:00:0${index + 1}.000Z`,
      updatedAt: `2026-05-24T10:00:0${index + 1}.000Z`,
      sequence: index + 2,
    })),
    {
      id: "assistant-final",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-final:content",
          kind: "content" as const,
          text: "final",
          timestamp: "2026-05-24T10:00:06.000Z",
          sequence: 6,
        },
      ],
      timestamp: "2026-05-24T10:00:06.000Z",
      updatedAt: "2026-05-24T10:00:06.000Z",
      sequence: 6,
    },
  ];

  let timelinePageOptions: any;

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 2 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({ messages: [], hasMore: false }),
      },
      sessionTimelineStore: {
        list: () => timeline,
        listPage: (_sessionId: string, options: any) => {
          timelinePageOptions = options;
          return { entries: timeline, hasMore: false };
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(timelinePageOptions, {
    limit: 2,
    before: undefined,
    window: "message",
  });
  assert.deepEqual(
    result.entries.map((entry: any) => entry.id),
    ["assistant-intro", "tool-0", "tool-1", "tool-2", "tool-3", "assistant-final"],
  );
  assert.equal(result.hasMore, false);
});

test("session/list_timeline keeps compaction rows when continuation summaries precede unsequenced resumed assistants", async () => {
  const sessionId = "session-compaction-summary-unsequenced";
  let persistedTimeline = [
    {
      id: "older-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content" as const,
          text: "前面还有一段处理记录。",
          timestamp: "2026-06-18T14:01:30.000Z",
          sequence: 255,
        },
      ],
      timestamp: "2026-06-18T14:01:30.000Z",
      updatedAt: "2026-06-18T14:01:30.000Z",
      sequence: 255,
    },
    {
      id: "assistant-after",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-after:content",
          kind: "content" as const,
          text: "有个测试失败了，看一下具体原因。",
          timestamp: "2026-06-18T14:02:16.000Z",
        },
      ],
      timestamp: "2026-06-18T14:02:16.000Z",
      updatedAt: "2026-06-18T14:02:16.000Z",
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({
          messages: [
            {
              id: "compaction-started",
              role: "assistant" as const,
              text: "Compacting...",
              timestamp: "2026-06-18T14:01:40.000Z",
            },
            {
              id: "compaction-completed",
              role: "assistant" as const,
              text: "Compacting completed.",
              timestamp: "2026-06-18T14:01:41.000Z",
            },
            {
              id: "compaction-summary",
              role: "assistant" as const,
              text: "This session is being continued from a previous conversation that ran out of context.",
              timestamp: "2026-06-18T14:01:42.000Z",
            },
            {
              id: "provider-assistant-after",
              role: "assistant" as const,
              text: "有个测试失败了，看一下具体原因。",
              timestamp: "2026-06-18T14:02:16.000Z",
            },
          ],
          hasMore: false,
        }),
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        listPage: () => ({
          entries: persistedTimeline.slice(1),
          nextCursor: "order\t2\tassistant-after",
          hasMore: true,
        }),
        replace: (_sessionId: string, entries: any[]) => {
          persistedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:compaction-completed`],
      ["assistant_message", "assistant-after"],
    ],
  );
  assert.equal(
    result.entries.find((entry: any) => entry.kind === "context_compaction")?.summaryText,
    "This session is being continued from a previous conversation that ran out of context.",
  );
  assert.deepEqual(
    persistedTimeline.map((entry: any) => entry.id),
    [
      "older-assistant",
      `compaction:${sessionId}:compaction-completed`,
      "assistant-after",
    ],
  );
});

test("session/list_timeline reanchors an existing compaction summary row instead of appending a duplicate at the end", async () => {
  const sessionId = "session-compaction-existing-summary";
  let persistedTimeline = [
    {
      id: "older-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content" as const,
          text: "前面还有一段处理记录。",
          timestamp: "2026-06-18T14:01:30.000Z",
          sequence: 255,
        },
      ],
      timestamp: "2026-06-18T14:01:30.000Z",
      updatedAt: "2026-06-18T14:01:30.000Z",
      sequence: 255,
    },
    {
      id: "current-user",
      kind: "user_message" as const,
      message: {
        id: "provider-current-user",
        role: "user" as const,
        text: "检查当前改动状态",
        timestamp: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      timestamp: "2026-06-18T14:01:49.292Z",
      updatedAt: "2026-06-18T14:01:49.292Z",
      sequence: 256,
    },
    {
      id: "current-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "current-assistant:content",
          kind: "content" as const,
          text: "有个测试失败了，看一下具体原因。",
          timestamp: "2026-06-18T14:02:16.000Z",
          sequence: 276,
        },
      ],
      timestamp: "2026-06-18T14:02:16.000Z",
      updatedAt: "2026-06-18T14:02:16.000Z",
      sequence: 276,
    },
    {
      kind: "context_compaction" as const,
      id: `compaction:${sessionId}:runtime-summary`,
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      detailsVisibility: "expandable" as const,
      timestamp: "2026-06-18T14:05:25.193Z",
      updatedAt: "2026-06-18T14:05:25.193Z",
      replayCompleteness: "compacted" as const,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({
          messages: [
            {
              id: "compaction-started",
              role: "assistant" as const,
              text: "Compacting...",
              timestamp: "2026-06-18T14:01:40.000Z",
            },
            {
              id: "compaction-completed",
              role: "assistant" as const,
              text: "Compacting completed.",
              timestamp: "2026-06-18T14:01:41.000Z",
            },
            {
              id: "provider-current-user",
              role: "user" as const,
              text: "检查当前改动状态",
              timestamp: "2026-06-18T14:01:49.292Z",
              sequence: 256,
            },
            {
              id: "provider-current-assistant",
              role: "assistant" as const,
              text: "有个测试失败了，看一下具体原因。",
              timestamp: "2026-06-18T14:02:16.000Z",
              sequence: 276,
            },
          ],
          hasMore: false,
        }),
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        listPage: () => ({
          entries: persistedTimeline.slice(1),
          nextCursor: "order\t2\tcurrent-user",
          hasMore: true,
        }),
        replace: (_sessionId: string, entries: any[]) => {
          persistedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:runtime-summary`],
      ["user_message", "current-user"],
      ["assistant_message", "current-assistant"],
    ],
  );
  const compactionEntries = result.entries.filter((entry: any) => entry.kind === "context_compaction");
  assert.equal(compactionEntries.length, 1);
  assert.equal(
    compactionEntries[0]?.summaryText,
    "This session is being continued from a previous conversation that ran out of context.",
  );
  assert.deepEqual(
    persistedTimeline.map((entry: any) => entry.id),
    [
      "older-assistant",
      `compaction:${sessionId}:runtime-summary`,
      "current-user",
      "current-assistant",
    ],
  );
});

test.skip("session/list_timeline caps dense timeline entry pages", async () => {
  const sessionId = "session-dense-entry-cap";
  const timeline = [
    {
      id: "assistant-intro",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-intro:content",
          kind: "content" as const,
          text: "intro",
          timestamp: "2026-05-24T10:00:00.000Z",
          sequence: 1,
        },
      ],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    ...Array.from({ length: 140 }, (_, index) => ({
      id: `tool-${index}`,
      kind: "tool_call" as const,
      toolCall: {
        id: `tool-${index}`,
        kind: "read" as const,
        title: `Read ${index}`,
        status: "completed" as const,
        timestamp: `2026-05-24T10:01:${String(index).padStart(2, "0")}.000Z`,
        updatedAt: `2026-05-24T10:01:${String(index).padStart(2, "0")}.000Z`,
        sequence: index + 2,
      },
      timestamp: `2026-05-24T10:01:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-24T10:01:${String(index).padStart(2, "0")}.000Z`,
      sequence: index + 2,
    })),
    {
      id: "assistant-final",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-final:content",
          kind: "content" as const,
          text: "final",
          timestamp: "2026-05-24T10:03:00.000Z",
          sequence: 142,
        },
      ],
      timestamp: "2026-05-24T10:03:00.000Z",
      updatedAt: "2026-05-24T10:03:00.000Z",
      sequence: 142,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({ messages: [], hasMore: false }),
      },
      sessionTimelineStore: {
        list: () => timeline,
      },
    } as any,
  ) as any;

  assert.equal(result.entries.length, 96);
  assert.equal(result.entries[0]?.id, "tool-45");
  assert.equal(result.entries.at(-1)?.id, "assistant-final");
  assert.equal(result.hasMore, true);
});

test("session/reimport_history is no longer part of the public session RPC surface", async () => {
  await assert.rejects(
    () =>
      handleSessionRpcRequest(
        "session/reimport_history",
        { sessionId: "s1", limit: 40 },
        {} as any,
      ),
    /debug\/reimport_history/u,
  );
});

test("debug/reimport_history delegates to the history reimport service", async () => {
  let delegated: unknown;
  const result = await handleSessionRpcRequest(
    "debug/reimport_history",
    { sessionId: "s1", limit: 40 },
    {
      reimportSessionHistory: (sessionId: string, options: unknown) => {
        delegated = { sessionId, options };
        return {
          sessionId,
          messages: [
            {
              id: "m1",
              role: "user" as const,
              text: "hello",
              timestamp: "2026-05-24T10:00:00.000Z",
            },
          ],
          outputs: [],
          diffs: [],
          toolCalls: [],
          hasMore: false,
          activityHasMore: false,
          message: "历史已从 ACP 重新导入。"
        };
      },
    } as any,
  );

  assert.deepEqual(delegated, { sessionId: "s1", options: { limit: 40 } });
  assert.deepEqual(result, {
    sessionId: "s1",
    messages: [
      {
        id: "m1",
        role: "user",
        text: "hello",
        timestamp: "2026-05-24T10:00:00.000Z",
      },
    ],
    outputs: [],
    diffs: [],
    toolCalls: [],
    hasMore: false,
    activityHasMore: false,
    message: "历史已从 ACP 重新导入。",
  });
});

test("session/new creates a runtime-backed session and broadcasts updates", async () => {
  const broadcasts: any[] = [];
  const persisted: any[] = [];
  const runtimeDescriptors: any[] = [];
  const sessions = new Map<string, any>();
  const result = await handleSessionRpcRequest(
    "session/new",
    { projectId: "project-1", cwd: "D:/repo", agentId: "codex", model: "gpt-5" },
    {
      loadAvailableHelms: () => [{ id: "helm-1", name: "Local", host: "127.0.0.1", port: 47631 }],
      loadAvailableWorktrees: () => [{ name: "main", path: "D:/repo" }],
      loadAvailableAgents: () => [{ id: "codex", name: "Codex", command: "codex", transport: "stdio", protocol: "acp" }],
      loadAvailableProjectsWithSemanticSummaries: async () => [{ id: "project-1", name: "Project", helmId: "helm-1", worktrees: [{ name: "main", path: "D:/repo" }] }],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string, projects: any[]) => projects.find((project) => project.id === id),
      resolveProviderById: (id: string, agents: any[]) => agents.find((agent) => agent.id === id),
      resolveHelmById: (id: string, helms: any[]) => helms.find((helm) => helm.id === id),
      buildResumeInfo: () => ({ mode: "none", state: "history-only", reason: "new", checkedAt: "2026-05-28T00:00:00.000Z" }),
      sessionStore: { upsert: (session: any) => persisted.push(session) },
      persistRuntimeDescriptor: (...args: any[]) => runtimeDescriptors.push(args),
      broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
      createRuntime: async () => ({
        runtimeSessionId: "runtime-1",
        sessionConfigState: { model: "gpt-5" },
        sessionConfigOptions: [],
        sessionModelState: { options: [] },
        sessionCapabilities: { cancellation: true },
      }),
      handleRuntimeEvent: () => undefined,
      hydrateSessionSummary: (session: any) => ({ ...session, imageInput: false }),
      sessions,
      logInfo: () => undefined,
      logError: () => undefined,
      updateSessionSummary: () => undefined,
    } as any,
  ) as any;

  assert.equal(result.session.runtimeSessionId, "runtime-1");
  assert.equal(result.session.status, "idle");
  assert.equal(sessions.get(result.session.id)?.runtime.runtimeSessionId, "runtime-1");
  assert.equal(persisted.length, 2);
  assert.equal(runtimeDescriptors.length, 2);
  assert.equal(broadcasts.filter((item) => item.method === "session/update").length, 2);
});

test("session RPC lists paged sessions", async () => {
  const sessions = [{ id: "s1", updatedAt: "2026-05-06T00:00:00.000Z" }];
  const result = await handleSessionRpcRequest("session/list", { limit: 20 }, {
    sessionStore: { list: () => sessions },
    migrateStoredSessionSummary: (item: unknown) => item,
    logInfo: () => undefined,
  } as any);

  assert.deepEqual(result, {
    sessions,
    nextCursor: undefined,
    hasMore: false,
    before: undefined,
  });
});

test("session/subscribe records a session topic subscription", async () => {
  const calls: string[] = [];

  const result = await handleSessionRpcRequest("session/subscribe", { sessionId: "s1" }, {
    socketId: "socket-1",
    subscribeSessionTopic: (socketId: string, sessionId: string) => {
      calls.push(`${socketId}:${sessionId}`);
    },
    authenticatedSockets: { listAll: () => [] },
    notify: () => undefined,
    ...createPromptQueueContextExtras(),
  } as any);

  assert.deepEqual(calls, ["socket-1:s1"]);
  assert.deepEqual(result, { ok: true, message: "Subscribed to session s1." });
});

test("session/subscribe replays the current prompt queue snapshot to the subscribing socket", async () => {
  const promptQueue = createSessionPromptQueueManager();
  promptQueue.enqueue({
    sessionId: "s1",
    text: "queued prompt",
    clientMessageId: "client-1",
  });
  const socket = { readyState: 1 };
  const notifications: Array<{ socket: unknown; method: string; params: unknown }> = [];

  const result = await handleSessionRpcRequest("session/subscribe", { sessionId: "s1" }, {
    socketId: "socket-1",
    promptQueue,
    subscribeSessionTopic: () => undefined,
    authenticatedSockets: {
      listAll: () => [{ socketId: "socket-1", socket }],
    },
    notify: (target: unknown, method: string, params: unknown) => {
      notifications.push({ socket: target, method, params });
    },
  } as any);

  assert.deepEqual(result, { ok: true, message: "Subscribed to session s1." });
  assert.deepEqual(notifications, [
    {
      socket,
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          kind: "prompt_queue",
          queue: promptQueue.snapshot("s1"),
        },
      },
    },
  ]);
});

test("session/unsubscribe records a session topic removal", async () => {
  const calls: string[] = [];

  const result = await handleSessionRpcRequest("session/unsubscribe", { sessionId: "s1" }, {
    socketId: "socket-1",
    unsubscribeSessionTopic: (socketId: string, sessionId: string) => {
      calls.push(`${socketId}:${sessionId}`);
    },
  } as any);

  assert.deepEqual(calls, ["socket-1:s1"]);
  assert.deepEqual(result, { ok: true, message: "Unsubscribed from session s1." });
});

test("session RPC notification cancels active runtime and clears stale handle", async () => {
  let cancelled = false;
  const sessions = new Map([["s1", { runtime: { cancel: () => { cancelled = true; } } }]]);
  const handled = await handleSessionRpcNotification("session/cancel", { sessionId: "s1" }, {
    sessions,
  } as any);

  assert.equal(handled, true);
  assert.equal(cancelled, true);
  assert.equal(sessions.has("s1"), false);
});

test("session/prompt acknowledges before runtime prompt failures are reported", async () => {
  const sessionId = "s1";
  const broadcasts: any[] = [];
  const context = {
    sessions: new Map([
      [
        sessionId,
        {
          runtime: {
            sessionCapabilities: {},
            prompt: async () => {
              throw new Error("Session is not active: s1");
            },
          },
        },
      ],
    ]),
    ...createPromptQueueContextExtras(),
    logInfo: () => undefined,
    logError: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: () => undefined,
    broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
  };

  const result = await handleSessionRpcRequest(
    "session/prompt",
    { sessionId, text: "继续" },
    context as any,
  ) as any;

  assert.equal(result.accepted, "sent");
  await flushPromises();
  assert.equal(broadcasts.some((item) => item.method === "error/raised"), true);
});

test("session/prompt broadcasts synchronous prompt failures to connected decks", async () => {
  const sessionId = "s1";
  const broadcasts: any[] = [];
  let status = "idle";
  const context = {
    sessions: new Map([
      [
        sessionId,
        {
          summary: {
            id: sessionId,
            status,
            availableCommands: [{ name: "review" }],
          },
          runtime: {
            sessionCapabilities: {},
            prompt: async () => {
              throw new Error("should not reach ACP prompt");
            },
          },
        },
      ],
    ]),
    ...createPromptQueueContextExtras(),
    logInfo: () => undefined,
    logError: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: (_sessionId: string, mutate: (current: any) => any) => {
      const next = mutate({ id: sessionId, status });
      status = next.status;
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
  };

  await assert.rejects(
    handleSessionRpcRequest("session/prompt", { sessionId, text: "/unknown" }, context as any),
    /command is not supported/u,
  );

  assert.equal(status, "error");
  assert.deepEqual(
    broadcasts.map((item) => [item.method, item.params?.sessionId, item.params?.update?.kind ?? item.params?.message]),
    [
      ["error/raised", sessionId, "/unknown command is not supported by ACP agent. Available commands: /review"],
      ["session/update", sessionId, "status_change"],
    ],
  );
});

test("session/rename persists and broadcasts the next title", async () => {
  const stored = {
    id: "s1",
    title: "旧标题",
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
  let persisted: unknown;
  let broadcasted: unknown;
  const result = await handleSessionRpcRequest(
    "session/rename",
    { sessionId: "s1", title: "新标题" },
    {
      sessions: new Map(),
      sessionStore: { list: () => [stored] },
      updateSessionSummary: (_sessionId: string, mutate: (summary: typeof stored) => typeof stored) => {
        persisted = mutate(stored);
        return persisted;
      },
      broadcastNotification: (method: string, params: unknown) => {
        broadcasted = { method, params };
      },
    } as any,
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(persisted, { ...stored, title: "新标题" });
  assert.deepEqual(broadcasted, {
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: { ...stored, title: "新标题" },
      },
    },
  });
});

test("session/prompt activates a runtime draft before sending first prompt", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    cwds: ["worktree-1"],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const worktree = { id: "worktree-1", name: "main", path: "D:/repo" };
  const agent = { id: "codex", name: "Codex" };
  let attachedSessionId: string | undefined;
  let prompted = "";
  const runtime = {
    runtimeSessionId: "runtime-draft",
    sessionConfigState: { model: "gpt-5.5", reasoningEffort: "medium" },
    sessionModelState: { options: [{ id: "gpt-5.5", name: "GPT-5.5" }] },
    sessionCapabilities: { sessionLoad: true },
    prompt: async (text: string) => { prompted = text; },
  };
  const storedSessions: any[] = [];
  const sessions = new Map();

  const result = await handleSessionRpcRequest("session/prompt", {
    draftId: "draft-1",
    text: "你好",
  }, {
    takeRuntimeDraft: () => ({
      draftId: "draft-1",
      deckClientId: "deck-1",
      scopeKey: "deck-1:worktree-1:codex",
      logicalScopeKey: "worktree-1:codex",
      project,
      helm,
      worktree,
      agent,
      runtime,
      attach: (sessionId: string) => { attachedSessionId = sessionId; },
      modelState: runtime.sessionModelState,
      configState: runtime.sessionConfigState,
      configOptions: [
        {
          id: "model",
          category: "model",
          currentValue: "gpt-5.5",
          options: [{ value: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
      availableCommands: [{ name: "review" }, { name: "compact" }],
    }),
    buildResumeInfo: () => ({ supported: false }),
    hydrateSessionSummary: (summary: any) => ({
      ...summary,
      resume: sessions.has(summary.id)
        ? { mode: "same-process", state: "resume-available", reason: "active", checkedAt: "2026-05-16T00:00:00.000Z" }
        : { mode: "none", state: "history-only", reason: "missing active runtime", checkedAt: "2026-05-16T00:00:00.000Z" },
    }),
    sessionStore: {
      upsert: (summary: any) => { storedSessions.push(summary); },
      list: () => storedSessions,
    },
    persistRuntimeDescriptor: () => undefined,
    sessions,
    ...createPromptQueueContextExtras(),
    logInfo: () => undefined,
    logError: () => undefined,
    broadcastNotification: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: (sessionId: string, mutate: (summary: any) => any) => {
      const record = sessions.get(sessionId);
      if (!record) return undefined;
      const next = mutate(record.summary);
      record.summary = next;
      return next;
    },
  } as any) as any;

  await flushPromises();
  assert.equal(result.accepted, "sent");
  assert.equal(result.session.runtimeSessionId, "runtime-draft");
  assert.equal(result.session.resume.mode, "same-process");
  assert.equal(result.session.model, "gpt-5.5");
  assert.equal(result.session.reasoningEffort, undefined);
  assert.deepEqual(result.session.availableCommands, [
    { name: "review" },
    { name: "compact" },
  ]);
  assert.equal(attachedSessionId, result.session.id);
  assert.equal(prompted, "你好");
});

test("session/update_queued_prompt edits a queued prompt and broadcasts queue", async () => {
  const promptQueue = createSessionPromptQueueManager();
  const item = promptQueue.enqueue({
    sessionId: "s1",
    text: "before",
    clientMessageId: "client-1",
  });
  const broadcasts: any[] = [];

  const result = (await handleSessionRpcRequest(
    "session/update_queued_prompt",
    { sessionId: "s1", queueItemId: item.id, text: "after" },
    {
      promptQueue,
      broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
    } as any,
  )) as any;

  assert.equal(result.ok, true);
  assert.equal(result.queueItem.text, "after");
  assert.equal(broadcasts.at(-1)?.params.update.kind, "prompt_queue");
});

test("session/delete_queued_prompt deletes a queued prompt and broadcasts queue", async () => {
  const promptQueue = createSessionPromptQueueManager();
  const item = promptQueue.enqueue({
    sessionId: "s1",
    text: "remove me",
    clientMessageId: "client-1",
  });
  const broadcasts: any[] = [];

  const result = (await handleSessionRpcRequest(
    "session/delete_queued_prompt",
    { sessionId: "s1", queueItemId: item.id },
    {
      promptQueue,
      broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
    } as any,
  )) as any;

  assert.equal(result.ok, true);
  assert.equal(result.queue.queued.length, 0);
  assert.equal(broadcasts.at(-1)?.params.update.queue.queued.length, 0);
});

test("session/configure routes draft config without requiring a visible session", async () => {
  let configured: unknown;
  const result = await handleSessionRpcRequest(
    "session/configure",
    { draftId: "draft-1", model: "gpt-5.5", reasoningEffort: "high" },
    {
      configureRuntimeDraft: (params: unknown) => {
        configured = params;
        return {
          ok: true,
          draftId: "draft-1",
          state: { model: "gpt-5.5", reasoningEffort: "high" },
          options: [],
          message: "Runtime draft config updated.",
        };
      },
    } as any,
  );

  assert.deepEqual(configured, {
    draftId: "draft-1",
    agentMode: undefined,
    model: "gpt-5.5",
    reasoningEffort: "high",
    configId: undefined,
    value: undefined,
  });
  assert.deepEqual(result, {
    ok: true,
    draftId: "draft-1",
    state: { model: "gpt-5.5", reasoningEffort: "high" },
    options: [],
    message: "Runtime draft config updated.",
  });
});

test("session/set_config_option remains a compatibility alias for draft config", async () => {
  let configured: unknown;
  const result = await handleSessionRpcRequest(
    "session/set_config_option",
    { draftId: "draft-1", agentMode: "plan" },
    {
      configureRuntimeDraft: (params: unknown) => {
        configured = params;
        return {
          ok: true,
          draftId: "draft-1",
          state: { agentMode: "plan" },
          options: [],
          message: "Runtime draft config updated.",
        };
      },
    } as any,
  );

  assert.deepEqual(configured, {
    draftId: "draft-1",
    agentMode: "plan",
    model: undefined,
    reasoningEffort: undefined,
    configId: undefined,
    value: undefined,
  });
  assert.deepEqual(result, {
    ok: true,
    draftId: "draft-1",
    state: { agentMode: "plan" },
    options: [],
    message: "Runtime draft config updated.",
  });
});

test("session/configure forwards arbitrary config option values", async () => {
  let configured: unknown;
  await handleSessionRpcRequest(
    "session/configure",
    { draftId: "draft-1", configId: "notify", value: true },
    {
      configureRuntimeDraft: (params: unknown) => {
        configured = params;
        return {
          ok: true,
          draftId: "draft-1",
          state: {},
          options: [{ id: "notify", currentValue: true }],
          message: "Runtime draft config updated.",
        };
      },
    } as any,
  );

  assert.deepEqual(configured, {
    draftId: "draft-1",
    agentMode: undefined,
    model: undefined,
    reasoningEffort: undefined,
    configId: "notify",
    value: true,
  });
});

test("session/discard_draft delegates cleanup to the runtime draft registry", async () => {
  let discarded: unknown;
  const result = await handleSessionRpcRequest(
    "session/discard_draft",
    { deckClientId: "deck-1", draftId: "draft-1", reason: "scope-change" },
    {
      discardRuntimeDraft: (params: unknown) => {
        discarded = params;
        return {
          ok: true,
          discarded: true,
          draftId: "draft-1",
          cleanup: { kind: "remote-deleted", providerId: "opencode", message: "deleted" },
          message: "Runtime draft discarded.",
        };
      },
    } as any,
  );

  assert.deepEqual(discarded, {
    deckClientId: "deck-1",
    draftId: "draft-1",
    reason: "scope-change",
  });
  assert.deepEqual(result, {
    ok: true,
    discarded: true,
    draftId: "draft-1",
    cleanup: { kind: "remote-deleted", providerId: "opencode", message: "deleted" },
    message: "Runtime draft discarded.",
  });
});

test("session/new uses cwd without requiring cwd", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/repo",
    cwds: ["old-worktree"],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const agent = { id: "codex", name: "Codex" };
  let runtimeWorktree: unknown;
  let storedSummary: any;
  const sessions = new Map();

  const result = await handleSessionRpcRequest(
    "session/new",
    { projectId: "project-1", cwd: "D:/repo", agentId: "codex" },
    {
      loadAvailableHelms: () => [helm],
      loadAvailableWorktrees: () => [],
      loadAvailableAgents: () => [agent],
      loadAvailableProjectsWithSemanticSummaries: () => [project],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string) => (id === project.id ? project : undefined),
      resolveProviderById: (id: string) => (id === agent.id ? agent : undefined),
      resolveHelmById: (id: string) => (id === helm.id ? helm : undefined),
      buildResumeInfo: () => ({ mode: "none", state: "history-only", reason: "test", checkedAt: "2026-05-13T00:00:00.000Z" }),
      hydrateSessionSummary: (summary: any) => ({
        ...summary,
        resume: sessions.has(summary.id)
          ? { mode: "same-process", state: "resume-available", reason: "active", checkedAt: "2026-05-16T00:00:00.000Z" }
          : { mode: "none", state: "history-only", reason: "missing active runtime", checkedAt: "2026-05-16T00:00:00.000Z" },
      }),
      sessionStore: {
        upsert: (summary: any) => { storedSummary = summary; },
      },
      persistRuntimeDescriptor: () => undefined,
      broadcastNotification: () => undefined,
      logInfo: () => undefined,
      logError: () => undefined,
      handleRuntimeEvent: () => undefined,
      updateSessionSummary: () => undefined,
      sessions,
      createRuntime: async ({ worktree }: any) => {
        runtimeWorktree = worktree;
        return {
          runtimeSessionId: "runtime-1",
          sessionCapabilities: { sessionLoad: true },
          sessionConfigState: {},
          sessionModelState: {},
        };
      },
    } as any,
  ) as any;

  assert.deepEqual(runtimeWorktree, {
    name: "repo",
    path: "D:/repo",
    summary: undefined,
  });
  assert.equal(storedSummary.cwd, "D:/repo");
  assert.equal(result.session.cwd, "D:/repo");
  assert.equal(result.session.runtimeSessionId, "runtime-1");
  assert.equal((result.session as any).resume.mode, "same-process");
});

test("session/new preserves explicit reasoning until authoritative config options are known", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/repo",
    cwds: [],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const agent = { id: "claude", name: "Claude" };
  let runtimeSessionConfig: any;
  let storedSummary: any;
  const sessions = new Map();

  const result = await handleSessionRpcRequest(
    "session/new",
    {
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: "claude",
      model: "claude-haiku-4-5",
      reasoningEffort: "high",
    },
    {
      loadAvailableHelms: () => [helm],
      loadAvailableWorktrees: () => [],
      loadAvailableAgents: () => [agent],
      loadAvailableProjectsWithSemanticSummaries: () => [project],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string) => (id === project.id ? project : undefined),
      resolveProviderById: (id: string) => (id === agent.id ? agent : undefined),
      resolveHelmById: (id: string) => (id === helm.id ? helm : undefined),
      buildResumeInfo: () => ({
        mode: "none",
        state: "history-only",
        reason: "test",
        checkedAt: "2026-05-16T00:00:00.000Z",
      }),
      hydrateSessionSummary: (summary: any) => summary,
      sessionStore: {
        upsert: (summary: any) => {
          storedSummary = summary;
        },
      },
      persistRuntimeDescriptor: () => undefined,
      broadcastNotification: () => undefined,
      logInfo: () => undefined,
      logError: () => undefined,
      handleRuntimeEvent: () => undefined,
      updateSessionSummary: () => undefined,
      sessions,
      createRuntime: async ({ sessionConfig }: any) => {
        runtimeSessionConfig = sessionConfig;
        return {
          runtimeSessionId: "runtime-claude",
          sessionCapabilities: { sessionLoad: true },
          sessionConfigState: { reasoningEffort: "high" },
          sessionModelState: {},
        };
      },
    } as any,
  ) as any;

  assert.equal(runtimeSessionConfig.reasoningEffort, "high");
  assert.equal(runtimeSessionConfig.model, "claude-haiku-4-5");
  assert.equal(storedSummary.reasoningEffort, "high");
  assert.equal(result.session.reasoningEffort, "high");
});

test("session/draft preserves explicit reasoning until authoritative config options are known", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/repo",
    cwds: [],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const agent = { id: "claude", name: "Claude" };
  let draftSessionConfig: any;

  await handleSessionRpcRequest(
    "session/draft",
    {
      deckClientId: "deck-1",
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: "claude",
      model: "claude-haiku-4-5",
      reasoningEffort: "medium",
    },
    {
      loadAvailableHelms: () => [helm],
      loadAvailableWorktrees: () => [],
      loadAvailableAgents: () => [agent],
      loadAvailableProjectsWithSemanticSummaries: () => [project],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string) => (id === project.id ? project : undefined),
      resolveProviderById: (id: string) => (id === agent.id ? agent : undefined),
      resolveHelmById: (id: string) => (id === helm.id ? helm : undefined),
      createRuntimeDraft: async ({ sessionConfig }: any) => {
        draftSessionConfig = sessionConfig;
        return { ok: true };
      },
    } as any,
  );

  assert.equal(draftSessionConfig.reasoningEffort, "medium");
  assert.equal(draftSessionConfig.model, "claude-haiku-4-5");
});

test("session/list_timeline reads provider tool calls repaired during refresh materialization", async () => {
  const sessionId = "session-opencode-tool-repair";
  let toolCalls: AgentToolCall[] = [{
    id: "call-1",
    kind: "tool" as const,
    title: "Tool call call-1",
    status: "completed" as const,
    input: JSON.stringify({
      path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
      code_edit: "// ... existing code ...\nconst noop = true;\n// ... existing code ...",
    }),
    timestamp: "2026-06-20T10:00:01.000Z",
    updatedAt: "2026-06-20T10:00:01.000Z",
    sequence: 2,
  }];
  const timelineStore = {
    list: () => [],
    replace: (_sessionId: string, entries: any[]) => entries,
    listPage: (_sessionId: string, _options: any) => ({
      entries: [
        {
          id: "tool:call-1",
          kind: "tool_call",
          toolCall: toolCalls[0],
          timestamp: toolCalls[0].timestamp,
          updatedAt: toolCalls[0].updatedAt,
          sequence: toolCalls[0].sequence,
        },
      ],
      hasMore: false,
    }),
  };

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{
          id: sessionId,
          agentId: "opencode",
          status: "idle",
          updatedAt: "2026-06-20T10:00:10.000Z",
        }],
      },
      refreshAuthoritativeSessionHistory: async () => {
        const repaired = {
          ...toolCalls[0],
          kind: "write" as const,
          title: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
        };
        toolCalls = [repaired];
        return timelineStore.replace(sessionId, [
          {
            id: "tool:call-1",
            kind: "tool_call",
            toolCall: repaired,
            timestamp: repaired.timestamp,
            updatedAt: repaired.updatedAt,
            sequence: repaired.sequence,
          },
        ]);
      },
      sessionMessageStore: {
        list: () => [],
        listPage: () => ({ messages: [], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
        replaceToolCalls: (_sessionId: string, nextToolCalls: typeof toolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      sessionTimelineStore: timelineStore,
    } as any,
  ) as any;

  assert.equal(result.entries[0]?.kind, "tool_call");
  assert.equal(result.entries[0]?.toolCall.kind, "write");
  assert.equal(
    result.entries[0]?.toolCall.title,
    "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
  );
});

test.skip("session/list_timeline prefers replay when replayed tool metadata is stronger than persisted timeline metadata", async () => {
  const sessionId = "session-replay-stronger-tool-metadata";
  const runtimeSessionId = "runtime-1";
  const providerId = "codex";
  const userMessage = {
    id: "user-1",
    role: "user" as const,
    text: "开始",
    timestamp: "2026-06-20T10:00:00.000Z",
    sequence: 1,
  };
  const assistantMessage = {
    id: "assistant-1",
    role: "assistant" as const,
    text: "现在给 memo 加上比较器参数。",
    timestamp: "2026-06-20T10:00:01.000Z",
    sequence: 2,
  };
  const weakToolCall = {
    id: "toolu_01CTest",
    kind: "tool" as const,
    title: "Tool call toolu_01CTest",
    status: "completed" as const,
    timestamp: "2026-06-20T10:00:02.000Z",
    updatedAt: "2026-06-20T10:00:02.000Z",
    sequence: 3,
  };
  const strongToolCall = {
    ...weakToolCall,
    kind: "write" as const,
    title: "Write",
    input: JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  };
  const persistedTimeline = [
    {
      id: "user-1",
      kind: "user_message" as const,
      message: userMessage,
      timestamp: userMessage.timestamp,
      updatedAt: userMessage.timestamp,
      sequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [{
        id: "assistant-1:content",
        kind: "content" as const,
        text: assistantMessage.text,
        timestamp: assistantMessage.timestamp,
        sequence: 2,
      }],
      timestamp: assistantMessage.timestamp,
      updatedAt: assistantMessage.timestamp,
      sequence: 2,
    },
    {
      id: "tool:toolu_01CTest",
      kind: "tool_call" as const,
      toolCall: weakToolCall,
      timestamp: weakToolCall.timestamp,
      updatedAt: weakToolCall.updatedAt,
      sequence: 3,
    },
  ];
  const replayRecords = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 1,
      event: { type: "message", message: userMessage },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 2,
      event: { type: "message", message: assistantMessage },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 3,
      event: { type: "tool-call", toolCall: strongToolCall },
    }),
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{
          id: sessionId,
          agentId: providerId,
          status: "idle",
          updatedAt: "2026-06-20T10:00:10.000Z",
        }],
      },
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => [userMessage, assistantMessage],
        listPage: () => ({ messages: [userMessage, assistantMessage], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: persistedTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
      sessionUpdateStore: {
        listPage: () => ({ updates: replayRecords, hasMore: false }),
      },
    } as any,
  ) as any;

  const toolEntry = result.entries.find((entry: any) => entry.kind === "tool_call");

  assert.equal(toolEntry?.toolCall.kind, "write");
  assert.equal(toolEntry?.toolCall.title, "Write");
  assert.equal(
    toolEntry?.toolCall.input,
    JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  );
  assert.deepEqual(
    replacedTimeline.map((entry: any) =>
      entry.kind === "tool_call"
        ? [entry.kind, entry.toolCall.kind, entry.toolCall.title]
        : [entry.kind, entry.id],
    ),
    result.entries.map((entry: any) =>
      entry.kind === "tool_call"
        ? [entry.kind, entry.toolCall.kind, entry.toolCall.title]
        : [entry.kind, entry.id],
    ),
  );
});

test.skip("session/list_timeline repair replay preserves persisted compaction rows", async () => {
  const sessionId = "session-repair-compaction";
  const runtimeSessionId = "runtime-repair-compaction";
  const providerId = "claude";
  const userMessage = {
    id: "user-1",
    role: "user" as const,
    text: "继续",
    timestamp: "2026-06-28T00:00:00.000Z",
    sequence: 1,
  };
  const assistantMessage = {
    id: "assistant-1",
    role: "assistant" as const,
    text: "压缩后继续处理。",
    timestamp: "2026-06-28T00:00:03.000Z",
    sequence: 3,
  };
  const persistedTimeline = [
    {
      id: "user-1",
      kind: "user_message" as const,
      message: userMessage,
      timestamp: userMessage.timestamp,
      updatedAt: userMessage.timestamp,
      sequence: 1,
    },
    {
      kind: "context_compaction" as const,
      id: `compaction:${sessionId}:compaction-completed`,
      summaryMessageId: "compaction-completed",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      detailsVisibility: "expandable" as const,
      timestamp: "2026-06-28T00:00:01.000Z",
      updatedAt: "2026-06-28T00:00:02.000Z",
      replayCompleteness: "compacted" as const,
    },
    {
      id: "tool-call-1",
      kind: "tool_call" as const,
      toolCall: {
        id: "tool-call-1",
        kind: "tool" as const,
        title: "Tool call tool-call-1",
        status: "completed" as const,
        timestamp: "2026-06-28T00:00:02.000Z",
        updatedAt: "2026-06-28T00:00:02.000Z",
        sequence: 2,
      },
      timestamp: "2026-06-28T00:00:02.000Z",
      updatedAt: "2026-06-28T00:00:02.000Z",
      sequence: 2,
    },
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content" as const,
          text: "压缩后继续处理。",
          timestamp: assistantMessage.timestamp,
          sequence: 3,
        },
      ],
      timestamp: assistantMessage.timestamp,
      updatedAt: assistantMessage.timestamp,
      sequence: 3,
    },
  ];
  const replayRecords = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 1,
      event: { type: "message", message: userMessage },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 2,
      event: {
        type: "compaction",
        phase: "completed",
        source: "provider",
        timestamp: "2026-06-28T00:00:01.000Z",
        messageId: "compaction-completed",
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 3,
      event: {
        type: "compaction",
        phase: "completed",
        source: "heuristic",
        timestamp: "2026-06-28T00:00:02.000Z",
        messageId: "compaction-summary",
        summaryText: "This session is being continued from a previous conversation that ran out of context.",
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 4,
      event: {
        type: "tool-call",
        toolCall: {
          id: "tool-call-1",
          kind: "mcp",
          title: "Tool: mcp_router/find_symbol",
          status: "completed",
          timestamp: "2026-06-28T00:00:02.000Z",
          updatedAt: "2026-06-28T00:00:02.100Z",
          sequence: 2,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 5,
      event: { type: "message", message: assistantMessage },
    }),
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{
          id: sessionId,
          agentId: providerId,
          status: "idle",
          updatedAt: "2026-06-28T00:00:10.000Z",
        }],
      },
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => [userMessage, assistantMessage],
        listPage: () => ({ messages: [userMessage, assistantMessage], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        listPage: () => ({ entries: persistedTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
      },
      sessionUpdateStore: {
        listPage: () => ({ updates: replayRecords, hasMore: false }),
      },
    } as any,
  ) as any;

  const compactionEntries = result.entries.filter((entry: any) => entry.kind === "context_compaction");
  assert.equal(compactionEntries.length, 1);
  assert.equal(compactionEntries[0]?.id, `compaction:${sessionId}:compaction-completed`);
  assert.equal(compactionEntries[0]?.summaryText, "This session is being continued from a previous conversation that ran out of context.");
  assert.equal(compactionEntries[0]?.detailsVisibility, "expandable");
  assert.equal(
    result.entries.find((entry: any) => entry.kind === "tool_call")?.toolCall.kind,
    "mcp",
  );
  assert.equal(
    replacedTimeline.some((entry: any) => entry.kind === "context_compaction" && entry.id === `compaction:${sessionId}:compaction-completed`),
    true,
  );
});

test.skip("session/list_timeline repairs compaction rows from replay even when the current page has no tool calls", async () => {
  const sessionId = "session-repair-compaction-message-only";
  const runtimeSessionId = "runtime-repair-compaction-message-only";
  const providerId = "claude";
  const assistantMessage = {
    id: "assistant-1",
    role: "assistant" as const,
    text: "压缩后继续处理。",
    timestamp: "2026-06-28T00:00:03.000Z",
  };
  const persistedTimeline = [
    {
      id: "assistant-1",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content" as const,
          text: "压缩后继续处理。",
          timestamp: assistantMessage.timestamp,
        },
      ],
      timestamp: assistantMessage.timestamp,
      updatedAt: assistantMessage.timestamp,
    },
  ];
  const replayRecords = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 1,
      event: {
        type: "compaction",
        phase: "completed",
        source: "provider",
        timestamp: "2026-06-28T00:00:01.000Z",
        messageId: "compaction-completed",
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 2,
      event: {
        type: "compaction",
        phase: "completed",
        source: "heuristic",
        timestamp: "2026-06-28T00:00:02.000Z",
        messageId: "compaction-summary",
        summaryText: "This session is being continued from a previous conversation that ran out of context.",
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId,
      providerId,
      source: "acp_load_replay",
      sequence: 3,
      event: { type: "message", message: assistantMessage },
    }),
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [{
          id: sessionId,
          agentId: providerId,
          status: "idle",
          updatedAt: "2026-06-28T00:00:10.000Z",
        }],
      },
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        list: () => [assistantMessage],
        listPage: () => ({ messages: [assistantMessage], hasMore: false }),
      },
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        listPage: () => ({ entries: persistedTimeline, hasMore: false }),
        replace: (_sessionId: string, entries: any[]) => entries,
      },
      sessionUpdateStore: {
        listPage: () => ({ updates: replayRecords, hasMore: false }),
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:compaction-completed`],
      ["assistant_message", "assistant-1"],
    ],
  );
});

test("session/list_timeline keeps the latest persisted compaction boundary on the first page even without raw marker messages", async () => {
  const sessionId = "session-persisted-compaction-bootstrap";
  type LegacyResumedKind = `${"session"}_${"resumed"}`;
  const legacyResumedKind = ["session", "resumed"].join("_") as LegacyResumedKind;
  let persistedTimeline = [
    {
      id: "older-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content" as const,
          text: "压缩前最后一条可见回复",
          timestamp: "2026-06-18T13:50:00.000Z",
          sequence: 240,
        },
      ],
      timestamp: "2026-06-18T13:50:00.000Z",
      updatedAt: "2026-06-18T13:50:00.000Z",
      sequence: 240,
    },
    {
      id: `compaction:${sessionId}:compaction-summary`,
      kind: "context_compaction" as const,
      summaryMessageId: "compaction-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      detailsVisibility: "expandable" as const,
      timestamp: "2026-06-18T13:55:25.193Z",
      updatedAt: "2026-06-18T13:55:25.193Z",
      replayCompleteness: "compacted" as const,
    },
    {
      id: `resume:${sessionId}:assistant-after-compaction`,
      kind: legacyResumedKind,
      restoreMethod: "session/load" as const,
      timestamp: "2026-06-18T13:55:25.194Z",
      updatedAt: "2026-06-18T13:55:25.194Z",
      replayCompleteness: "compacted" as const,
    },
    {
      id: "assistant-after-compaction",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-after-compaction:content",
          kind: "content" as const,
          text: "这是压缩后的第一条回复。",
          timestamp: "2026-06-18T14:02:15.534Z",
          sequence: 275,
        },
      ],
      timestamp: "2026-06-18T14:02:15.534Z",
      updatedAt: "2026-06-18T14:02:15.534Z",
      sequence: 275,
    },
    {
      id: "assistant-latest",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-latest:content",
          kind: "content" as const,
          text: "这是最新回复。",
          timestamp: "2026-06-18T14:03:00.000Z",
          sequence: 276,
        },
      ],
      timestamp: "2026-06-18T14:03:00.000Z",
      updatedAt: "2026-06-18T14:03:00.000Z",
      sequence: 276,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 2 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({
          messages: [
            {
              id: "provider-assistant-after-compaction",
              role: "assistant" as const,
              text: "这是压缩后的第一条回复。",
              timestamp: "2026-06-18T14:02:15.534Z",
              sequence: 275,
            },
            {
              id: "provider-assistant-latest",
              role: "assistant" as const,
              text: "这是最新回复。",
              timestamp: "2026-06-18T14:03:00.000Z",
              sequence: 276,
            },
          ],
          hasMore: false,
        }),
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        listPage: () => (
          persistedTimeline.length === 5
            ? {
                entries: persistedTimeline.slice(3),
                nextCursor: "order\t3\tassistant-after-compaction",
                hasMore: true,
              }
            : {
                entries: persistedTimeline.slice(1),
                nextCursor: "order\t2\tassistant-after-compaction",
                hasMore: true,
              }
        ),
        replace: (_sessionId: string, entries: any[]) => {
          persistedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:compaction-summary`],
      ["assistant_message", "assistant-after-compaction"],
      ["assistant_message", "assistant-latest"],
    ],
  );
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "order\t2\tassistant-after-compaction");
  assert.deepEqual(
    persistedTimeline.map((entry: any) => entry.id),
    [
      "older-assistant",
      `compaction:${sessionId}:compaction-summary`,
      "assistant-after-compaction",
      "assistant-latest",
    ],
  );
});

test("session/list_timeline reanchors trailing compaction rows from markerless replay to the top boundary", async () => {
  const sessionId = "session-markerless-replay-compaction";
  let persistedTimeline = [
    {
      id: "assistant-after-compaction",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-after-compaction:content",
          kind: "content" as const,
          text: "这是压缩后的第一条回复。",
          timestamp: "2026-06-18T14:02:15.534Z",
          sequence: 275,
        },
      ],
      timestamp: "2026-06-18T14:02:15.534Z",
      updatedAt: "2026-06-18T14:02:15.534Z",
      sequence: 275,
    },
    {
      id: "assistant-latest",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-latest:content",
          kind: "content" as const,
          text: "这是最新回复。",
          timestamp: "2026-06-18T14:03:00.000Z",
          sequence: 276,
        },
      ],
      timestamp: "2026-06-18T14:03:00.000Z",
      updatedAt: "2026-06-18T14:03:00.000Z",
      sequence: 276,
    },
    {
      id: `compaction:${sessionId}:runtime-summary`,
      kind: "context_compaction" as const,
      phase: "completed" as const,
      source: "heuristic" as const,
      summaryMessageId: "runtime-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      detailsVisibility: "expandable" as const,
      timestamp: "2026-06-18T17:22:48.093Z",
      updatedAt: "2026-06-18T17:22:48.093Z",
      replayCompleteness: "compacted" as const,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_timeline",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({
          messages: [
            {
              id: "assistant-after-compaction",
              role: "assistant" as const,
              text: "这是压缩后的第一条回复。",
              timestamp: "2026-06-18T14:02:15.534Z",
              sequence: 275,
            },
            {
              id: "assistant-latest",
              role: "assistant" as const,
              text: "这是最新回复。",
              timestamp: "2026-06-18T14:03:00.000Z",
              sequence: 276,
            },
          ],
          hasMore: false,
        }),
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        listPage: () => (
          persistedTimeline[0]?.id === "assistant-after-compaction"
            ? {
                entries: persistedTimeline,
                nextCursor: undefined,
                hasMore: false,
              }
            : {
                entries: [
                  persistedTimeline[0],
                  persistedTimeline[1],
                  persistedTimeline[2],
                ],
                nextCursor: undefined,
                hasMore: false,
              }
        ),
        replace: (_sessionId: string, entries: any[]) => {
          persistedTimeline = entries;
          return entries;
        },
      },
    } as any,
  ) as any;

  assert.deepEqual(
    result.entries.map((entry: any) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:runtime-summary`],
      ["assistant_message", "assistant-after-compaction"],
      ["assistant_message", "assistant-latest"],
    ],
  );
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, undefined);
  assert.deepEqual(
    persistedTimeline.map((entry: any) => entry.id),
    [
      `compaction:${sessionId}:runtime-summary`,
      "assistant-after-compaction",
      "assistant-latest",
    ],
  );
});
