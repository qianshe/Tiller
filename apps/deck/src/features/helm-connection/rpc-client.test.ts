import assert from "node:assert/strict";
import test from "node:test";
import { DeckRpcClient } from "./rpc-client.js";

type MessageHandler = (event: { data: string }) => void;

class FakeWebSocket {
  readonly sent: string[] = [];
  private messageHandlers = new Set<MessageHandler>();
  closed = false;

  addEventListener(event: string, handler: MessageHandler) {
    if (event === "message") {
      this.messageHandlers.add(handler);
    }
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.closed = true;
  }

  receive(value: string) {
    for (const handler of this.messageHandlers) {
      handler({ data: value });
    }
  }
}

test("DeckRpcClient sends JSON-RPC requests and resolves matching results", async () => {
  const socket = new FakeWebSocket();
  const client = new DeckRpcClient(
    socket as unknown as WebSocket,
    () => undefined,
    () => undefined,
  );

  const pending = client.request("helm/list", {});

  assert.deepEqual(socket.sent, [
    '{"jsonrpc":"2.0","id":1,"method":"helm/list","params":{}}',
  ]);

  socket.receive('{"jsonrpc":"2.0","id":1,"result":{"helms":[]}}');
  assert.deepEqual(await pending, { helms: [] });
});
