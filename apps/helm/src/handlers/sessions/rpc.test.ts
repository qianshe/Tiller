import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";
import { createSessionPromptQueueManager } from "../../runtime/session/prompt-queue";
import { createSessionUpdateRecord } from "../../runtime/session-updates/reducer";
import type { SessionUpdateRecord } from "@tiller/shared";

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

test("session/get_artifacts repairs stale running thinking for idle sessions", async () => {
  const sessionId = "session-thinking-history";
  let toolCalls = [
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
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
        getPage: () => ({ outputs: [], diffs: [], toolCalls, hasMore: false }),
        replaceToolCalls: (_sessionId: string, nextToolCalls: typeof toolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as { toolCalls: typeof toolCalls };

  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.equal(result.toolCalls[0]?.output, "persisted thinking");
  assert.equal(result.toolCalls[0]?.updatedAt, "2026-05-17T10:00:10.000Z");
});

test("session/get_artifacts returns the current history plan when available", async () => {
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
  ) as { plan?: typeof plan };

  assert.deepEqual(result.plan, plan);
});

test("session/get_artifacts repairs legacy subagent tool calls for history compatibility", async () => {
  const sessionId = "session-subagent-history";
  let toolCalls = [
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
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
        getPage: () => ({ outputs: [], diffs: [], toolCalls, hasMore: false }),
        replaceToolCalls: (_sessionId: string, nextToolCalls: typeof toolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as { toolCalls: typeof toolCalls };

  assert.equal(result.toolCalls[0]?.kind, "subagent");
  assert.equal(result.toolCalls[0]?.title, "spawn_agents_on_csv");
});

test("session/list_messages returns a unified timeline rebuilt from legacy stores", async () => {
  const sessionId = "session-with-legacy-timeline";
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      text: "Start",
      timestamp: "2026-05-24T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "Done",
      timestamp: "2026-05-24T10:00:02.000Z",
      sequence: 3,
    },
  ];
  const toolCalls = [
    {
      id: "assistant-1:thinking",
      commandId: "assistant-1:thinking",
      kind: "think" as const,
      title: "Thinking",
      status: "completed" as const,
      output: "Reason",
      timestamp: "2026-05-24T10:00:01.000Z",
      updatedAt: "2026-05-24T10:00:01.000Z",
      sequence: 2,
    },
  ];
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
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
        list: () => [],
        replace: (_sessionId: string, entries: any[]) => {
          replacedTimeline = entries;
          return entries;
        },
        listPage: () => ({ entries: replacedTimeline, hasMore: false }),
      },
    } as any,
  ) as { timeline: any[] };

  assert.deepEqual(
    result.timeline.map((entry) => entry.kind),
    ["user_message", "assistant_message"],
  );
  assert.deepEqual(
    result.timeline[1]?.chunks.map((chunk: any) => chunk.kind),
    ["thinking", "content"],
  );
  assert.deepEqual(
    replacedTimeline.map((entry) => entry.kind),
    ["user_message", "assistant_message"],
  );
});

test("session/list_messages treats existing timeline as the primary history", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string; chunks?: Array<{ kind: string; text: string }> }> };

  assert.deepEqual(result.timeline.map((entry) => entry.id), ["assistant-1"]);
  assert.deepEqual(result.timeline[0]?.chunks?.map((chunk) => chunk.kind), ["thinking", "content"]);
  assert.equal(readLegacyMessages, false);
  assert.equal(readLegacyArtifacts, false);
  assert.equal(replacedTimeline, false);
});

test("session/list_messages repairs timelines missing visible user anchors", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string; kind: string }> };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
});

test("session/list_messages repairs repeated prompts when one visible user anchor is missing", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string; kind: string }> };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["user_message", "user-2"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["user_message", "user-2"],
      ["assistant_message", "assistant-1#p0"],
    ],
  );
});

