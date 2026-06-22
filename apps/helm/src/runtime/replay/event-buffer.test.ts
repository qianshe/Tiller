import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentPlan, AgentToolCall, CommandChunk, FileDiffSummary, SessionTimelineEntry, SessionUpdateRecord } from "@tiller/shared";
import { createRestoreReplayBuffer, hasRestoreReplayContent } from "./event-buffer.js";

function createStores() {
  const messages: AgentMessage[] = [];
  const toolCalls: AgentToolCall[] = [];
  const outputs: CommandChunk[] = [];
  let sessionUpdates: SessionUpdateRecord[] = [];
  let diffs: FileDiffSummary[] = [];
  let timelineEntries: SessionTimelineEntry[] = [];
  return {
    messages,
    toolCalls,
    outputs,
    get sessionUpdates() {
      return sessionUpdates;
    },
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
      sessionUpdateStore: {
        replaceSession: (_sessionId: string, updates: SessionUpdateRecord[]) => {
          sessionUpdates = updates;
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
        timelineSequence: 1,
        updatedAt: "2026-05-08T08:00:01.000Z",
      },
      { ...output.toolCall, input: undefined, output: undefined, timelineSequence: 2 },
    ],
    outputs: [{ ...output.chunk, timelineSequence: 2 }],
    diffs: diff.files,
  });
  assert.equal(stores.toolCalls.length, 0);
  assert.equal(stores.outputs.length, 0);

  const flushed = buffer.flush();

  assert.deepEqual(flushed, { messages: 0, toolCalls: 2, outputs: 1, diffs: 1, plans: 0 });
  assert.equal(stores.toolCalls.length, 2);
  assert.equal(stores.toolCalls[0]?.status, "completed");
  assert.equal(stores.outputs.length, 1);
  assert.deepEqual(stores.diffs, [
    { path: "src/index.ts", status: "modified", additions: 1, deletions: 0 },
  ]);
});

test("restore replay buffer content detection ignores empty flushes", () => {
  assert.equal(
    hasRestoreReplayContent({ messages: 0, toolCalls: 0, outputs: 0, diffs: 0, plans: 0 }),
    false,
  );
  assert.equal(
    hasRestoreReplayContent({ messages: 1, toolCalls: 0, outputs: 0, diffs: 0, plans: 0 }),
    true,
  );
  assert.equal(
    hasRestoreReplayContent({ messages: 0, toolCalls: 0, outputs: 0, diffs: 1, plans: 0 }),
    true,
  );
  assert.equal(
    hasRestoreReplayContent({ messages: 0, toolCalls: 0, outputs: 0, diffs: 0, plans: 1 }),
    true,
  );
});

test("restore replay buffer preserves ACP plan updates", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);
  const plan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [
      { content: "确认恢复 plan", priority: "high", status: "completed" },
      { content: "继续验证 UI", priority: "medium", status: "in_progress" },
    ],
  };

  buffer.add({ type: "plan-update", plan });

  assert.deepEqual(buffer.snapshot().plan, plan);
  const flushed = buffer.flush();

  assert.deepEqual(flushed, { messages: 0, toolCalls: 0, outputs: 0, diffs: 0, plans: 1 });
  assert.deepEqual(
    stores.sessionUpdates.map((update) => [update.sequence, update.updateType]),
    [[1, "plan-update"]],
  );
  assert.deepEqual(stores.timelineEntries, []);
});

test("restore replay buffer preserves user and assistant messages when replay ids collide", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "message",
    message: {
      id: "replay-msg",
      role: "user",
      text: "我想做个你的进度状态测试",
      timestamp: "2026-05-08T08:00:00.000Z",
      timelineSequence: 1,
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "replay-msg",
      role: "assistant",
      text: "已模拟一个未全部完成的进度 plan",
      timestamp: "2026-05-08T08:00:01.000Z",
      timelineSequence: 2,
    },
  });

  const flushed = buffer.flush();

  assert.equal(flushed.messages, 2);
  assert.deepEqual(
    stores.messages.map((message) => [message.role, message.text]),
    [
      ["user", "我想做个你的进度状态测试"],
      ["assistant", "已模拟一个未全部完成的进度 plan"],
    ],
  );
  assert.deepEqual(
    stores.timelineEntries.map((entry) => [entry.kind, (entry as any).timelineSequence]),
    [
      ["user_message", 1],
      ["assistant_message", 2],
    ],
  );
});

test("restore replay buffer gives colliding unsequenced message roles distinct timeline slots", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "message",
    message: {
      id: "replay-msg",
      role: "user",
      text: "用户历史消息",
      timestamp: "2026-05-08T08:00:00.000Z",
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "replay-msg",
      role: "assistant",
      text: "助手历史消息",
      timestamp: "2026-05-08T08:00:01.000Z",
    },
  });

  buffer.flush();

  assert.deepEqual(
    stores.timelineEntries.map((entry) => [entry.kind, entry.id, (entry as any).timelineSequence]),
    [
      ["user_message", "replay-msg", 1],
      ["assistant_message", "replay-msg:assistant", 2],
    ],
  );
});

