import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentToolCall, CommandChunk, PromptTraceEvent, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleRuntimeEvent } from "./events.js";
import { createLiveMessageBuffer } from "./live-message-buffer.js";

type TestContextCapture = {
  broadcasts: unknown[];
  detailBroadcasts: unknown[];
  persisted: AgentMessage[];
  summaryUpdates?: SessionSummary[];
  traceEvents?: PromptTraceEvent[];
};

function createTestContext(
  logs: string[],
  capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] },
  sessionId = "session-1",
  summaryPatch: Partial<SessionSummary> = {},
): HelmHandlerContext {
  const summary: SessionSummary = {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project One",
    helmId: "helm-1",
    cwd: "worktree-1",
    worktreeName: "Worktree One",
    agentId: "opencode",
    agentName: "OpenCode",
    status: "running",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    messageCount: 0,
    ...summaryPatch,
  };

  return {
    sessions: new Map([
      [
        sessionId,
        {
          agent: { id: "opencode" },
          worktree: { id: "worktree-1" },
          summary,
        },
      ],
    ]),
    sessionStore: { list: () => [summary] },
    logInfo: (message: string) => logs.push(message),
    logDebug: () => undefined,
    logWarn: (message: string) => logs.push(message),
    logError: (message: string) => logs.push(message),
    promptTrace: capture.traceEvents
      ? { emit: (event: PromptTraceEvent) => capture.traceEvents?.push(event) }
      : undefined,
    persistSessionMessage: (_sessionId: string, message: AgentMessage) => {
      capture.persisted.push(message);
    },
    updateSessionSummary: (
      _sessionId: string,
      mutate: (current: SessionSummary) => SessionSummary,
    ) => {
      const next = mutate(summary);
      capture.summaryUpdates?.push(next);
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => {
      capture.broadcasts.push({ method, params });
    },
    broadcastSessionTopic: (sessionId: string, method: string, params: unknown) => {
      capture.detailBroadcasts.push({ sessionId, method, params });
    },
    approvalIndex: new Map(),
    permissionIndex: new Map(),
    readApprovalPolicy: () => ({ rules: [] }),
    saveApprovalPolicyRule: () => undefined,
    liveMessageBuffer: createLiveMessageBuffer(),
    sessionArtifactStore: {
      appendOutput: () => undefined,
      appendToolCall: () => undefined,
    },
    publishDiffUpdate: async () => undefined,
    hydrateSessionSummary: (item: SessionSummary) => item,
  } as unknown as HelmHandlerContext;
}

test("runtime events emit first runtime and broadcast prompt trace markers", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    traceEvents: [],
  };
  const context = createTestContext(logs, capture, "trace-session");

  handleRuntimeEvent(
    "trace-session",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "hello",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(
    capture.traceEvents?.some((event) => event.phase === "helm.runtime.first_message"),
    true,
  );
  assert.equal(
    capture.traceEvents?.some((event) => event.phase === "helm.session_update.broadcast"),
    true,
  );
});

test("runtime session.message persists and broadcasts streaming chunks with debug text", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "你",
          timestamp: "2026-04-30T00:00:01.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );

    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "好\n主人",
          timestamp: "2026-04-30T00:00:02.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );

    handleRuntimeEvent(
      "session-1",
      {
        type: "status",
        status: "idle",
        message: "done",
      } satisfies SessionRuntimeEvent,
      context,
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(logs.length, 2);
  assert.match(logs[0], /阶段=直播消息流开始 seq=\d+ .*role=assistant .*id=session-1-msg-\d{6}-\d{6}-pmessage1/);
  assert.match(logs[1], /阶段=运行状态流/);
  assert.doesNotMatch(logs[0], /preview=|text=|chars=/);
  assert.deepEqual(writes, ["你", "好\n主人", "\n"]);
  assert.equal(capture.persisted.length, 1);
  assert.deepEqual(
    capture.persisted.map((message) => message.text),
    ["你好\n主人"],
  );
  assert.equal(capture.broadcasts.length, 1);
  assert.equal(capture.detailBroadcasts.length, 3);
});

test("runtime streaming chunks defer summary persistence until flush", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "你",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "好",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.length, 0);

  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.length, 2);
  assert.equal(capture.persisted.length, 1);
  assert.equal(capture.persisted[0]?.text, "你好");
});

