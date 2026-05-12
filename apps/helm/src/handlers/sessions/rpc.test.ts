import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";

test("session RPC lists paged sessions", async () => {
  const sessions = [{ id: "s1", updatedAt: "2026-05-06T00:00:00.000Z" }];
  const result = await handleSessionRpcRequest("session/list", { limit: 20 }, {
    sessionStore: { list: () => sessions },
    migrateStoredSessionSummary: (item: unknown) => item,
    logInfo: () => undefined,
  } as any);

  assert.deepEqual(result, {
    sessions,
    nextCursor: undefined,
    hasMore: false,
    before: undefined,
  });
});

test("session/subscribe records a session topic subscription", async () => {
  const calls: string[] = [];

  const result = await handleSessionRpcRequest("session/subscribe", { sessionId: "s1" }, {
    socketId: "socket-1",
    subscribeSessionTopic: (socketId: string, sessionId: string) => {
      calls.push(`${socketId}:${sessionId}`);
    },
  } as any);

  assert.deepEqual(calls, ["socket-1:s1"]);
  assert.deepEqual(result, { ok: true, message: "Subscribed to session s1." });
});

test("session/unsubscribe records a session topic removal", async () => {
  const calls: string[] = [];

  const result = await handleSessionRpcRequest("session/unsubscribe", { sessionId: "s1" }, {
    socketId: "socket-1",
    unsubscribeSessionTopic: (socketId: string, sessionId: string) => {
      calls.push(`${socketId}:${sessionId}`);
    },
  } as any);

  assert.deepEqual(calls, ["socket-1:s1"]);
  assert.deepEqual(result, { ok: true, message: "Unsubscribed from session s1." });
});

test("permission/list_pending returns active permission requests", async () => {
  const request = {
    id: "permission-1",
    command: "Approve MCP tool call :: {}",
    reason: "需要审核工具调用",
    workspacePath: "D:/repo",
  };
  const result = await handleSessionRpcRequest("permission/list_pending", {}, {
    permissionIndex: new Map([
      ["permission-1", { sessionId: "s1", request }],
    ]),
  } as any);

  assert.deepEqual(result, {
    permissions: [{ sessionId: "s1", request }],
  });
});

test("session RPC notification cancels active runtime and clears stale handle", async () => {
  let cancelled = false;
  const sessions = new Map([["s1", { runtime: { cancel: () => { cancelled = true; } } }]]);
  const handled = await handleSessionRpcNotification("session/cancel", { sessionId: "s1" }, {
    sessions,
  } as any);

  assert.equal(handled, true);
  assert.equal(cancelled, true);
  assert.equal(sessions.has("s1"), false);
});

test("session/prompt waits for runtime prompt failures", async () => {
  const sessionId = "s1";
  const context = {
    sessions: new Map([
      [
        sessionId,
        {
          runtime: {
            sessionCapabilities: {},
            prompt: async () => {
              throw new Error("Session is not active: s1");
            },
          },
        },
      ],
    ]),
    logInfo: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: () => undefined,
    broadcastNotification: () => undefined,
  };

  await assert.rejects(
    handleSessionRpcRequest("session/prompt", { sessionId, text: "继续" }, context as any),
    /Session is not active: s1/u,
  );
});

test("session/rename persists and broadcasts the next title", async () => {
  const stored = {
    id: "s1",
    title: "旧标题",
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
  let persisted: unknown;
  let broadcasted: unknown;
  const result = await handleSessionRpcRequest(
    "session/rename",
    { sessionId: "s1", title: "新标题" },
    {
      sessions: new Map(),
      sessionStore: { list: () => [stored] },
      updateSessionSummary: (_sessionId: string, mutate: (summary: typeof stored) => typeof stored) => {
        persisted = mutate(stored);
        return persisted;
      },
      broadcastNotification: (method: string, params: unknown) => {
        broadcasted = { method, params };
      },
    } as any,
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(persisted, { ...stored, title: "新标题" });
  assert.deepEqual(broadcasted, {
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: { ...stored, title: "新标题" },
      },
    },
  });
});

