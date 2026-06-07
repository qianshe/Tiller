import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";
import { createSessionPromptQueueManager } from "../../runtime/session-prompt-queue";

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

test("session/list_messages returns a unified timeline rebuilt from legacy stores", async () => {
  const sessionId = "session-with-legacy-timeline";
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      text: "Start",
      timestamp: "2026-05-24T10:00:00.000Z",
      timelineSequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      text: "Done",
      timestamp: "2026-05-24T10:00:02.000Z",
      timelineSequence: 3,
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
      timelineSequence: 2,
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
          timelineSequence: 1,
        },
        {
          id: "assistant-1:content",
          kind: "content" as const,
          text: "再回复",
          timestamp: "2026-05-24T10:00:01.000Z",
          timelineSequence: 2,
        },
      ],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:01.000Z",
      timelineSequence: 1,
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
              timelineSequence: 3,
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
      timelineSequence: 1,
    },
    {
      id: "assistant-1#p0",
      role: "assistant" as const,
      text: "已检查",
      timestamp: "2026-05-24T10:00:02.000Z",
      timelineSequence: 2,
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
          timelineSequence: 2,
        },
      ],
      timestamp: "2026-05-24T10:00:02.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      timelineSequence: 2,
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
      timelineSequence: 1,
    },
    {
      id: "user-2",
      role: "user" as const,
      text: "继续",
      timestamp: "2026-05-24T10:00:03.000Z",
      timelineSequence: 2,
    },
    {
      id: "assistant-1#p0",
      role: "assistant" as const,
      text: "已继续",
      timestamp: "2026-05-24T10:00:04.000Z",
      timelineSequence: 3,
    },
  ];
  const staleTimeline = [
    {
      id: "user-2",
      kind: "user_message" as const,
      message: messages[1]!,
      timestamp: "2026-05-24T10:00:03.000Z",
      updatedAt: "2026-05-24T10:00:03.000Z",
      timelineSequence: 2,
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
          timelineSequence: 3,
        },
      ],
      timestamp: "2026-05-24T10:00:04.000Z",
      updatedAt: "2026-05-24T10:00:04.000Z",
      timelineSequence: 3,
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

test("session/list_messages keeps partial persisted timelines as primary history", async () => {
  const sessionId = "session-partial-timeline";
  const messages = [
    {
      id: "user-latest",
      role: "user" as const,
      text: "继续",
      timestamp: "2026-05-24T10:00:00.000Z",
      timelineSequence: 1,
    },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `assistant-final#p${index}`,
      role: "assistant" as const,
      text: `段落 ${index}`,
      timestamp: `2026-05-24T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      timelineSequence: index + 2,
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
        timelineSequence: 15,
      },
      timestamp: "2026-05-24T10:00:14.500Z",
      updatedAt: "2026-05-24T10:00:14.500Z",
      timelineSequence: 15,
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
            timelineSequence: 1,
          },
          {
            id: "assistant-1#p0",
            role: "assistant" as const,
            text: "new done",
            timestamp: "2026-05-24T10:00:40.000Z",
            timelineSequence: 2,
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
              timelineSequence: 1,
            },
            timestamp: "2026-05-24T10:00:30.000Z",
            updatedAt: "2026-05-24T10:00:30.000Z",
            timelineSequence: 1,
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
              timelineSequence: 2,
            }],
            timestamp: "2026-05-24T10:00:40.000Z",
            updatedAt: "2026-05-24T10:00:40.000Z",
            timelineSequence: 2,
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
            timelineSequence: 1,
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
                timelineSequence: 1,
              },
            ],
            timestamp: "2026-05-24T10:00:00.000Z",
            updatedAt: "2026-05-24T10:00:00.000Z",
            timelineSequence: 1,
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
          timelineSequence: 1,
        },
      ],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:00.000Z",
      timelineSequence: 1,
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
        timelineSequence: index + 2,
      },
      timestamp: `2026-05-24T10:00:0${index + 1}.000Z`,
      updatedAt: `2026-05-24T10:00:0${index + 1}.000Z`,
      timelineSequence: index + 2,
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
          timelineSequence: 6,
        },
      ],
      timestamp: "2026-05-24T10:00:06.000Z",
      updatedAt: "2026-05-24T10:00:06.000Z",
      timelineSequence: 6,
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
          timelineSequence: 1,
        },
      ],
      timestamp: "2026-05-24T10:00:00.000Z",
      updatedAt: "2026-05-24T10:00:00.000Z",
      timelineSequence: 1,
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
        timelineSequence: index + 2,
      },
      timestamp: `2026-05-24T10:01:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-24T10:01:${String(index).padStart(2, "0")}.000Z`,
      timelineSequence: index + 2,
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
          timelineSequence: 142,
        },
      ],
      timestamp: "2026-05-24T10:03:00.000Z",
      updatedAt: "2026-05-24T10:03:00.000Z",
      timelineSequence: 142,
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

test("session/reimport_history delegates to the history reimport service", async () => {
  let delegated: unknown;
  const result = await handleSessionRpcRequest(
    "session/reimport_history",
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
  } as any);

  assert.deepEqual(calls, ["socket-1:s1"]);
  assert.deepEqual(result, { ok: true, message: "Subscribed to session s1." });
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