test("runtime assistant chunks reuse one ordered segment id", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture, "session-stream-ordered");

  handleRuntimeEvent(
    "session-stream-ordered",
    {
      type: "message",
      message: {
        id: "session-stream-ordered-msg-a",
        role: "assistant",
        text: "hello",
        timestamp: "2026-05-15T10:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-stream-ordered",
    {
      type: "message",
      message: {
        id: "session-stream-ordered-msg-000001-000000-c1234abcd",
        role: "assistant",
        text: "hello world",
        timestamp: "2026-05-15T10:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-stream-ordered",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.persisted.length, 1);
  assert.equal(capture.persisted[0]?.text, "hello world");
  assert.match(capture.persisted[0]?.id ?? "", /^session-stream-ordered-msg-000001-000000-/u);
});

test("repeated running status does not advance turn without an active assistant segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture, "session-no-bump");

  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "status",
      status: "running",
      message: "started",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "status",
      status: "running",
      message: "still running",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "message",
      message: {
        id: "session-no-bump-msg-a",
        role: "assistant",
        text: "一次回复",
        timestamp: "2026-05-15T10:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.match(capture.persisted[0]?.id ?? "", /^session-no-bump-msg-000001-000000-/u);
});

test("runtime assistant stream closes before the next stage log", () => {
  const logs: string[] = [];
  const context = createTestContext(logs);
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "连续输出",
          timestamp: "2026-04-30T00:00:01.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
    handleRuntimeEvent(
      "session-1",
      {
        type: "status",
        status: "idle",
        message: "done",
      } satisfies SessionRuntimeEvent,
      context,
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(logs.length, 2);
  assert.match(logs[0], /阶段=直播消息流开始/);
  assert.match(logs[1], /阶段=运行状态流/);
  assert.deepEqual(writes, ["连续输出", "\n"]);
});

test("runtime user echo messages are ignored because prompts are already persisted before sending", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "runtime-user-echo-1",
          role: "user",
          text: "你好",
          timestamp: "2026-04-30T00:00:03.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(logs.length, 1);
  assert.match(logs[0], /阶段=用户回显忽略/);
  assert.match(logs[0], /text=你好/);
  assert.deepEqual(writes, []);
  assert.deepEqual(capture.persisted, []);
  assert.equal(appendedToolCalls.length, 0);
  assert.equal(capture.broadcasts.length, 0);
});

test("fatal ACP connection errors mark the active runtime stale", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "error",
      code: "ACP_CONNECTION_EXITED",
      message: "ACP process exited with code=1 signal=none",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(context.sessions.has("session-1"), false);
  assert.equal(capture.persisted[0]?.role, "system");
  assert.equal(capture.persisted[0]?.text, "ACP process exited with code=1 signal=none");
  assert.match(logs.join("\n"), /阶段=运行时已标记为可恢复/);
});

test("runtime wrapped user echoes are ignored when they contain the client prompt", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  context.sessionMessageStore = {
    list: () => [
      {
        id: "client-user-1",
        role: "user",
        text: "你深度检查一下前端还有什么缺陷？",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    ],
  } as HelmHandlerContext["sessionMessageStore"];

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "runtime-user-wrapper-1",
        role: "user",
        text: "[search-mode]\nMAXIMIZE SEARCH EFFORT.\n\n你深度检查一下前端还有什么缺陷？",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(logs.length, 1);
  assert.match(logs[0], /阶段=用户回显忽略/);
  assert.match(logs[0], /MAXIMIZE SEARCH EFFORT/);
  assert.deepEqual(capture.persisted, []);
  assert.deepEqual(capture.broadcasts, []);
});

test("runtime assistant chunks stay split when tool activity occurs between text streams", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-a",
        role: "assistant",
        text: "工具前说明",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "tool-call",
      toolCall: {
        id: "call-branch",
        kind: "tool",
        title: "Show branch",
        status: "completed",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-b",
        role: "assistant",
        text: "工具后继续",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.persisted.map((message) => message.text),
    ["工具前说明", "工具后继续"],
  );
  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.match(capture.persisted[1]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.notEqual(capture.persisted[0]?.id, capture.persisted[1]?.id);
  assert.equal(appendedToolCalls.length, 1);
});

test("runtime-generated delta chunks with fresh source ids stay in one stream segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-alpha",
        role: "assistant",
        text: "当前分支是 `codex/debug-st",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-beta",
        role: "assistant",
        text: "ream-tool-logs`,看起来正在调",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.deepEqual(
    capture.persisted.map((message) => message.text),
    ["当前分支是 `codex/debug-stream-tool-logs`,看起来正在调"],
  );
});

