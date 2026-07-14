import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebSocketJsonRpcStream,
  WEBSOCKET_RESYNC_CLOSE_CODE,
} from "./websocket-stream";

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