test("restore replay buffer keeps replayed user prompts before their assistant responses without sequences", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "message",
    message: {
      id: "runtime-session-msg-100",
      role: "user",
      text: "帮我在当前项目中创建一个对应Git worktree 用来测试",
      timestamp: "2026-06-07T07:25:37.507Z",
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "runtime-session-msg-101",
      role: "assistant",
      text: "测试用 Git worktree 已创建完成",
      timestamp: "2026-06-07T07:25:37.525Z",
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "runtime-session-msg-200",
      role: "user",
      text: "我想做个你的进度状态测试，帮我模拟一个进度plan，然后不用全部完成",
      timestamp: "2026-06-07T07:25:37.642Z",
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "runtime-session-msg-201",
      role: "assistant",
      text: "已模拟一个未全部完成的进度 plan",
      timestamp: "2026-06-07T07:25:37.705Z",
    },
  });

  buffer.flush();

  assert.deepEqual(
    stores.timelineEntries.map((entry) => [entry.kind, entry.timestamp]),
    [
      ["user_message", "2026-06-07T07:25:37.507Z"],
      ["assistant_message", "2026-06-07T07:25:37.525Z"],
      ["user_message", "2026-06-07T07:25:37.642Z"],
      ["assistant_message", "2026-06-07T07:25:37.705Z"],
    ],
  );
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
      timelineSequence: 1,
    },
  ]);
});

test("restore replay buffer assigns timeline order when replay timestamps are collapsed", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "message",
    message: {
      id: "user-1",
      role: "user",
      text: "重导入历史",
      timestamp: "2026-06-07T13:09:18.204Z",
    },
  });
  buffer.add({
    type: "tool-call",
    toolCall: {
      id: "tool-1",
      kind: "shell",
      title: "git status --short",
      status: "completed",
      timestamp: "2026-06-07T13:09:18.207Z",
      updatedAt: "2026-06-07T13:09:18.207Z",
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "工具后继续输出",
      timestamp: "2026-06-07T13:09:18.206Z",
    },
  });

  buffer.flush();

  assert.deepEqual(
    stores.timelineEntries.map((entry) => [entry.kind, entry.id, (entry as any).timelineSequence]),
    [
      ["user_message", "user-1", 1],
      ["tool_call", "tool:tool-1", 2],
      ["assistant_message", "assistant-1", 3],
    ],
  );
  assert.deepEqual(
    stores.sessionUpdates.map((update) => [update.source, update.sequence, update.updateType]),
    [
      ["acp_load_replay", 1, "message"],
      ["acp_load_replay", 2, "tool-call"],
      ["acp_load_replay", 3, "message"],
    ],
  );
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
    stores.timelineEntries.map((entry) => [entry.kind, entry.id, (entry as any).timelineSequence]),
    [
      ["user_message", "user-1", 1],
      ["assistant_message", "assistant-1", 2],
      ["tool_call", "tool:tool-read", 3],
      ["assistant_message", "assistant-2", 4],
    ],
  );
});

test("restore replay buffer splits same assistant id content around tools as separate timeline entries", () => {
  const stores = createStores();
  const buffer = createRestoreReplayBuffer("session-1", stores.context);

  buffer.add({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "工具前说明。",
      timestamp: "2026-05-08T08:00:01.000Z",
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
    },
  });
  buffer.add({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "工具后继续。",
      timestamp: "2026-05-08T08:00:03.000Z",
    },
  });

  buffer.flush();

  assert.deepEqual(
    stores.sessionUpdates.map((update) => [update.sequence, update.updateType]),
    [
      [1, "message"],
      [2, "tool-call"],
      [3, "message"],
    ],
  );
  assert.deepEqual(
    stores.timelineEntries.map((entry) => [entry.kind, entry.id, (entry as any).timelineSequence]),
    [
      ["assistant_message", "assistant-1", 1],
      ["tool_call", "tool:tool-read", 2],
      ["assistant_message", "assistant-1#p1", 3],
    ],
  );
  const assistantEntry = stores.timelineEntries.find((entry) => entry.id === "assistant-1");
  const secondAssistantEntry = stores.timelineEntries.find((entry) => entry.id === "assistant-1#p1");
  assert.deepEqual(
    assistantEntry?.kind === "assistant_message"
      ? assistantEntry.chunks.map((chunk) => [chunk.kind, chunk.text, chunk.timelineSequence])
      : [],
    [
      ["content", "工具前说明。", 1],
    ],
  );
  assert.deepEqual(
    secondAssistantEntry?.kind === "assistant_message"
      ? secondAssistantEntry.chunks.map((chunk) => [chunk.kind, chunk.text, chunk.timelineSequence])
      : [],
    [
      ["content", "工具后继续。", 3],
    ],
  );
});