test("runtime-generated independent assistant messages get distinct stream segment ids", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-alpha",
        role: "assistant",
        text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata.",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-beta",
        role: "assistant",
        text: "你好主人，我会按你的项目规则继续处理。",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.persisted[0]?.text, "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata.");
  assert.equal(capture.persisted[1]?.text, "你好主人，我会按你的项目规则继续处理。");
  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.match(capture.persisted[1]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.notEqual(capture.persisted[0]?.id, capture.persisted[1]?.id);
});

test("runtime config option defaults do not overwrite a stored session model selection", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-selected-model", {
    model: "gpt-5.4",
    reasoningEffort: "medium",
  });

  handleRuntimeEvent(
    "session-selected-model",
    {
      type: "config-options",
      state: { model: "gpt-5.5", reasoningEffort: "medium" },
      options: [],
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.at(-1)?.model, "gpt-5.4");
});

test("runtime config options omit reasoning when authoritative options omit reasoning", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-haiku", {
    model: "claude-haiku-4-5",
    reasoningEffort: "medium",
  });

  handleRuntimeEvent(
    "session-haiku",
    {
      type: "config-options",
      state: { model: "claude-haiku-4-5", reasoningEffort: "medium" },
      options: [
        {
          id: "model",
          category: "model",
          currentValue: "claude-haiku-4-5",
          options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
        },
      ],
    } satisfies SessionRuntimeEvent,
    context,
  );

  const configUpdate = capture.broadcasts.find(
    (item) => (item as { method?: string }).method === "session/update",
  ) as { params?: { update?: { options?: Array<{ category?: string }>; state?: { reasoningEffort?: string } } } } | undefined;
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, undefined);
  assert.equal(configUpdate?.params?.update?.state?.reasoningEffort, undefined);
  assert.equal(
    configUpdate?.params?.update?.options?.some((option) => option.category === "thought_level"),
    false,
  );
});

test("runtime config options preserve reasoning for haiku when ACP exposes reasoning", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-opencode-haiku", {
    model: "opencode/haiku",
  });

  handleRuntimeEvent(
    "session-opencode-haiku",
    {
      type: "config-options",
      state: { model: "opencode/haiku", reasoningEffort: "medium" },
      options: [
        {
          id: "model",
          category: "model",
          currentValue: "opencode/haiku",
          options: [{ value: "opencode/haiku", label: "opencode/haiku" }],
        },
        {
          id: "thought_level",
          category: "thought_level",
          currentValue: "medium",
          options: [{ value: "medium", label: "Medium" }],
        },
      ],
    } satisfies SessionRuntimeEvent,
    context,
  );

  const configUpdate = capture.broadcasts.find(
    (item) => (item as { method?: string }).method === "session/update",
  ) as { params?: { update?: { options?: Array<{ category?: string }>; state?: { reasoningEffort?: string } } } } | undefined;
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, "medium");
  assert.equal(configUpdate?.params?.update?.state?.reasoningEffort, "medium");
  assert.equal(
    configUpdate?.params?.update?.options?.some((option) => option.category === "thought_level"),
    true,
  );
});