test("session/list_messages repairs timelines with assistant chunks collapsed across tool calls", async () => {
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
    "session/list_messages",
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
  ) as {
    timeline: Array<{
      id: string;
      kind: string;
      sequence?: number;
      chunks?: Array<{ text: string; sequence?: number }>;
    }>;
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  assert.deepEqual(
    result.timeline.map((entry) =>
      entry.kind === "assistant_message"
        ? entry.chunks?.map((chunk) => [chunk.text, chunk.sequence])
        : [entry.id, entry.sequence],
    ),
    [
      [["先说明。", 1]],
      ["tool:tool-1", 2],
      [["工具后继续。", 3]],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
});

test("session/list_messages normalizes persisted assistant entries crossing tool boundaries", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string; kind: string }> };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  assert.deepEqual(replacedTimeline, []);
});

test("session/list_messages repairs persisted timelines missing assistant updates from replay records", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string; kind: string; sequence?: number }> };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id, entry.sequence]),
    [
      ["user_message", "user-1", 1],
      ["assistant_message", "assistant-before", 2],
      ["tool_call", "tool:tool-1", 3],
      ["assistant_message", "assistant-after", 4],
    ],
  );
  assert.deepEqual(
    replacedTimeline.map((entry) => [entry.kind, entry.id, entry.sequence]),
    result.timeline.map((entry) => [entry.kind, entry.id, entry.sequence]),
  );
});

test("session/list_messages keeps partial persisted timelines as primary history", async () => {
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
    "session/list_messages",
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
  ) as { timeline: any[]; timelineHasMore: boolean };

  assert.deepEqual(result.timeline.map((entry) => entry.id), ["tool:stale-read"]);
  assert.equal(result.timelineHasMore, false);
  assert.deepEqual(replacedTimeline, []);
});

test("session/list_messages preserves persisted timeline order and content", async () => {
  const sessionId = "session-preserve-timeline-order";
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string; chunks?: Array<{ text: string }> }> };

  assert.deepEqual(
    result.timeline.map((entry) => entry.id),
    ["user-1", "assistant-1", "tool:tool-1", "assistant-1#p0"],
  );
  assert.deepEqual(replacedTimeline, []);
  assert.equal(result.timeline.at(-1)?.chunks?.[0]?.text, "old done");
});

test("session/list_messages keeps persisted timeline content when timeline exists", async () => {
  const sessionId = "session-stale-timeline-content";
  let replacedTimeline: any[] = [];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
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
  ) as { timeline: Array<{ chunks?: Array<{ text: string }> }> };

  assert.equal(result.timeline[0]?.chunks?.[0]?.text, "旧内容");
  assert.deepEqual(replacedTimeline, []);
});

test("session/list_messages uses timelineBefore independently from legacy message before", async () => {
  const sessionId = "session-timeline-pagination";
  let messagePageOptions: any;
  const timelineBefore = "order\t1\tlatest-timeline";

  const result = await handleSessionRpcRequest(
    "session/list_messages",
    { sessionId, limit: 20, timelineBefore },
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
      },
    } as any,
  ) as { timeline: Array<{ id: string }>; timelineBefore?: string; timelineNextCursor?: string };

  assert.deepEqual(messagePageOptions, { limit: 20, before: undefined });
  assert.deepEqual(result.timeline.map((entry) => entry.id), ["older-timeline"]);
  assert.equal(result.timelineBefore, timelineBefore);
  assert.equal(result.timelineNextCursor, undefined);
});

test("session/list_messages requests message-window timeline pages from the store", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string }>; timelineHasMore: boolean };

  assert.deepEqual(timelinePageOptions, {
    entryLimit: 96,
    limit: 2,
    before: undefined,
    window: "message",
  });
  assert.deepEqual(
    result.timeline.map((entry) => entry.id),
    ["assistant-intro", "tool-0", "tool-1", "tool-2", "tool-3", "assistant-final"],
  );
  assert.equal(result.timelineHasMore, false);
});

