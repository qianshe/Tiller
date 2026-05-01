import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "./handlers/context";
import { handleRuntimeEvent } from "./runtime-events.js";

type TestContextCapture = {
  broadcasts: unknown[];
  persisted: AgentMessage[];
};

function createTestContext(logs: string[], capture: TestContextCapture = { broadcasts: [], persisted: [] }): HelmHandlerContext {
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
    sessions: new Map([["session-1", {
      agent: { id: "opencode" },
      workspace: { id: "workspace-1" },
      summary,
    }]]),
    sessionStore: { list: () => [summary] },
    logInfo: (message: string) => logs.push(message),
    logError: (message: string) => logs.push(message),
    persistSessionMessage: (_sessionId: string, message: AgentMessage) => { capture.persisted.push(message); },
    updateSessionSummary: (_sessionId: string, mutate: (current: SessionSummary) => SessionSummary) => mutate(summary),
    broadcastAuthenticated: (payload: unknown) => { capture.broadcasts.push(payload); },
    permissionIndex: new Map(),
    sessionArtifactStore: {
      appendOutput: () => undefined,
      appendToolCall: () => undefined,
    },
    publishDiffUpdate: async () => undefined,
    hydrateSessionSummary: (item: SessionSummary) => item,
  } as unknown as HelmHandlerContext;
}

test("runtime session.message writes streaming text chunks directly to stdout without metadata wrappers", () => {
  const logs: string[] = [];
  const context = createTestContext(logs);
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent("session-1", {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "你",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent, context);

    handleRuntimeEvent("session-1", {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "好\n主人",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent, context);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(logs, []);
  assert.deepEqual(writes, ["你", "好\n主人"]);
  assert.equal(writes.join(""), "你好\n主人");
});

test("runtime user echo messages are ignored because prompts are already persisted before sending", () => {
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
    handleRuntimeEvent("session-1", {
      type: "message",
      message: {
        id: "runtime-user-echo-1",
        role: "user",
        text: "你好",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent, context);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(logs, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(capture.persisted, []);
  assert.deepEqual(capture.broadcasts, []);
});

test("runtime non-streaming event logs keep existing tiller helm prefix", () => {
  const logs: string[] = [];
  const context = createTestContext(logs);

  handleRuntimeEvent("session-1", {
    type: "status",
    status: "running",
    message: "still working",
  } satisfies SessionRuntimeEvent, context);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[tiller-helm\] session\.status session=session-1 agent=opencode workspace=workspace-1 status=running message=still working$/);
});
