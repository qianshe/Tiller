import assert from "node:assert/strict";
import test from "node:test";
import { dispatchWithTrace, requestInitialSync } from "./request-dispatch.js";

test("dispatchWithTrace sends JSON-RPC requests and applies result callbacks", async () => {
  const requested: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown) => {
      requested.push({ method, params });
      return { helms: [] };
    },
    notify: () => undefined,
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;
  const results: Array<{ method: string; result: unknown }> = [];

  await dispatchWithTrace(
    client as any,
    "helm/list",
    {},
    (updater) => {
      trace = updater(trace);
    },
    (method, result) => results.push({ method, result }),
  );

  assert.deepEqual(requested, [{ method: "helm/list", params: {} }]);
  assert.deepEqual(results, [{ method: "helm/list", result: { helms: [] } }]);
  assert.equal(trace.requestsSent, 1);
  assert.equal(trace.lastRequestType, "helm/list");
});

test("dispatchWithTrace gives model option probes a longer timeout", async () => {
  const requested: Array<{ method: string; params: unknown; options: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown, options?: unknown) => {
      requested.push({ method, params, options });
      return { ok: true };
    },
    notify: () => undefined,
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  await dispatchWithTrace(
    client as any,
    "agent/get_model_options",
    { providerId: "opencode", workspaceId: "main" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [
    {
      method: "agent/get_model_options",
      params: { providerId: "opencode", workspaceId: "main" },
      options: { timeoutMs: 120_000 },
    },
  ]);
  assert.equal(trace.lastRequestType, "agent/get_model_options");
});

test("dispatchWithTrace gives session creation a longer timeout", async () => {
  const requested: Array<{ method: string; params: unknown; options: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown, options?: unknown) => {
      requested.push({ method, params, options });
      return { session: { id: "s1" } };
    },
    notify: () => undefined,
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  await dispatchWithTrace(
    client as any,
    "session/new",
    { projectId: "p1", workspaceId: "w1", agentId: "opencode" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [
    {
      method: "session/new",
      params: { projectId: "p1", workspaceId: "w1", agentId: "opencode" },
      options: { timeoutMs: 180_000 },
    },
  ]);
  assert.equal(trace.lastRequestType, "session/new");
});

test("dispatchWithTrace gives session prewarm a longer timeout", async () => {
  const requested: Array<{ method: string; params: unknown; options: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown, options?: unknown) => {
      requested.push({ method, params, options });
      return { ok: true };
    },
    notify: () => undefined,
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  await dispatchWithTrace(
    client as any,
    "session/prewarm",
    { projectId: "p1", workspaceId: "w1", agentId: "opencode" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [
    {
      method: "session/prewarm",
      params: { projectId: "p1", workspaceId: "w1", agentId: "opencode" },
      options: { timeoutMs: 180_000 },
    },
  ]);
  assert.equal(trace.lastRequestType, "session/prewarm");
});

test("dispatchWithTrace sends session/cancel as a JSON-RPC notification", async () => {
  const notified: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async () => {
      throw new Error("request should not be called");
    },
    notify: (method: string, params: unknown) => {
      notified.push({ method, params });
    },
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  await dispatchWithTrace(
    client as any,
    "session/cancel",
    { sessionId: "s1" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(notified, [{ method: "session/cancel", params: { sessionId: "s1" } }]);
  assert.equal(trace.lastRequestType, "session/cancel");
});

test("requestInitialSync dispatches initial JSON-RPC methods in order", async () => {
  const methods: Array<{ method: string; params: unknown }> = [];
  const states: unknown[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method, params) => {
      methods.push({ method, params });
    },
    setSessionHistoryState: (state) => states.push(state),
    sessionPageLimit: 25,
  });

  assert.deepEqual(methods, [
    { method: "helm/list", params: {} },
    { method: "project/list", params: {} },
    { method: "workspace/list", params: {} },
    { method: "agent/list", params: {} },
    { method: "agent/connections", params: {} },
    { method: "session/list", params: { limit: 25 } },
    { method: "permission/list_pending", params: {} },
    { method: "device/list", params: {} },
  ]);
  assert.deepEqual(states, [{ hasMore: false, loading: true }]);
});
