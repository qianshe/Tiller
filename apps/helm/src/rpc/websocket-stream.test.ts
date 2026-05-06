import assert from "node:assert/strict";
import test from "node:test";
import { createWebSocketJsonRpcStream } from "./websocket-stream";

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
