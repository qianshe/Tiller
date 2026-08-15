import assert from "node:assert/strict";
import test from "node:test";
import { JsonRpcConnection, isRequestTimeoutError, type Stream } from "./connection";
import type { JsonRpcMessage } from "./envelope";
import { ErrorCode, rpcError } from "./errors";

function createLinkedStreams() {
  const leftHandlers = new Set<(message: JsonRpcMessage) => void>();
  const rightHandlers = new Set<(message: JsonRpcMessage) => void>();
  const left: Stream = {
    send(message) { for (const handler of rightHandlers) handler(message); },
    onMessage(handler) { leftHandlers.add(handler); return () => leftHandlers.delete(handler); },
    close() { leftHandlers.clear(); },
  };
  const right: Stream = {
    send(message) { for (const handler of leftHandlers) handler(message); },
    onMessage(handler) { rightHandlers.add(handler); return () => rightHandlers.delete(handler); },
    close() { rightHandlers.clear(); },
  };
  return { left, right };
}

test("request/response resolves through linked streams", async () => {
  const { left, right } = createLinkedStreams();
  const server = new JsonRpcConnection(right, {
    onRequest: async (method, params) => ({ method, params }),
    onNotification: async () => undefined,
  });
  const client = new JsonRpcConnection(left, {
    onRequest: async () => ({}),
    onNotification: async () => undefined,
  });
  const result = await client.request("helm/list", { ping: true });
  assert.deepEqual(result, { method: "helm/list", params: { ping: true } });
  client.close();
  server.close();
});

test("notifications dispatch without responses", async () => {
  const { left, right } = createLinkedStreams();
  const seen: string[] = [];
  const server = new JsonRpcConnection(right, {
    onRequest: async () => ({}),
    onNotification: async (method) => { seen.push(method); },
  });
  const client = new JsonRpcConnection(left, {
    onRequest: async () => ({}),
    onNotification: async () => undefined,
  });
  client.notify("session/cancel", { sessionId: "s1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, ["session/cancel"]);
  client.close();
  server.close();
});

test("server-thrown error response rejects client request", async () => {
  const { left, right } = createLinkedStreams();
  const server = new JsonRpcConnection(right, {
    onRequest: async () => {
      throw rpcError(ErrorCode.SessionNotFound, "Session not found");
    },
    onNotification: async () => undefined,
  });
  const client = new JsonRpcConnection(left, {
    onRequest: async () => ({}),
    onNotification: async () => undefined,
  });
  await assert.rejects(() => client.request("session/prompt", {
    sessionId: "missing",
    text: "hi",
  }), (err: unknown) => {
    return (err as { code?: number }).code === ErrorCode.SessionNotFound;
  });
  client.close();
  server.close();
});

test("close rejects pending requests", async () => {
  const { left, right } = createLinkedStreams();
  const server = new JsonRpcConnection(right, {
    onRequest: () => new Promise(() => undefined),
    onNotification: async () => undefined,
  });
  const client = new JsonRpcConnection(left, {
    onRequest: async () => ({}),
    onNotification: async () => undefined,
  });
  const pending = client.request("session/prompt", { sessionId: "s1", text: "hi" });
  client.close();
  await assert.rejects(() => pending);
  server.close();
});

test("request timeouts are identifiable so callers can tell silence from an answer", async () => {
  // 服务端答复了错误 = 链路是通的;只有完全没有回应才说明连接已死。
  // 存活探测必须能区分这两者,否则一次鉴权拒绝就会被当成断线。
  const answered = rpcError(ErrorCode.InvalidRequest, "Helm not authenticated yet.");
  assert.equal(isRequestTimeoutError(answered), false);

  const stream = {
    send: () => undefined,
    onMessage: () => () => undefined,
    close: () => undefined,
  };
  const connection = new JsonRpcConnection(stream, {
    onRequest: async () => undefined,
    onNotification: () => undefined,
  });

  await assert.rejects(
    connection.request("helm/list", {}, { timeoutMs: 1 }),
    (error: unknown) => {
      assert.equal(isRequestTimeoutError(error), true);
      return true;
    },
  );
});
