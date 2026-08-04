import assert from "node:assert/strict";
import test from "node:test";
import { DeckRpcClient, getRpcErrorDiagnostics } from "./rpc-client.js";

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

test("DeckRpcClient preserves notification context when a handler fails", async () => {
  const socket = new FakeWebSocket();
  let receivedError: unknown;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    new DeckRpcClient(
      socket as unknown as WebSocket,
      () => {
        throw new Error("Maximum update depth exceeded.");
      },
      (error) => {
        receivedError = error;
      },
    );

    socket.receive(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: { kind: "timeline_batch" },
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.error = originalConsoleError;
  }

  const diagnostics = getRpcErrorDiagnostics(receivedError);
  assert.equal(diagnostics?.phase, "notification-handler");
  assert.equal(diagnostics?.method, "session/update");
  assert.equal(diagnostics?.sessionId, "session-1");
  assert.equal(diagnostics?.updateKind, "timeline_batch");
  assert.equal(diagnostics?.errorName, "Error");
  assert.match(diagnostics?.errorStack ?? "", /Maximum update depth exceeded/);
});
