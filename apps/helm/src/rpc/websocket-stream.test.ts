import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebSocketJsonRpcStream,
  WEBSOCKET_RESYNC_CLOSE_CODE,
} from "./websocket-stream";

function timelineUpdate(
  sessionId: string,
  entries: unknown[],
  options: { replace?: boolean; deliverySequence?: number } = {},
) {
  return {
    jsonrpc: "2.0" as const,
    method: "session/update",
    params: {
      sessionId,
      update: {
        kind: "timeline_batch",
        batch: {
          replace: options.replace ?? false,
          deliverySequence: options.deliverySequence ?? 99,
          lastSequence: 1,
          entries,
        },
      },
    },
  };
}

function decodeMessages(sent: string[]) {
  return sent.map((message) => JSON.parse(message));
}

test("websocket stream encodes outbound JSON-RPC messages", () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    send(value: string) {
      sent.push(value);
    },
    on() {
      return this;
    },
    off() {
      return this;
    },
    close() {},
  } as any;

  const stream = createWebSocketJsonRpcStream(socket, () => undefined);
  stream.send({ jsonrpc: "2.0", id: 1, result: { ok: true } });

  assert.deepEqual(sent, ['{"jsonrpc":"2.0","id":1,"result":{"ok":true}}']);
});

test("websocket stream replies with parse error for invalid frames", () => {
  const sent: string[] = [];
  let messageHandler: ((raw: unknown) => void) | undefined;
  const socket = {
    readyState: 1,
    send(value: string) {
      sent.push(value);
    },
    on(event: string, handler: (raw: unknown) => void) {
      if (event === "message") messageHandler = handler;
      return this;
    },
    off() {
      return this;
    },
    close() {},
  } as any;

  createWebSocketJsonRpcStream(socket, () => undefined);
  messageHandler?.("{");

  assert.match(sent[0] ?? "", /"code":-32700/);
});

test("websocket stream coalesces streaming entities above soft high-water", async () => {
  const sent: string[] = [];
  let coalesced = 0;
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
    onCoalesced: (count) => { coalesced += count; },
  });
  const update = (text: string) => ({
    jsonrpc: "2.0" as const,
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "agent_message",
        streaming: true,
        message: { id: "m1", text },
      },
    },
  });

  stream.send(update("a") as any);
  stream.send(update("ab") as any);
  assert.equal(sent.length, 0);
  assert.equal(coalesced, 1);

  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.length, 1);
  assert.equal((sent[0] ?? "").includes('"text":"ab"'), true);
});

test("websocket stream preserves append-only deltas above soft high-water", () => {
  const sent: string[] = [];
  let coalesced = 0;
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    onCoalesced: (count) => { coalesced += count; },
  });
  const update = (text: string) => ({
    jsonrpc: "2.0" as const,
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "agent_message",
        streaming: true,
        message: { id: "m1", text, streamMode: "delta" },
      },
    },
  });

  stream.send(update("a") as any);
  stream.send(update("b") as any);

  const messages = decodeMessages(sent);
  assert.equal(coalesced, 0);
  assert.deepEqual(
    messages.map((message) => [
      message.params.update.message.text,
      message.params.update.message.streamMode,
    ]),
    [["a", "delta"], ["b", "delta"]],
  );
});

test("websocket stream coalesces subagent entries by identity and sends latest sequences in order", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });
  const update = (entryId: string, sequence: number, text: string) => ({
    jsonrpc: "2.0" as const,
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "subagent_detail",
        delta: {
          sessionId: "s1",
          parentToolCallId: "root-1",
          batch: {
            replace: false,
            deliverySequence: sequence,
            lastSequence: sequence,
            entries: [{
              id: entryId,
              kind: "assistant_message",
              chunks: [{
                id: `${entryId}:content`,
                kind: "content",
                text,
                timestamp: "2026-07-22T00:00:00.000Z",
                sequence,
              }],
              timestamp: "2026-07-22T00:00:00.000Z",
              updatedAt: "2026-07-22T00:00:00.000Z",
              sequence,
            }],
          },
        },
      },
    },
  });

  stream.send(update("reply-a", 1, "old") as any);
  stream.send(update("reply-b", 2, "second") as any);
  stream.send(update("reply-a", 3, "latest") as any);
  assert.equal(sent.length, 0);

  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const messages = decodeMessages(sent);
  assert.deepEqual(
    messages.map((message) => message.params.update.delta.batch.lastSequence),
    [2, 3],
  );
  assert.deepEqual(
    messages.map((message) => message.params.update.delta.batch.entries[0].chunks[0].text),
    ["second", "latest"],
  );
  stream.close();
});

