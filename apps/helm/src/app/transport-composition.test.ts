import assert from "node:assert/strict";
import test from "node:test";
import type { HelmHandlerContext } from "../handlers/context";
import { createHelmRpcConnectionHandlers } from "./transport-composition";

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
