import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentToolCall, CommandChunk, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleRuntimeEvent } from "./events.js";
import { createLiveMessageBuffer } from "./live-message-buffer.js";

type TestContextCapture = {
  broadcasts: unknown[];
  detailBroadcasts: unknown[];
  persisted: AgentMessage[];
  summaryUpdates?: SessionSummary[];
};

function createTestContext(
  logs: string[],
  capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] },
): HelmHandlerContext {
  const summary: SessionSummary = {
    id: "session-1",
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
  };

  return {
    sessions: new Map([
      [
        "session-1",
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
    logError: (message: string) => logs.push(message),
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
    permissionIndex: new Map(),
    liveMessageBuffer: createLiveMessageBuffer(),
    sessionArtifactStore: {
      appendOutput: () => undefined,
      appendToolCall: () => undefined,
    },
    publishDiffUpdate: async () => undefined,
    hydrateSessionSummary: (item: SessionSummary) => item,
  } as unknown as HelmHandlerContext;
}

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
  assert.match(logs[0], /阶段=直播消息流开始 seq=\d+ .*role=assistant .*id=message-1/);
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
    capture.persisted.map((message) => [message.id, message.text]),
    [
      ["session-1-msg-s0", "工具前说明"],
      ["session-1-msg-s1", "工具后继续"],
    ],
  );
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

  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-s\d+$/u);
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
  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-s\d+$/u);
  assert.match(capture.persisted[1]?.id ?? "", /^session-1-msg-s\d+$/u);
  assert.notEqual(capture.persisted[0]?.id, capture.persisted[1]?.id);
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

  assert.match(capture.persisted[0]?.id ?? "", /^session-1-msg-s\d+$/u);
  assert.match(capture.persisted[1]?.id ?? "", /^session-1-msg-s\d+$/u);
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




