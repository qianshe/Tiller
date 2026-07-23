import assert from "node:assert/strict";
import test from "node:test";
import { createNoopProtocolLogSink } from "./protocol-logging";
import { createRuntimeClientMethods } from "./runtime-client-methods";
import type { SessionRuntimeEvent } from "./runtime-types";

test("runtime client methods suppress OpenCode count-only todo updates", async () => {
  const events: SessionRuntimeEvent[] = [];
  const client = createRuntimeClientMethods({
    options: {
      sessionId: "local-session",
      worktree: { name: "Worktree", path: "D:/repo" },
      agent: {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        transport: "stdio",
        protocol: "acp",
      },
      onEvent: (event) => events.push(event),
    },
    launchCwd: "D:/repo",
    childEnv: {},
    protocolLog: createNoopProtocolLogSink(),
    terminals: new Map(),
    pendingPermissionReplies: new Map(),
    getSessionToken: () => "runtime-session",
    setCurrentConfigOptions: () => undefined,
    nextPermissionRequestId: (prefix) => `${prefix}-1`,
    nextTerminalId: () => "terminal-1",
  });

  await client.sessionUpdate({
    sessionId: "runtime-session",
    update: {
      sessionUpdate: "tool_call_update",
      toolCall: {
        id: "todo-count",
        tool: "todowrite",
        title: "0 todos",
        status: "completed",
      },
    },
  });

  assert.deepEqual(events, []);
});

test("runtime client methods emit a mapped command batch in canonical order", async () => {
  const events: SessionRuntimeEvent[] = [];
  const client = createRuntimeClientMethods({
    options: {
      sessionId: "local-session",
      worktree: { name: "Worktree", path: "D:/repo" },
      agent: {
        id: "generic",
        name: "Generic",
        command: "agent",
        transport: "stdio",
        protocol: "acp",
      },
      onEvent: (event) => events.push(event),
    },
    launchCwd: "D:/repo",
    childEnv: {},
    protocolLog: createNoopProtocolLogSink(),
    terminals: new Map(),
    pendingPermissionReplies: new Map(),
    getSessionToken: () => "runtime-session",
    setCurrentConfigOptions: () => undefined,
    nextPermissionRequestId: (prefix) => `${prefix}-1`,
    nextTerminalId: () => "terminal-1",
  });

  await client.sessionUpdate({
    sessionId: "runtime-session",
    update: {
      type: "command_output",
      commandId: "command-1",
      stream: "stdout",
      output: "done",
    },
  });

  assert.deepEqual(events.map((event) => event.type), [
    "tool-call",
    "command-output",
  ]);
});