test("runtime stale config option defaults do not re-add reasoning for selected model", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-stale-haiku", {
    model: "claude-haiku-4-5",
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "claude-haiku-4-5",
        options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
      },
    ],
  });

  handleRuntimeEvent(
    "session-stale-haiku",
    {
      type: "config-options",
      state: { model: "claude-opus-4-7", reasoningEffort: "medium" },
      options: [
        {
          id: "model",
          category: "model",
          currentValue: "claude-opus-4-7",
          options: [
            { value: "claude-opus-4-7", label: "claude-opus-4-7" },
            { value: "claude-haiku-4-5", label: "claude-haiku-4-5" },
          ],
        },
        {
          id: "thought_level",
          category: "thought_level",
          currentValue: "medium",
          options: [{ value: "medium", label: "Medium" }],
        },
      ],
    } satisfies SessionRuntimeEvent,
    context,
  );

  const configUpdate = capture.broadcasts.find(
    (item) => (item as { method?: string }).method === "session/update",
  ) as { params?: { update?: { options?: Array<{ category?: string }>; state?: { model?: string; reasoningEffort?: string } } } } | undefined;
  assert.equal(capture.summaryUpdates?.at(-1)?.model, "claude-haiku-4-5");
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, undefined);
  assert.equal(configUpdate?.params?.update?.state?.model, "claude-haiku-4-5");
  assert.equal(
    configUpdate?.params?.update?.options?.some((option) => option.category === "thought_level"),
    false,
  );
});

test("runtime model option defaults do not overwrite a stored session model selection", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-selected-native-model", {
    model: "gpt-5.4",
  });

  handleRuntimeEvent(
    "session-selected-native-model",
    {
      type: "model-options",
      state: {
        currentModelId: "gpt-5.5",
        options: [{ id: "gpt-5.4", name: "gpt-5.4" }, { id: "gpt-5.5", name: "gpt-5.5" }],
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.at(-1)?.model, "gpt-5.4");
  assert.deepEqual(
    capture.summaryUpdates?.at(-1)?.modelOptions?.map((option) => option.id),
    ["gpt-5.4", "gpt-5.5"],
  );
});

test("runtime-generated short assistant replies split after provider diagnostics", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-diagnostic",
        role: "assistant",
        text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-ok",
        role: "assistant",
        text: "OK",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.persisted[0]?.text.startsWith("Model metadata for"), true);
  assert.equal(capture.persisted[1]?.text, "OK");
  assert.notEqual(capture.persisted[0]?.id, capture.persisted[1]?.id);
});

test("runtime running status starts a fresh assistant segment for the next prompt", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-first",
        role: "assistant",
        text: "第一轮回复",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "running",
      message: "ACP agent is responding",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-second",
        role: "assistant",
        text: "第二轮回复",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.match(capture.persisted[1]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.notEqual(capture.persisted[0]?.id, capture.persisted[1]?.id);
});

test("runtime tool-call events persist and broadcast without stage log", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: unknown[] = [];
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "tool-call",
      toolCall: {
        id: "call-1",
        kind: "tool",
        title: "zhi",
        status: "running",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        input: "git branch --show-current",
        output: "main",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(logs, []);
  assert.equal(appendedToolCalls.length, 1);
  assert.deepEqual(capture.broadcasts, []);
  const toolCallBroadcast = capture.detailBroadcasts[0] as any;
  assert.equal(typeof toolCallBroadcast.params.update.toolCall.timelineSequence, "number");
  delete toolCallBroadcast.params.update.toolCall.timelineSequence;
  assert.deepEqual(capture.detailBroadcasts, [
    {
      sessionId: "session-1",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          kind: "tool_call",
          toolCall: {
            id: "call-1",
            kind: "tool",
            title: "zhi",
            status: "running",
            timestamp: "2026-04-30T00:00:01.000Z",
            updatedAt: "2026-04-30T00:00:01.000Z",
            input: "git branch --show-current",
            output: "main",
          },
        },
      },
    },
  ]);
});

test("runtime ACP thought chunks with generated ids stay in one thinking stream", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture, "session-thought-stream");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-thought-stream",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thought-stream-msg-alpha:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "先看 ACP ",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-thought-stream",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thought-stream-msg-beta:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "再对照 Zed",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(appendedToolCalls.length, 2);
  assert.equal(appendedToolCalls[0]?.id, appendedToolCalls[1]?.id);
  assert.match(appendedToolCalls[0]?.id ?? "", /^session-thought-stream-msg-\d{6}-\d{6}-.+:thinking$/u);
  assert.equal(capture.persisted.length, 0);
});