test("session/list_messages expands the first timeline page around compaction boundaries", async () => {
  const sessionId = "session-compaction-boundary";
  const fullTimeline = [
    {
      id: "older-user",
      kind: "user_message" as const,
      message: {
        id: "older-user",
        role: "user" as const,
        text: "先检查历史",
        timestamp: "2026-06-18T14:01:20.000Z",
        sequence: 254,
      },
      timestamp: "2026-06-18T14:01:20.000Z",
      updatedAt: "2026-06-18T14:01:20.000Z",
      sequence: 254,
    },
    {
      id: "older-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content" as const,
          text: "还没有，之前上下文断了。",
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
        text: "结束任务",
        timestamp: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      timestamp: "2026-06-18T14:01:49.292Z",
      updatedAt: "2026-06-18T14:01:49.292Z",
      sequence: 256,
    },
    {
      id: "tool-1",
      kind: "tool_call" as const,
      toolCall: {
        id: "tool-1",
        kind: "read" as const,
        title: "Read task list",
        status: "completed" as const,
        timestamp: "2026-06-18T14:02:00.000Z",
        updatedAt: "2026-06-18T14:02:00.000Z",
        sequence: 260,
      },
      timestamp: "2026-06-18T14:02:00.000Z",
      updatedAt: "2026-06-18T14:02:00.000Z",
      sequence: 260,
    },
    {
      id: "current-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "current-assistant:content",
          kind: "content" as const,
          text: "好的，我来完成剩余的两处改动然后收尾。",
          timestamp: "2026-06-18T14:02:16.000Z",
          sequence: 276,
        },
      ],
      timestamp: "2026-06-18T14:02:16.000Z",
      updatedAt: "2026-06-18T14:02:16.000Z",
      sequence: 276,
    },
    {
      id: "later-user",
      kind: "user_message" as const,
      message: {
        id: "later-user",
        role: "user" as const,
        text: "继续收尾",
        timestamp: "2026-06-18T14:04:00.000Z",
        sequence: 280,
      },
      timestamp: "2026-06-18T14:04:00.000Z",
      updatedAt: "2026-06-18T14:04:00.000Z",
      sequence: 280,
    },
    {
      id: "later-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "later-assistant:content",
          kind: "content" as const,
          text: "我再检查最后一遍。",
          timestamp: "2026-06-18T14:04:05.000Z",
          sequence: 281,
        },
      ],
      timestamp: "2026-06-18T14:04:05.000Z",
      updatedAt: "2026-06-18T14:04:05.000Z",
      sequence: 281,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({
          messages: [
            {
              id: "compaction-summary",
              role: "user" as const,
              text: "This session is being continued from a previous conversation that ran out of context.",
              timestamp: "2026-06-18T14:05:25.193Z",
            },
            {
              id: "previous-user",
              role: "user" as const,
              text: "完成了嘛？",
              timestamp: "2026-06-18T14:05:25.197Z",
            },
            {
              id: "provider-current-user",
              role: "user" as const,
              text: "结束任务",
              timestamp: "2026-06-18T14:01:49.292Z",
              sequence: 256,
            },
            {
              id: "provider-current-assistant",
              role: "assistant" as const,
              text: "好的，我来完成剩余的两处改动然后收尾。",
              timestamp: "2026-06-18T14:02:16.000Z",
              sequence: 276,
            },
          ],
          hasMore: false,
        }),
      },
      sessionTimelineStore: {
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(2),
          nextCursor: "order\t2\tcurrent-user",
          hasMore: true,
        }),
      },
    } as any,
  ) as {
    timeline: Array<{ id: string; kind: string }>;
    timelineHasMore: boolean;
    timelineNextCursor?: string;
    transcriptStatus?: { replayCompleteness?: string; integrity?: string };
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", `compaction:${sessionId}:compaction-summary`],
      ["session_resumed", `resume:${sessionId}:provider-current-user`],
      ["user_message", "current-user"],
      ["tool_call", "tool-1"],
      ["assistant_message", "current-assistant"],
    ],
  );
  assert.equal(result.timelineHasMore, true);
  assert.equal(result.timelineNextCursor, "order\t1\tolder-assistant");
  assert.equal(result.transcriptStatus?.replayCompleteness, "compacted");
  assert.equal(result.transcriptStatus?.integrity, "local-prefix-preserved");
});

