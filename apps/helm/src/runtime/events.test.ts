import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentToolCall, CommandChunk, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleRuntimeEvent } from "./events.js";

type TestContextCapture = {
  broadcasts: unknown[];
  persisted: AgentMessage[];
};

function createTestContext(
  logs: string[],
  capture: TestContextCapture = { broadcasts: [], persisted: [] },
): HelmHandlerContext {
  const summary: SessionSummary = {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project One",
    helmId: "helm-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace One",
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
          workspace: { id: "workspace-1" },
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
    ) => mutate(summary),
    broadcastNotification: (method: string, params: unknown) => {
      capture.broadcasts.push({ method, params });
    },
    permissionIndex: new Map(),
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
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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
  assert.equal(capture.persisted.length, 2);
  assert.deepEqual(
    capture.persisted.map((message) => message.text),
    ["你", "好\n主人"],
  );
  assert.equal(capture.broadcasts.length, 3);
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
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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
  assert.equal(appendedToolCalls.length, 1);
  assert.equal(appendedToolCalls[0]?.title, "ACP 用户回显");
  assert.equal(appendedToolCalls[0]?.input, "你好");
  assert.equal(capture.broadcasts.length, 1);
  assert.deepEqual((capture.broadcasts[0] as any).params.update.kind, "tool_call");
});

test("runtime wrapped user echoes are ignored when they contain the client prompt", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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
  assert.deepEqual(capture.broadcasts.map((item: any) => item.params.update.kind), ["tool_call"]);
});

test("runtime assistant chunks stay split when tool activity occurs between text streams", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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

  assert.deepEqual(
    capture.persisted.map((message) => [message.id, message.text]),
    [
      ["session-1-msg-s0", "工具前说明"],
      ["session-1-msg-s1", "工具后继续"],
    ],
  );
  assert.equal(appendedToolCalls.length, 1);
});

test("runtime tool-call events log explicit debug details and broadcast", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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

  assert.equal(logs.length, 1);
  assert.match(logs[0], /阶段=直播工具调用/);
  assert.match(logs[0], /tool=zhi/);
  assert.match(logs[0], /call=call-1/);
  assert.match(logs[0], /kind=tool/);
  assert.match(logs[0], /title=zhi/);
  assert.doesNotMatch(logs[0], /input=git branch --show-current/);
  assert.doesNotMatch(logs[0], /output=main/);
  assert.equal(appendedToolCalls.length, 1);
  assert.deepEqual(capture.broadcasts, [
    {
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

test("runtime tool-call stage log keeps frontend tool name", () => {
  const logs: string[] = [];
  const context = createTestContext(logs);
  context.logDebug = (message: string) => {
    logs.push(message);
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
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(logs.length, 1);
  assert.match(
    logs[0],
    /^\[tiller\] 阶段=直播工具调用 seq=\d+ session=session-1 agent=opencode workspace=workspace-1 tool=zhi status=running call=call-1 kind=tool title=zhi$/,
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
    /^\[tiller\] 阶段=运行状态流 seq=\d+ session=session-1 agent=opencode workspace=workspace-1 status=running message=still working$/,
  );
});

test("runtime command-output logs debug stream text", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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
  assert.equal(capture.broadcasts.length, 1);
});

test("runtime available-commands events persist commands on the session summary", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], persisted: [] };
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