test("runtime thinking broadcasts deltas instead of persisted cumulative output", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-thinking-delta");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current
      ? {
          ...current,
          ...toolCall,
          output: `${current.output ?? ""}${toolCall.output ?? ""}`,
        }
      : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  handleRuntimeEvent(
    "session-thinking-delta",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thinking-delta-msg-a:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "A",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-thinking-delta",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thinking-delta-msg-b:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "B",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const broadcastOutputs = capture.detailBroadcasts.map(
    (item: any) => item.params.update.toolCall.output,
  );
  assert.deepEqual(broadcastOutputs, ["A", "B"]);
  assert.deepEqual([...storedById.values()].map((toolCall) => toolCall.output), ["AB"]);
});

test("runtime status completion finalizes active thinking stream", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-thinking-complete");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current
      ? {
          ...current,
          ...toolCall,
          output: `${current.output ?? ""}${toolCall.output ?? ""}`,
          timestamp: current.timestamp,
        }
      : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  handleRuntimeEvent(
    "session-thinking-complete",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thinking-complete-msg-a:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "A",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-thinking-complete",
    {
      type: "status",
      status: "idle",
      message: "ACP prompt completed",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const stored = [...storedById.values()];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.status, "completed");
  assert.equal(stored[0]?.output, "A");
  const finalBroadcast = capture.detailBroadcasts.at(-1) as any;
  assert.equal(finalBroadcast.method, "session/update");
  assert.equal(finalBroadcast.params.update.toolCall.status, "completed");
});

test("runtime tool-call broadcasts keep stronger persisted classifications", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => ({
    outputs: [],
    diffs: [],
    toolCalls: [
      {
        ...toolCall,
        kind: "mcp",
        title: "Tool: node_repl/js",
      },
    ],
  });

  handleRuntimeEvent(
    "session-1",
    {
      type: "tool-call",
      toolCall: {
        id: "call-1",
        kind: "tool",
        title: "Tool call call-1",
        status: "completed",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const classifiedToolCallBroadcast = capture.detailBroadcasts[0] as any;
  assert.equal(typeof classifiedToolCallBroadcast.params.update.toolCall.timelineSequence, "number");
  delete classifiedToolCallBroadcast.params.update.toolCall.timelineSequence;
  assert.deepEqual(capture.detailBroadcasts, [
    {
      sessionId: "session-1",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          kind: "tool_call",
          toolCall: {
            id: "call-1",
            kind: "mcp",
            title: "Tool: node_repl/js",
            status: "completed",
            timestamp: "2026-04-30T00:00:01.000Z",
            updatedAt: "2026-04-30T00:00:02.000Z",
          },
        },
      },
    },
  ]);
});