test("session/list_messages injects compaction boundaries from explicit lifecycle marker messages", async () => {
  const sessionId = "session-compaction-lifecycle-boundary";
  const fullTimeline = [
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
  ];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
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
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(1),
          nextCursor: "order\t1\tcurrent-user",
          hasMore: true,
        }),
      },
    } as any,
  ) as {
    timeline: Array<{ id: string; kind: string }>;
    transcriptStatus?: { replayCompleteness?: string; integrity?: string };
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", `compaction:${sessionId}:compaction-completed`],
      ["session_resumed", `resume:${sessionId}:provider-current-user`],
      ["user_message", "current-user"],
      ["assistant_message", "current-assistant"],
    ],
  );
  assert.equal(result.transcriptStatus?.replayCompleteness, "compacted");
  assert.equal(result.transcriptStatus?.integrity, "local-prefix-preserved");
});

test("session/list_messages injects lifecycle compaction boundaries even when the resumed assistant message has no sequence", async () => {
  const sessionId = "session-compaction-lifecycle-unsequenced";
  const fullTimeline = [
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
      id: "assistant-check",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "assistant-check:content",
          kind: "content" as const,
          text: "检查当前改动状态。",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
      ],
      timestamp: "2026-06-18T14:01:49.292Z",
      updatedAt: "2026-06-18T14:01:49.292Z",
      sequence: 256,
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
          sequence: 276,
        },
      ],
      timestamp: "2026-06-18T14:02:16.000Z",
      updatedAt: "2026-06-18T14:02:16.000Z",
      sequence: 276,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
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
              id: "provider-assistant-check",
              role: "assistant" as const,
              text: "检查当前改动状态。",
              timestamp: "2026-06-18T14:01:49.292Z",
            },
            {
              id: "provider-assistant-after",
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
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(1),
          nextCursor: "order\t1\tassistant-check",
          hasMore: true,
        }),
      },
    } as any,
  ) as {
    timeline: Array<{ id: string; kind: string }>;
    transcriptStatus?: { replayCompleteness?: string; integrity?: string };
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", `compaction:${sessionId}:compaction-completed`],
      ["session_resumed", `resume:${sessionId}:provider-assistant-check`],
      ["assistant_message", "assistant-check"],
      ["assistant_message", "assistant-after"],
    ],
  );
  assert.equal(result.transcriptStatus?.replayCompleteness, "compacted");
  assert.equal(result.transcriptStatus?.integrity, "local-prefix-preserved");
});

test("session/list_messages keeps compaction rows when continuation summaries precede unsequenced resumed assistants", async () => {
  const sessionId = "session-compaction-summary-unsequenced";
  const fullTimeline = [
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
    "session/list_messages",
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
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(1),
          nextCursor: "order\t1\tassistant-after",
          hasMore: true,
        }),
      },
    } as any,
  ) as {
    timeline: Array<{ id: string; kind: string; summaryText?: string }>;
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", `compaction:${sessionId}:compaction-completed`],
      ["session_resumed", `resume:${sessionId}:provider-assistant-after`],
      ["assistant_message", "assistant-after"],
    ],
  );
  assert.equal(
    result.timeline.find((entry) => entry.kind === "context_compaction")?.summaryText,
    "This session is being continued from a previous conversation that ran out of context.",
  );
});

