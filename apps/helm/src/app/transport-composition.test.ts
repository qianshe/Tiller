import assert from "node:assert/strict";
import test from "node:test";
import type { HelmHandlerContext } from "../handlers/context";
import {
  attachHelmRpcConnection,
  createHelmOutboundConnectionRegistry,
  createHelmRpcConnectionHandlers,
} from "./transport-composition";

test("createHelmRpcConnectionHandlers binds current socket context to RPC handlers", async () => {
  const calls: Array<{ kind: string; socketId?: string; method: string; params: unknown }> = [];
  let socketId = "socket-a";
  const handlers = createHelmRpcConnectionHandlers({
    getSocketId: () => socketId,
    createHandlerContext: (currentSocketId) => ({ socketId: currentSocketId }) as HelmHandlerContext,
    handleRequest: async (method, params, context) => {
      calls.push({ kind: "request", socketId: context.socketId, method, params });
      return { ok: true };
    },
    handleNotification: async (method, params, context) => {
      calls.push({ kind: "notification", socketId: context.socketId, method, params });
    },
    logError: () => undefined,
  });

  assert.deepEqual(await handlers.onRequest("sessions/list", { limit: 1 }), { ok: true });
  socketId = "socket-b";
  await handlers.onNotification("sessions/subscribe", { sessionId: "session-1" });

  assert.deepEqual(calls, [
    {
      kind: "request",
      socketId: "socket-a",
      method: "sessions/list",
      params: { limit: 1 },
    },
    {
      kind: "notification",
      socketId: "socket-b",
      method: "sessions/subscribe",
      params: { sessionId: "session-1" },
    },
  ]);
});

test("createHelmRpcConnectionHandlers logs notification handler failures", () => {
  const errors: string[] = [];
  const handlers = createHelmRpcConnectionHandlers({
    getSocketId: () => "socket-a",
    createHandlerContext: (socketId) => ({ socketId }) as HelmHandlerContext,
    handleRequest: async () => undefined,
    handleNotification: async () => undefined,
    logError: (message) => errors.push(message),
  });

  handlers.onError?.(new Error("boom"));

  assert.deepEqual(errors, ["[tiller] json-rpc handler failed: boom"]);
});

test("outbound connection registry routes notifications and session cleanup by socket", () => {
  const calls: string[] = [];
  const registry = createHelmOutboundConnectionRegistry();
  registry.add("socket-1", {
    notify: (method, params) => calls.push(`notify:${method}:${JSON.stringify(params)}`),
    clearSession: (sessionId) => calls.push(`clear:${sessionId}`),
  });

  registry.notify("socket-1", "session/update", { sessionId: "session-1" });
  registry.clearSession("socket-1", "session-1");
  registry.remove("socket-1");
  registry.notify("socket-1", "ignored", {});

  assert.deepEqual(calls, [
    'notify:session/update:{"sessionId":"session-1"}',
    "clear:session-1",
  ]);
  assert.equal(registry.has("socket-1"), false);
});

test("attached connection routes server notifications through its websocket stream", () => {
  const sent: string[] = [];
  let closeHandler: (() => void) | undefined;
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(value: string) { sent.push(value); },
    on() { return this; },
    off() { return this; },
    once(event: string, handler: () => void) {
      if (event === "close") closeHandler = handler;
      return this;
    },
    close() {},
  } as any;
  const outboundConnections = createHelmOutboundConnectionRegistry();

  attachHelmRpcConnection({
    socket,
    getSocketId: () => "socket-1",
    outboundConnections,
    createHandlerContext: () => ({}) as HelmHandlerContext,
    logError: () => undefined,
  });
  outboundConnections.notify("socket-1", "session/update", {
    sessionId: "session-1",
    update: {
      kind: "timeline_batch",
      batch: { replace: false, deliverySequence: 99, lastSequence: 1, entries: [] },
    },
  });

  assert.equal(JSON.parse(sent[0]!).params.update.batch.deliverySequence, 1);
  closeHandler?.();
  assert.equal(outboundConnections.has("socket-1"), false);
});