test("session/prompt activates a runtime draft before sending first prompt", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    workspaceIds: ["workspace-1"],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const workspace = { id: "workspace-1", name: "main", path: "D:/repo" };
  const agent = { id: "codex", name: "Codex" };
  let attachedSessionId: string | undefined;
  let prompted = "";
  const runtime = {
    runtimeSessionId: "runtime-draft",
    sessionConfigState: { model: "gpt-5.5" },
    sessionModelState: { options: [{ id: "gpt-5.5", name: "GPT-5.5" }] },
    sessionCapabilities: { sessionLoad: true },
    prompt: async (text: string) => { prompted = text; },
  };
  const storedSessions: any[] = [];
  const sessions = new Map();

  const result = await handleSessionRpcRequest("session/prompt", {
    draftId: "draft-1",
    text: "你好",
  }, {
    takeRuntimeDraft: () => ({
      draftId: "draft-1",
      deckClientId: "deck-1",
      scopeKey: "deck-1:workspace-1:codex",
      logicalScopeKey: "workspace-1:codex",
      project,
      helm,
      workspace,
      agent,
      runtime,
      attach: (sessionId: string) => { attachedSessionId = sessionId; },
      modelState: runtime.sessionModelState,
      configState: runtime.sessionConfigState,
      configOptions: [],
      availableCommands: [],
    }),
    buildResumeInfo: () => ({ supported: false }),
    hydrateSessionSummary: (summary: any) => summary,
    sessionStore: {
      upsert: (summary: any) => { storedSessions.push(summary); },
      list: () => storedSessions,
    },
    persistRuntimeDescriptor: () => undefined,
    sessions,
    logInfo: () => undefined,
    logError: () => undefined,
    broadcastNotification: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: (sessionId: string, mutate: (summary: any) => any) => {
      const record = sessions.get(sessionId);
      if (!record) return undefined;
      const next = mutate(record.summary);
      record.summary = next;
      return next;
    },
  } as any) as { session: { id: string; runtimeSessionId: string; model?: string }; stopReason: string };

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.session.runtimeSessionId, "runtime-draft");
  assert.equal(result.session.model, "gpt-5.5");
  assert.equal(attachedSessionId, result.session.id);
  assert.equal(prompted, "你好");
});

test("session/configure routes draft config without requiring a visible session", async () => {
  let configured: unknown;
  const result = await handleSessionRpcRequest(
    "session/configure",
    { draftId: "draft-1", model: "gpt-5.5", reasoningEffort: "high" },
    {
      configureRuntimeDraft: (params: unknown) => {
        configured = params;
        return {
          ok: true,
          draftId: "draft-1",
          state: { model: "gpt-5.5", reasoningEffort: "high" },
          options: [],
          message: "Runtime draft config updated.",
        };
      },
    } as any,
  );

  assert.deepEqual(configured, {
    draftId: "draft-1",
    agentMode: undefined,
    model: "gpt-5.5",
    reasoningEffort: "high",
  });
  assert.deepEqual(result, {
    ok: true,
    draftId: "draft-1",
    state: { model: "gpt-5.5", reasoningEffort: "high" },
    options: [],
    message: "Runtime draft config updated.",
  });
});

test("session/set_config_option remains a compatibility alias for draft config", async () => {
  let configured: unknown;
  const result = await handleSessionRpcRequest(
    "session/set_config_option",
    { draftId: "draft-1", agentMode: "plan" },
    {
      configureRuntimeDraft: (params: unknown) => {
        configured = params;
        return {
          ok: true,
          draftId: "draft-1",
          state: { agentMode: "plan" },
          options: [],
          message: "Runtime draft config updated.",
        };
      },
    } as any,
  );

  assert.deepEqual(configured, {
    draftId: "draft-1",
    agentMode: "plan",
    model: undefined,
    reasoningEffort: undefined,
  });
  assert.deepEqual(result, {
    ok: true,
    draftId: "draft-1",
    state: { agentMode: "plan" },
    options: [],
    message: "Runtime draft config updated.",
  });
});

test("session/discard_draft delegates cleanup to the runtime draft registry", async () => {
  let discarded: unknown;
  const result = await handleSessionRpcRequest(
    "session/discard_draft",
    { deckClientId: "deck-1", draftId: "draft-1", reason: "scope-change" },
    {
      discardRuntimeDraft: (params: unknown) => {
        discarded = params;
        return {
          ok: true,
          discarded: true,
          draftId: "draft-1",
          cleanup: { kind: "remote-deleted", providerId: "opencode", message: "deleted" },
          message: "Runtime draft discarded.",
        };
      },
    } as any,
  );

  assert.deepEqual(discarded, {
    deckClientId: "deck-1",
    draftId: "draft-1",
    reason: "scope-change",
  });
  assert.deepEqual(result, {
    ok: true,
    discarded: true,
    draftId: "draft-1",
    cleanup: { kind: "remote-deleted", providerId: "opencode", message: "deleted" },
    message: "Runtime draft discarded.",
  });
});