test("session/list_messages reanchors an existing compaction summary row instead of appending a duplicate at the end", async () => {
  const sessionId = "session-compaction-existing-summary";
  const fullTimeline = [
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
    "session/list_messages",
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
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(1),
          nextCursor: "order\t1\tcurrent-user",
          hasMore: true,
        }),
      },
    } as any,
  ) as {
    timeline: Array<{ id: string; kind: string; summaryText?: string }>;
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", `compaction:${sessionId}:runtime-summary`],
      ["session_resumed", `resume:${sessionId}:provider-current-user`],
      ["user_message", "current-user"],
      ["assistant_message", "current-assistant"],
    ],
  );
  const compactionEntries = result.timeline.filter((entry) => entry.kind === "context_compaction");
  assert.equal(compactionEntries.length, 1);
  assert.equal(
    compactionEntries[0]?.summaryText,
    "This session is being continued from a previous conversation that ran out of context.",
  );
});

test("session/list_messages caps compaction bootstrap pages while preserving the compaction anchors", async () => {
  const sessionId = "session-compaction-entry-cap";
  const toolEntries = Array.from({ length: 120 }, (_, index) => ({
    id: `tool-${index}`,
    kind: "tool_call" as const,
    toolCall: {
      id: `tool-${index}`,
      kind: "read" as const,
      title: `Read chunk ${index}`,
      status: "completed" as const,
      timestamp: `2026-06-18T14:02:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-06-18T14:02:${String(index).padStart(2, "0")}.000Z`,
      sequence: 300 + index,
    },
    timestamp: `2026-06-18T14:02:${String(index).padStart(2, "0")}.000Z`,
    updatedAt: `2026-06-18T14:02:${String(index).padStart(2, "0")}.000Z`,
    sequence: 300 + index,
  }));
  const fullTimeline = [
    {
      id: "older-user",
      kind: "user_message" as const,
      message: {
        id: "older-user",
        role: "user" as const,
        text: "先检查历史",
        timestamp: "2026-06-18T14:01:20.000Z",
        sequence: 254,
      },
      timestamp: "2026-06-18T14:01:20.000Z",
      updatedAt: "2026-06-18T14:01:20.000Z",
      sequence: 254,
    },
    {
      id: "older-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content" as const,
          text: "还没有，之前上下文断了。",
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
        text: "结束任务",
        timestamp: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      timestamp: "2026-06-18T14:01:49.292Z",
      updatedAt: "2026-06-18T14:01:49.292Z",
      sequence: 256,
    },
    ...toolEntries,
    {
      id: "current-assistant",
      kind: "assistant_message" as const,
      chunks: [
        {
          id: "current-assistant:content",
          kind: "content" as const,
          text: "好的，我来完成剩余的两处改动然后收尾。",
          timestamp: "2026-06-18T14:04:16.000Z",
          sequence: 999,
        },
      ],
      timestamp: "2026-06-18T14:04:16.000Z",
      updatedAt: "2026-06-18T14:04:16.000Z",
      sequence: 999,
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/list_messages",
    { sessionId, limit: 20 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionMessageStore: {
        listPage: () => ({
          messages: [
            {
              id: "compaction-summary",
              role: "user" as const,
              text: "This session is being continued from a previous conversation that ran out of context.",
              timestamp: "2026-06-18T14:05:25.193Z",
            },
            {
              id: "previous-user",
              role: "user" as const,
              text: "完成了嘛？",
              timestamp: "2026-06-18T14:05:25.197Z",
            },
            {
              id: "provider-current-user",
              role: "user" as const,
              text: "结束任务",
              timestamp: "2026-06-18T14:01:49.292Z",
              sequence: 256,
            },
            {
              id: "provider-current-assistant",
              role: "assistant" as const,
              text: "好的，我来完成剩余的两处改动然后收尾。",
              timestamp: "2026-06-18T14:04:16.000Z",
              sequence: 999,
            },
          ],
          hasMore: false,
        }),
      },
      sessionTimelineStore: {
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(2),
          nextCursor: "order\t2\tcurrent-user",
          hasMore: true,
        }),
      },
    } as any,
  ) as { timeline: Array<{ id: string; kind: string }>; timelineHasMore: boolean; timelineNextCursor?: string };

  assert.equal(result.timeline.length, 98);
  assert.deepEqual(
    result.timeline.slice(0, 4).map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", `compaction:${sessionId}:compaction-summary`],
      ["session_resumed", `resume:${sessionId}:provider-current-user`],
      ["user_message", "current-user"],
    ],
  );
  assert.equal(result.timeline.at(-1)?.id, "current-assistant");
  assert.equal(result.timeline.some((entry) => entry.id === "tool-0"), false);
  assert.equal(result.timeline.some((entry) => entry.id === "tool-27"), true);
  assert.equal(result.timelineHasMore, true);
  assert.equal(result.timelineNextCursor, "order\t30\ttool-27");
});