test("websocket stream encodes one message object once before repeated sends", () => {
  const sent: string[] = [];
  let encodes = 0;
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    onEncoded: () => { encodes += 1; },
  });
  const message = { jsonrpc: "2.0" as const, id: 1, result: { ok: true } };

  stream.send(message);
  stream.send(message);

  assert.equal(encodes, 1);
  assert.equal(sent.length, 2);
});

test("websocket stream coalesces live state by session and retains the latest sequence", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });
  const liveState = (sequence: number) => ({
    jsonrpc: "2.0" as const,
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "live_state",
        snapshot: { sequence, status: { effectiveStatus: "running" } },
      },
    },
  });

  stream.send(liveState(2) as any);
  stream.send(liveState(3) as any);
  stream.send(liveState(1) as any);
  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /"sequence":3/u);
});

test("websocket stream preserves terminal updates above soft high-water", () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
  });

  stream.send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "tool_call",
        toolCall: { id: "t1", status: "completed" },
      },
    },
  } as any);

  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /completed/u);
});

test("websocket stream closes with resync code above hard high-water", () => {
  const closes: Array<{ code: number; reason: string }> = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 10,
    send() {},
    on() { return this; },
    off() { return this; },
    close(code: number, reason: string) { closes.push({ code, reason }); },
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
  });

  stream.send({ jsonrpc: "2.0", id: 1, result: { ok: true } });

  assert.deepEqual(closes, [{
    code: WEBSOCKET_RESYNC_CLOSE_CODE,
    reason: "Resync required: send buffer overflow",
  }]);
});

test("timeline delivery revisions are continuous per session on one connection", () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined);

  stream.send(timelineUpdate("a", [{ id: "a-1", kind: "user_message" }]) as any);
  stream.send(timelineUpdate("b", [{ id: "b-1", kind: "user_message" }]) as any);
  stream.send(timelineUpdate("a", [{ id: "a-2", kind: "user_message" }]) as any);
  stream.send(timelineUpdate("b", [{ id: "b-2", kind: "user_message" }]) as any);

  assert.deepEqual(
    decodeMessages(sent).map((message) => [
      message.params.sessionId,
      message.params.update.batch.deliverySequence,
    ]),
    [["a", 1], ["b", 1], ["a", 2], ["b", 2]],
  );
});

test("two connections stamp independent revisions on the same logical batch", () => {
  const firstSent: string[] = [];
  const secondSent: string[] = [];
  const createSocket = (sent: string[]) => ({
    readyState: 1,
    bufferedAmount: 0,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  }) as any;
  const first = createWebSocketJsonRpcStream(createSocket(firstSent), () => undefined);
  const second = createWebSocketJsonRpcStream(createSocket(secondSent), () => undefined);
  const shared = timelineUpdate("session-1", [{ id: "m1", kind: "user_message" }]);

  first.send(shared as any);
  first.send(shared as any);
  second.send(shared as any);

  assert.deepEqual(
    decodeMessages(firstSent).map((message) => message.params.update.batch.deliverySequence),
    [1, 2],
  );
  assert.deepEqual(
    decodeMessages(secondSent).map((message) => message.params.update.batch.deliverySequence),
    [1],
  );
  assert.equal(shared.params.update.batch.deliverySequence, 99);
});