test("runtime timeline events carry arrival order when timestamps collide", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-timeline-order");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current ? { ...current, ...toolCall } : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  const timestamp = "2026-04-30T00:00:01.000Z";
  handleRuntimeEvent(
    "session-timeline-order",
    {
      type: "tool-call",
      toolCall: {
        id: "session-timeline-order-msg-a:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "先思考",
        timestamp,
        updatedAt: timestamp,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-timeline-order",
    {
      type: "tool-call",
      toolCall: {
        id: "call-shell",
        kind: "shell",
        title: "pnpm test",
        status: "completed",
        timestamp,
        updatedAt: timestamp,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-timeline-order",
    {
      type: "message",
      message: {
        id: "message-final",
        role: "assistant",
        text: "最后回复",
        timestamp,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineUpdates = capture.detailBroadcasts
    .map((item: any) => item.params.update)
    .filter((update: any) => update.kind === "tool_call" || update.kind === "agent_message");
  assert.deepEqual(
    timelineUpdates.map((update: any) =>
      update.kind === "tool_call" ? update.toolCall.timelineSequence : update.message.timelineSequence,
    ),
    [1, 2, 3],
  );
});

test("runtime non-streaming event logs keep existing tiller prefix", () => {
  const logs: string[] = [];
  const context = createTestContext(logs);

  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "running",
      message: "still working",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(logs.length, 1);
  assert.match(
    logs[0],
    /^\[tiller\] 阶段=运行状态流 seq=\d+ session=session-1 agent=opencode cwd=<stored> status=running message=still working$/,
  );
});

test("runtime command-output logs debug stream text", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedOutputs: unknown[] = [];
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendOutput = (_sessionId: string, chunk: CommandChunk) => {
    appendedOutputs.push(chunk);
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "command-output",
      chunk: {
        id: "chunk-1",
        commandId: "cmd-1",
        stream: "stdout",
        text: "SECRET_STREAM_TEXT\nwith details",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(logs.length, 1);
  assert.match(logs[0], /阶段=命令输出流/);
  assert.match(logs[0], /command=cmd-1/);
  assert.match(logs[0], /stream=stdout/);
  assert.match(logs[0], /chars=31/);
  assert.match(logs[0], /text=SECRET_STREAM_TEXT with details/);
  assert.doesNotMatch(logs[0], /preview=/);
  assert.equal(appendedOutputs.length, 1);
  assert.equal(capture.broadcasts.length, 0);
  assert.equal(capture.detailBroadcasts.length, 1);
});

test("runtime available-commands events persist commands on the session summary", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const updatedSummaries: SessionSummary[] = [];
  context.updateSessionSummary = (
    _sessionId: string,
    mutate: (current: SessionSummary) => SessionSummary,
  ) => {
    const current = context.sessionStore.list()[0] as SessionSummary;
    const updatedSummary = mutate(current);
    updatedSummaries.push(updatedSummary);
    return updatedSummary;
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "available-commands",
      commands: [{ name: "review" }, { name: "compact" }],
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    updatedSummaries[0]?.availableCommands?.map((command) => command.name),
    ["review", "compact"],
  );
  assert.deepEqual(
    capture.broadcasts.map((item: any) => item.params.update.kind),
    ["commands_available", "session_updated"],
  );
});

test("permission-request emits approval/created globally and skips session-topic permission_request", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  (context as any).approvalIndex = (context as any).permissionIndex;

  const request = {
    id: "approval-1",
    command: "Run shell command :: {}",
    reason: "需要审核",
    cwd: "D:/repo",
  };

  handleRuntimeEvent(
    "session-1",
    { type: "permission-request", request } satisfies SessionRuntimeEvent,
    context,
  );

  const broadcastMethods = capture.broadcasts.map((item: any) => item.method);
  const detailMethods = capture.detailBroadcasts.map((item: any) => item.method);

  assert.equal(broadcastMethods.includes("approval/created"), true);
  assert.equal(detailMethods.some((method) => method === "session/update"), false);
  assert.equal(context.approvalIndex.get("approval-1")?.sessionId, "session-1");
});

test("permission-request auto-resolves matching approval policy without broadcasting approval", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture);
  let responded: { requestId: string; decision: string } | null = null;
  const runtime = {
    supportsPermissionResponses: true,
    respondPermission: (requestId: string, decision: string) => {
      responded = { requestId, decision };
    },
  };
  context.sessions.set("session-1", {
    agent: { id: "codex" },
    worktree: { path: "D:/repo" },
    summary: { id: "session-1", agentId: "codex", projectId: "tiller" },
    runtime,
  } as any);
  (context as any).readApprovalPolicy = () => ({
    rules: [
      {
        id: "rule-1",
        action: "allow",
        label: "Allow sanshu",
        providerId: "codex",
        commandPattern: "^MCP • sanshu/",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
  });

  handleRuntimeEvent(
    "session-1",
    {
      type: "permission-request",
      request: {
        id: "approval-1",
        command: "MCP • sanshu/zhi :: {}",
        reason: "Approve MCP tool call",
        cwd: "D:/repo",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(responded, { requestId: "approval-1", decision: "allow" });
  assert.equal(context.approvalIndex.has("approval-1"), false);
  assert.equal(capture.broadcasts.some((item: any) => item.method === "approval/created"), false);
  // 自动审批必须保持状态不变，避免 running→waiting_for_permission→running 抖动
  assert.equal(capture.summaryUpdates?.length, 0);
});

test("permission-request falls back to manual approval when policy read fails", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  (context as any).readApprovalPolicy = () => {
    throw new Error("config read failed");
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "permission-request",
      request: {
        id: "approval-io-fallback",
        command: "MCP • sanshu/zhi :: {}",
        reason: "Approve MCP tool call",
        cwd: "D:/repo",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(context.approvalIndex.has("approval-io-fallback"), true);
  assert.equal(capture.broadcasts.some((item: any) => item.method === "approval/created"), true);
  assert.equal(logs.some((line) => line.includes("approval policy read failed")), true);
});