test("session/list_messages caps dense timeline entry pages", async () => {
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
    "session/list_messages",
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
  ) as { timeline: Array<{ id: string }>; timelineHasMore: boolean };

  assert.equal(result.timeline.length, 96);
  assert.equal(result.timeline[0]?.id, "tool-45");
  assert.equal(result.timeline.at(-1)?.id, "assistant-final");
  assert.equal(result.timelineHasMore, true);
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
  ) as { session: any };

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
  ) as { accepted: "sent" };

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
  } as any) as { session: any; accepted: "sent" };

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
  )) as { ok: boolean; queueItem: { text: string } };

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
  )) as { ok: boolean; queue: { queued: unknown[] } };

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
  ) as { session: { cwd?: string; runtimeSessionId?: string } };

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
  ) as { session: { reasoningEffort?: string } };

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

test("session/list_updates returns paged raw session updates", async () => {
  const callOrder: string[] = [];
  const calls: Array<{ sessionId: string; options: { limit?: number; before?: string } }> = [];
  const result = await handleSessionRpcRequest(
    "session/list_updates",
    { sessionId: "session-1", limit: 2, before: "sequence\t5" },
    {
      refreshAuthoritativeSessionHistory: async (sessionId: string) => {
        callOrder.push(`refresh:${sessionId}`);
      },
      sessionUpdateStore: {
        listPage: (sessionId: string, options: { limit?: number; before?: string }) => {
          callOrder.push(`list:${sessionId}`);
          calls.push({ sessionId, options });
          return {
            updates: [
              {
                sessionId,
                runtimeSessionId: "runtime-1",
                providerId: "codex",
                sequence: 3,
                source: "acp_load_replay" as const,
                updateType: "message",
                receivedAt: "2026-06-13T10:00:00.000Z",
                payloadJson: "{\"type\":\"message\"}",
              },
              {
                sessionId,
                runtimeSessionId: "runtime-1",
                providerId: "codex",
                sequence: 4,
                source: "acp_load_replay" as const,
                updateType: "tool-call",
                receivedAt: "2026-06-13T10:00:01.000Z",
                payloadJson: "{\"type\":\"tool-call\"}",
              },
            ] as SessionUpdateRecord[],
            nextCursor: "sequence\t3",
            hasMore: true,
          };
        },
      },
    } as any,
  ) as {
    ok: boolean;
    sessionId: string;
    updates: Array<{ sequence: number }>;
    nextCursor?: string;
    hasMore: boolean;
  };

  assert.deepEqual(callOrder, ["refresh:session-1", "list:session-1"]);
  assert.deepEqual(calls, [
    { sessionId: "session-1", options: { limit: 2, before: "sequence\t5" } },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-1");
  assert.deepEqual(result.updates.map((update) => update.sequence), [3, 4]);
  assert.equal(result.nextCursor, "sequence\t3");
  assert.equal(result.hasMore, true);
});

test("session/list_updates reports unavailable raw update store", async () => {
  const result = await handleSessionRpcRequest(
    "session/list_updates",
    { sessionId: "session-1", limit: 2 },
    {
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionUpdateStore: undefined,
    } as any,
  ) as { ok: boolean; sessionId: string; updates: unknown[]; hasMore: boolean; message?: string };

  assert.equal(result.ok, false);
  assert.equal(result.sessionId, "session-1");
  assert.deepEqual(result.updates, []);
  assert.equal(result.hasMore, false);
  assert.equal(result.message, "Session update store not available");
});

test("session/list_messages repairs legacy tool calls before rebuilding the timeline", async () => {
  const sessionId = "session-opencode-tool-repair";
  let toolCalls = [{
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

  const result = await handleSessionRpcRequest(
    "session/list_messages",
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
      refreshAuthoritativeSessionHistory: async () => undefined,
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
      sessionTimelineStore: {
        list: () => [],
        replace: (_sessionId: string, entries: any[]) => entries,
        listPage: () => undefined,
      },
    } as any,
  ) as { timeline: any[] };

  assert.equal(result.timeline[0]?.kind, "tool_call");
  assert.equal(result.timeline[0]?.toolCall.kind, "write");
  assert.equal(
    result.timeline[0]?.toolCall.title,
    "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
  );
});

test("session/list_messages prefers replay when replayed tool metadata is stronger than persisted timeline metadata", async () => {
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
    "session/list_messages",
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
  ) as { timeline: any[] };

  const toolEntry = result.timeline.find((entry) => entry.kind === "tool_call");

  assert.equal(toolEntry?.toolCall.kind, "write");
  assert.equal(toolEntry?.toolCall.title, "Write");
  assert.equal(
    toolEntry?.toolCall.input,
    JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  );
  assert.deepEqual(
    replacedTimeline.map((entry) =>
      entry.kind === "tool_call"
        ? [entry.kind, entry.toolCall.kind, entry.toolCall.title]
        : [entry.kind, entry.id],
    ),
    result.timeline.map((entry) =>
      entry.kind === "tool_call"
        ? [entry.kind, entry.toolCall.kind, entry.toolCall.title]
        : [entry.kind, entry.id],
    ),
  );
});

test("session/list_messages repair replay preserves persisted compaction rows", async () => {
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
    "session/list_messages",
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
  ) as { timeline: any[] };

  const compactionEntries = result.timeline.filter((entry) => entry.kind === "context_compaction");
  assert.equal(compactionEntries.length, 1);
  assert.equal(compactionEntries[0]?.id, `compaction:${sessionId}:compaction-completed`);
  assert.equal(compactionEntries[0]?.summaryText, "This session is being continued from a previous conversation that ran out of context.");
  assert.equal(compactionEntries[0]?.detailsVisibility, "expandable");
  assert.equal(
    result.timeline.find((entry) => entry.kind === "tool_call")?.toolCall.kind,
    "mcp",
  );
  assert.equal(
    replacedTimeline.some((entry) => entry.kind === "context_compaction" && entry.id === `compaction:${sessionId}:compaction-completed`),
    true,
  );
});

test("session/list_messages repairs compaction rows from replay even when the current page has no tool calls", async () => {
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
    "session/list_messages",
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
  ) as { timeline: any[] };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:compaction-completed`],
      ["assistant_message", "assistant-1"],
    ],
  );
});

test("session/list_messages keeps the latest persisted compaction boundary on the first page even without raw marker messages", async () => {
  const sessionId = "session-persisted-compaction-bootstrap";
  const fullTimeline = [
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
      kind: "session_resumed" as const,
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
    "session/list_messages",
    { sessionId, limit: 20 },
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
        list: () => fullTimeline,
        listPage: () => ({
          entries: fullTimeline.slice(3),
          nextCursor: "order\t3\tassistant-after-compaction",
          hasMore: true,
        }),
      },
    } as any,
  ) as {
    timeline: Array<{ id: string; kind: string }>;
  };

  assert.deepEqual(
    result.timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["context_compaction", `compaction:${sessionId}:compaction-summary`],
      ["session_resumed", `resume:${sessionId}:assistant-after-compaction`],
      ["assistant_message", "assistant-after-compaction"],
      ["assistant_message", "assistant-latest"],
    ],
  );
});