test("coalesced timeline updates allocate a revision only when flushed", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });
  const streaming = (text: string) => timelineUpdate("session-1", [{
    id: "assistant-1",
    kind: "assistant_message",
    streaming: true,
    chunks: [{ kind: "content", text, streaming: true }],
  }]);

  stream.send(streaming("a") as any);
  stream.send(streaming("ab") as any);
  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));

  const messages = decodeMessages(sent);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].params.update.batch.deliverySequence, 1);
  assert.equal(messages[0].params.update.batch.entries[0].chunks[0].text, "ab");
});

test("mixed required and streaming fragments receive revisions in actual send order", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });

  stream.send(timelineUpdate("session-1", [
    { id: "user-1", kind: "user_message" },
    {
      id: "assistant-1",
      kind: "assistant_message",
      streaming: true,
      chunks: [{ kind: "content", text: "working", streaming: true }],
    },
  ]) as any);
  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));

  const messages = decodeMessages(sent);
  assert.deepEqual(
    messages.map((message) => [
      message.params.update.batch.entries[0].id,
      message.params.update.batch.deliverySequence,
    ]),
    [["user-1", 1], ["assistant-1", 2]],
  );
});

test("coalescing keys isolate equal entity ids across sessions", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });
  const streaming = (sessionId: string, text: string) => timelineUpdate(sessionId, [{
    id: "assistant-1",
    kind: "assistant_message",
    streaming: true,
    chunks: [{ kind: "content", text, streaming: true }],
  }]);

  stream.send(streaming("a", "from-a") as any);
  stream.send(streaming("b", "from-b") as any);
  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(
    decodeMessages(sent).map((message) => [
      message.params.sessionId,
      message.params.update.batch.deliverySequence,
      message.params.update.batch.entries[0].chunks[0].text,
    ]),
    [["a", 1, "from-a"], ["b", 1, "from-b"]],
  );
});

test("terminal timeline entity removes an older pending running entity", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });

  stream.send(timelineUpdate("session-1", [{
    id: "tool:1",
    kind: "tool_call",
    toolCall: { id: "1", status: "running" },
  }]) as any);
  stream.send(timelineUpdate("session-1", [{
    id: "tool:1",
    kind: "tool_call",
    toolCall: { id: "1", status: "completed" },
  }]) as any);
  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));

  const messages = decodeMessages(sent);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].params.update.batch.deliverySequence, 1);
  assert.equal(messages[0].params.update.batch.entries[0].toolCall.status, "completed");
});

test("replace timeline snapshot stays atomic and clears pending session fragments", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 3,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined, {
    softHighWaterBytes: 2,
    hardHighWaterBytes: 10,
    retryDelayMs: 1,
  });

  stream.send(timelineUpdate("session-1", [{
    id: "assistant-pending",
    kind: "assistant_message",
    streaming: true,
    chunks: [{ kind: "content", text: "pending", streaming: true }],
  }]) as any);
  stream.send(timelineUpdate("session-1", [
    { id: "user-1", kind: "user_message" },
    { id: "assistant-1", kind: "assistant_message", chunks: [] },
  ], { replace: true }) as any);
  socket.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 10));

  const messages = decodeMessages(sent);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].params.update.batch.replace, true);
  assert.equal(messages[0].params.update.batch.entries.length, 2);
  assert.equal(messages[0].params.update.batch.deliverySequence, 1);
});

test("clearing a session lane removes pending fragments and resets its revision", async () => {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    close() {},
  } as any;
  const stream = createWebSocketJsonRpcStream(socket, () => undefined);

  stream.send(timelineUpdate("session-1", [{ id: "first", kind: "user_message" }]) as any);
  stream.clearSession("session-1");
  stream.send(timelineUpdate("session-1", [{ id: "second", kind: "user_message" }]) as any);

  assert.deepEqual(
    decodeMessages(sent).map((message) => message.params.update.batch.deliverySequence),
    [1, 1],
  );
});
