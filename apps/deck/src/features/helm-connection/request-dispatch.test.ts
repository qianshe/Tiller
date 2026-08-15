import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchWithTrace,
  requestInitialSync,
  subscribeToSessionTopic,
  unsubscribeFromSessionTopic,
} from "./request-dispatch.js";

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
    { projectId: "p1", cwd: "D:/repo", agentId: "opencode" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [
    {
      method: "session/new",
      params: { projectId: "p1", cwd: "D:/repo", agentId: "opencode" },
      options: { timeoutMs: 180_000 },
    },
  ]);
  assert.equal(trace.lastRequestType, "session/new");
});

test("dispatchWithTrace gives session draft creation a longer timeout", async () => {
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
    "session/draft",
    { deckClientId: "deck-1", projectId: "p1", cwd: "D:/repo", agentId: "opencode" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [
    {
      method: "session/draft",
      params: { deckClientId: "deck-1", projectId: "p1", cwd: "D:/repo", agentId: "opencode" },
      options: { timeoutMs: 180_000 },
    },
  ]);
  assert.equal(trace.lastRequestType, "session/draft");
});

test("dispatchWithTrace gives session resume a longer timeout", async () => {
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
    "session/resume",
    { sessionId: "s1" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [
    {
      method: "session/resume",
      params: { sessionId: "s1" },
      options: { timeoutMs: 180_000 },
    },
  ]);
  assert.equal(trace.lastRequestType, "session/resume");
});

test("dispatchWithTrace sends session/cancel as a request so the caller gets an ACK", async () => {
  const requested: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async (method: string, params: unknown) => {
      requested.push({ method, params });
      return { sessionId: "s1", ok: true, status: "cancelled" };
    },
    notify: () => {
      throw new Error("notify should not be used when the Helm supports the request");
    },
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  const result = await dispatchWithTrace(
    client as any,
    "session/cancel",
    { sessionId: "s1" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(requested, [{ method: "session/cancel", params: { sessionId: "s1" } }]);
  assert.deepEqual(result, { sessionId: "s1", ok: true, status: "cancelled" });
  assert.equal(trace.lastRequestType, "session/cancel");
});

test("dispatchWithTrace falls back to a notification when the Helm predates the cancel request", async () => {
  // 旧 Helm 只把 session/cancel 当通知处理,升级后的 Deck 仍要能取消。
  const notified: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: async () => {
      throw Object.assign(new Error("Unknown method: session/cancel"), { code: -32601 });
    },
    notify: (method: string, params: unknown) => {
      notified.push({ method, params });
    },
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  const result = await dispatchWithTrace(
    client as any,
    "session/cancel",
    { sessionId: "s1" },
    (updater) => {
      trace = updater(trace);
    },
  );

  assert.deepEqual(notified, [{ method: "session/cancel", params: { sessionId: "s1" } }]);
  assert.equal(result, undefined);
});

test("dispatchWithTrace surfaces a failing session/cancel instead of swallowing it", async () => {
  const client = {
    request: async () => {
      throw new Error("connection lost");
    },
    notify: () => {
      throw new Error("notify should not be used for non-MethodNotFound failures");
    },
  };
  let trace = { requestsSent: 0, lastRequestType: "" } as any;

  await assert.rejects(
    dispatchWithTrace(
      client as any,
      "session/cancel",
      { sessionId: "s1" },
      (updater) => {
        trace = updater(trace);
      },
    ),
    /connection lost/,
  );
});

test("requestInitialSync rehydrates approvals after reconnect", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  await requestInitialSync({} as any, {
    dispatch: async (_client, method, params) => {
      calls.push({ method, params });
    },
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.equal(
    calls.some((call) => call.method === "approval/list_pending"),
    true,
  );
  assert.equal(
    calls.some((call) => call.method === "approval/list"),
    true,
  );
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
    { method: "agent/list", params: {} },
    { method: "agent/connections", params: {} },
    { method: "conversation/list", params: {} },
    { method: "daemon/update/check", params: {} },
    { method: "logging/get", params: {} },
    { method: "session/list", params: { limit: 25 } },
    { method: "notification/list", params: { limit: 100 } },
    { method: "session/activity_summary", params: {} },
    { method: "approval/list_pending", params: {} },
    { method: "approval/list", params: { limit: 100 } },
    { method: "device/list", params: {} },
  ]);
  assert.deepEqual(states, [{ hasMore: false, loading: true }]);
});

test("DispatchToHelm options can carry the source Helm key", async () => {
  const options = {
    sourceHelmKey: "helm-b",
    onResult: () => undefined,
  };

  assert.equal(options.sourceHelmKey, "helm-b");
});

test("requestInitialSync keeps inventory loading when activity summary is unsupported", async () => {
  const methods: string[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method) => {
      methods.push(method);
      if (method === "session/activity_summary") {
        throw { code: -32601, message: "Unknown method" };
      }
    },
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.equal(methods.at(-1), "device/list");
});

test("requestInitialSync tolerates older Helms without notification history", async () => {
  const methods: string[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method) => {
      methods.push(method);
      if (method === "notification/list") {
        throw { code: -32601, message: "Unknown method" };
      }
    },
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.equal(methods.includes("session/activity_summary"), true);
  assert.equal(methods.at(-1), "device/list");
});

test("requestInitialSync ignores update checks only when an older Helm lacks the method", async () => {
  const methods: string[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method) => {
      methods.push(method);
      if (method === "daemon/update/check") {
        throw { code: -32601, message: "Unknown method" };
      }
    },
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.equal(methods.includes("logging/get"), true);
  assert.equal(methods.includes("device/list"), true);
});

test("requestInitialSync keeps loading when an older Helm lacks conversation preparations", async () => {
  const methods: string[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method) => {
      methods.push(method);
      if (method === "conversation/list") {
        throw { code: -32601, message: "Unknown method" };
      }
    },
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.equal(methods.includes("session/list"), true);
  assert.equal(methods.at(-1), "device/list");
});

test("requestInitialSync keeps supported update check failures visible without blocking inventory", async () => {
  const errors: unknown[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method) => {
      if (method === "daemon/update/check") {
        throw new Error("registry unavailable");
      }
    },
    onUpdateCheckError: (error) => errors.push(error),
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, "registry unavailable");
});

