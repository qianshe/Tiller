import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentToolCall, CommandChunk, FileDiffSummary, SessionTimelineEntry } from "@tiller/shared";
import { createRestoreReplayBuffer } from "./replay-event-buffer.js";

function createStores() {
  const messages: AgentMessage[] = [];
  const toolCalls: AgentToolCall[] = [];
  const outputs: CommandChunk[] = [];
  let diffs: FileDiffSummary[] = [];
  let timelineEntries: SessionTimelineEntry[] = [];
  return {
    messages,
    toolCalls,
    outputs,
    get diffs() {
      return diffs;
    },
    get timelineEntries() {
      return timelineEntries;
    },
    context: {
      sessionMessageStore: {
        append: (_sessionId: string, message: AgentMessage) => {
          messages.push(message);
          return messages;
        },
      },
      sessionArtifactStore: {
        appendToolCall: (_sessionId: string, toolCall: AgentToolCall) => {
          const index = toolCalls.findIndex((item) => item.id === toolCall.id);
          if (index === -1) {
            toolCalls.push(toolCall);
          } else {
            toolCalls[index] = { ...toolCalls[index], ...toolCall };
          }
          return { outputs, diffs, toolCalls };
        },
        appendOutput: (_sessionId: string, chunk: CommandChunk) => {
          outputs.push(chunk);
          return { outputs, diffs, toolCalls };
        },
        replaceDiffs: (_sessionId: string, files: FileDiffSummary[]) => {
          diffs = files;
          return { outputs, diffs, toolCalls };
        },
      },
      sessionTimelineStore: {
        replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
          timelineEntries = entries;
          return entries;
        },
      },
      logInfo: (_message: string) => undefined,
    },
  };
}

test("restore replay buffer coalesces replay artifacts before flushing", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);
  const firstToolCall: SessionRuntimeEvent = {
    type: "tool-call",
    toolCall: {
      id: "call-1",
      kind: "shell",
      title: "pnpm test",
      status: "running",
      timestamp: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
    },
  };
  const finalToolCall: SessionRuntimeEvent = {
    type: "tool-call",
    toolCall: {
      id: "call-1",
      kind: "shell",
      title: "pnpm test",
      status: "completed",
      timestamp: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:01.000Z",
    },
  };
  const output: SessionRuntimeEvent = {
    type: "command-output",
    chunk: {
      id: "out-1",
      commandId: "cmd-1",
      stream: "stdout",
      text: "ok",
      timestamp: "2026-05-08T08:00:02.000Z",
    },
    toolCall: {
      id: "tool-cmd-1",
      kind: "shell",
      title: "cmd-1",
      status: "running",
      timestamp: "2026-05-08T08:00:02.000Z",
      updatedAt: "2026-05-08T08:00:02.000Z",
    },
  };
  const diff: SessionRuntimeEvent = {
    type: "diff-update",
    files: [{ path: "src/index.ts", status: "modified", additions: 1, deletions: 0 }],
  };

  buffer.add(firstToolCall);
  buffer.add(finalToolCall);
  buffer.add(output);
  buffer.add(diff);

  assert.deepEqual(buffer.snapshot(), {
    messages: [],
    toolCalls: [
      {
        ...firstToolCall.toolCall,
        input: undefined,
        output: undefined,
        status: "completed",
        updatedAt: "2026-05-08T08:00:01.000Z",
      },
      { ...output.toolCall, input: undefined, output: undefined },
    ],
    outputs: [output.chunk],
    diffs: diff.files,
  });
  assert.equal(stores.toolCalls.length, 0);
  assert.equal(stores.outputs.length, 0);

  const flushed = buffer.flush();

  assert.deepEqual(flushed, { messages: 0, toolCalls: 2, outputs: 1, diffs: 1 });
  assert.equal(stores.toolCalls.length, 2);
  assert.equal(stores.toolCalls[0]?.status, "completed");
  assert.equal(stores.outputs.length, 1);
  assert.deepEqual(stores.diffs, [
    { path: "src/index.ts", status: "modified", additions: 1, deletions: 0 },
  ]);
});

test("restore replay buffer keeps stronger tool-call classification across updates", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "tool-call",
    toolCall: {
      id: "call-1",
      kind: "mcp",
      title: "Tool: node_repl/js",
      status: "running",
      timestamp: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:00.000Z",
      input: JSON.stringify({ code: "nodeRepl.write('ok')", timeout_ms: 10000 }),
    },
  });
  buffer.add({
    type: "tool-call",
    toolCall: {
      id: "call-1",
      kind: "tool",
      title: "Tool call call-1",
      status: "completed",
      timestamp: "2026-05-08T08:00:01.000Z",
      updatedAt: "2026-05-08T08:00:01.000Z",
    },
  });

  assert.deepEqual(buffer.snapshot().toolCalls, [
    {
      id: "call-1",
      kind: "mcp",
      title: "Tool: node_repl/js",
      status: "completed",
      timestamp: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T08:00:01.000Z",
      input: JSON.stringify({ code: "nodeRepl.write('ok')", timeout_ms: 10000 }),
      output: undefined,
    },
  ]);
});

test("restore replay buffer persists ordered local timeline entries", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "message",
    message: {
      id: "user-1",
      role: "user",
      text: "恢复历史",
      timestamp: "2026-05-08T08:00:00.000Z",
      timelineSequence: 1,
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "第一段",
      timestamp: "2026-05-08T08:00:01.000Z",
      timelineSequence: 2,
    },
  });
  buffer.add({
    type: "tool-call",
    toolCall: {
      id: "tool-read",
      kind: "read",
      title: "Read",
      status: "completed",
      timestamp: "2026-05-08T08:00:02.000Z",
      updatedAt: "2026-05-08T08:00:02.000Z",
      timelineSequence: 3,
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "assistant-2",
      role: "assistant",
      text: "最终段",
      timestamp: "2026-05-08T08:00:03.000Z",
      timelineSequence: 4,
    },
  });

  buffer.flush();

  assert.deepEqual(
    stores.timelineEntries.map((entry) => [entry.kind, entry.id, entry.timelineSequence]),
    [
      ["user_message", "user-1", 1],
      ["assistant_message", "assistant-1", 2],
      ["tool_call", "tool:tool-read", 3],
      ["assistant_message", "assistant-2", 4],
    ],
  );
});