test("requestInitialSync keeps loading inventory when logging settings fail", async () => {
  const methods: string[] = [];

  await requestInitialSync({} as any, {
    dispatch: async (_client, method) => {
      methods.push(method);
      if (method === "logging/get") {
        throw new Error("unsupported logging settings");
      }
    },
    setSessionHistoryState: () => undefined,
    sessionPageLimit: 25,
  });

  assert.deepEqual(methods, [
    "helm/list",
    "project/list",
    "agent/list",
    "agent/connections",
    "conversation/list",
    "daemon/update/check",
    "logging/get",
    "session/list",
    "notification/list",
    "session/activity_summary",
    "approval/list_pending",
    "approval/list",
    "device/list",
  ]);
});

test("requestInitialSync clears session loading when session list fails", async () => {
  const states: unknown[] = [];

  await assert.rejects(
    requestInitialSync({} as any, {
      dispatch: async (_client, method) => {
        if (method === "session/list") {
          throw new Error("session list failed");
        }
      },
      setSessionHistoryState: (state) => states.push(state),
      sessionPageLimit: 25,
    }),
    /session list failed/,
  );

  assert.deepEqual(states, [
    { hasMore: false, loading: true },
    { hasMore: false, loading: false },
  ]);
});

test("subscribeToSessionTopic dispatches session/subscribe", async () => {
  const methods: Array<{ method: string; params: unknown }> = [];

  await subscribeToSessionTopic({} as any, "s1", async (_client, method, params) => {
    methods.push({ method, params });
  });

  assert.deepEqual(methods, [
    { method: "session/subscribe", params: { sessionId: "s1" } },
  ]);
});

test("unsubscribeFromSessionTopic dispatches session/unsubscribe", async () => {
  const methods: Array<{ method: string; params: unknown }> = [];

  await unsubscribeFromSessionTopic({} as any, "s1", async (_client, method, params) => {
    methods.push({ method, params });
  });

  assert.deepEqual(methods, [
    { method: "session/unsubscribe", params: { sessionId: "s1" } },
  ]);
});
