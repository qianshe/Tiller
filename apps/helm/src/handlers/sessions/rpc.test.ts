import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";
import { createSessionPromptQueueManager } from "../../runtime/session-prompt-queue";

function createPromptQueueContextExtras() {
  const promptQueue = createSessionPromptQueueManager();
  return {
    promptQueue,
    drainPromptQueue: async () => undefined,
  };
}

function flushPromises() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("session/get_artifacts repairs stale running thinking for idle sessions", async () => {
  const sessionId = "session-thinking-history";
  let toolCalls = [
    {
      id: "think-1",
      commandId: "think-1",
      kind: "think" as const,
      title: "Thinking",
      status: "running" as const,
      output: "persisted thinking",
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
    },
  ];

  const result = await handleSessionRpcRequest(
    "session/get_artifacts",
    { sessionId },
    {
      sessions: new Map(),
      sessionStore: {
        list: () => [
          {
            id: sessionId,
            agentId: "opencode",
            status: "idle",
            updatedAt: "2026-05-17T10:00:10.000Z",
          },
        ],
      },
      refreshAuthoritativeSessionHistory: async () => undefined,
      sessionArtifactStore: {
        get: () => ({ outputs: [], diffs: [], toolCalls }),
        getPage: () => ({ outputs: [], diffs: [], toolCalls, hasMore: false }),
        replaceToolCalls: (_sessionId: string, nextToolCalls: typeof toolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      hydrateDiffsFromWorktreeGit: async (_sessionId: string, diffs: unknown[]) => diffs,
    } as any,
  ) as { toolCalls: typeof toolCalls };

  assert.equal(result.toolCalls[0]?.status, "completed");
  assert.equal(result.toolCalls[0]?.output, "persisted thinking");
  assert.equal(result.toolCalls[0]?.updatedAt, "2026-05-17T10:00:10.000Z");
});

test("session/reimport_history delegates to the history reimport service", async () => {
  let delegated: unknown;
  const result = await handleSessionRpcRequest(
    "session/reimport_history",
    { sessionId: "s1", limit: 40 },
    {
      reimportSessionHistory: (sessionId: string, options: unknown) => {
        delegated = { sessionId, options };
        return {
          sessionId,
          messages: [
            {
              id: "m1",
              role: "user" as const,
              text: "hello",
              timestamp: "2026-05-24T10:00:00.000Z",
            },
          ],
          outputs: [],
          diffs: [],
          toolCalls: [],
          hasMore: false,
          activityHasMore: false,
          message: "历史已从 ACP 重新导入。"
        };
      },
    } as any,
  );

  assert.deepEqual(delegated, { sessionId: "s1", options: { limit: 40 } });
  assert.deepEqual(result, {
    sessionId: "s1",
    messages: [
      {
        id: "m1",
        role: "user",
        text: "hello",
        timestamp: "2026-05-24T10:00:00.000Z",
      },
    ],
    outputs: [],
    diffs: [],
    toolCalls: [],
    hasMore: false,
    activityHasMore: false,
    message: "历史已从 ACP 重新导入。",
  });
});

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

test("session/prompt acknowledges before runtime prompt failures are reported", async () => {
  const sessionId = "s1";
  const broadcasts: any[] = [];
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
    ...createPromptQueueContextExtras(),
    logInfo: () => undefined,
    logError: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: () => undefined,
    broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
  };

  const result = await handleSessionRpcRequest(
    "session/prompt",
    { sessionId, text: "继续" },
    context as any,
  ) as { accepted: "sent" };

  assert.equal(result.accepted, "sent");
  await flushPromises();
  assert.equal(broadcasts.some((item) => item.method === "error/raised"), true);
});

test("session/prompt broadcasts synchronous prompt failures to connected decks", async () => {
  const sessionId = "s1";
  const broadcasts: any[] = [];
  let status = "idle";
  const context = {
    sessions: new Map([
      [
        sessionId,
        {
          summary: {
            id: sessionId,
            status,
            availableCommands: [{ name: "review" }],
          },
          runtime: {
            sessionCapabilities: {},
            prompt: async () => {
              throw new Error("should not reach ACP prompt");
            },
          },
        },
      ],
    ]),
    ...createPromptQueueContextExtras(),
    logInfo: () => undefined,
    logError: () => undefined,
    persistSessionMessage: () => undefined,
    updateSessionSummary: (_sessionId: string, mutate: (current: any) => any) => {
      const next = mutate({ id: sessionId, status });
      status = next.status;
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
  };

  await assert.rejects(
    handleSessionRpcRequest("session/prompt", { sessionId, text: "/unknown" }, context as any),
    /command is not supported/u,
  );

  assert.equal(status, "error");
  assert.deepEqual(
    broadcasts.map((item) => [item.method, item.params?.sessionId, item.params?.update?.kind ?? item.params?.message]),
    [
      ["error/raised", sessionId, "/unknown command is not supported by ACP agent. Available commands: /review"],
      ["session/update", sessionId, "status_change"],
    ],
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
    cwds: ["worktree-1"],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const worktree = { id: "worktree-1", name: "main", path: "D:/repo" };
  const agent = { id: "codex", name: "Codex" };
  let attachedSessionId: string | undefined;
  let prompted = "";
  const runtime = {
    runtimeSessionId: "runtime-draft",
    sessionConfigState: { model: "gpt-5.5", reasoningEffort: "medium" },
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
      scopeKey: "deck-1:worktree-1:codex",
      logicalScopeKey: "worktree-1:codex",
      project,
      helm,
      worktree,
      agent,
      runtime,
      attach: (sessionId: string) => { attachedSessionId = sessionId; },
      modelState: runtime.sessionModelState,
      configState: runtime.sessionConfigState,
      configOptions: [
        {
          id: "model",
          category: "model",
          currentValue: "gpt-5.5",
          options: [{ value: "gpt-5.5", label: "GPT-5.5" }],
        },
      ],
      availableCommands: [{ name: "review" }, { name: "compact" }],
    }),
    buildResumeInfo: () => ({ supported: false }),
    hydrateSessionSummary: (summary: any) => ({
      ...summary,
      resume: sessions.has(summary.id)
        ? { mode: "same-process", state: "resume-available", reason: "active", checkedAt: "2026-05-16T00:00:00.000Z" }
        : { mode: "none", state: "history-only", reason: "missing active runtime", checkedAt: "2026-05-16T00:00:00.000Z" },
    }),
    sessionStore: {
      upsert: (summary: any) => { storedSessions.push(summary); },
      list: () => storedSessions,
    },
    persistRuntimeDescriptor: () => undefined,
    sessions,
    ...createPromptQueueContextExtras(),
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
  } as any) as { session: any; accepted: "sent" };

  await flushPromises();
  assert.equal(result.accepted, "sent");
  assert.equal(result.session.runtimeSessionId, "runtime-draft");
  assert.equal(result.session.resume.mode, "same-process");
  assert.equal(result.session.model, "gpt-5.5");
  assert.equal(result.session.reasoningEffort, undefined);
  assert.deepEqual(result.session.availableCommands, [
    { name: "review" },
    { name: "compact" },
  ]);
  assert.equal(attachedSessionId, result.session.id);
  assert.equal(prompted, "你好");
});

test("session/update_queued_prompt edits a queued prompt and broadcasts queue", async () => {
  const promptQueue = createSessionPromptQueueManager();
  const item = promptQueue.enqueue({
    sessionId: "s1",
    text: "before",
    clientMessageId: "client-1",
  });
  const broadcasts: any[] = [];

  const result = (await handleSessionRpcRequest(
    "session/update_queued_prompt",
    { sessionId: "s1", queueItemId: item.id, text: "after" },
    {
      promptQueue,
      broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
    } as any,
  )) as { ok: boolean; queueItem: { text: string } };

  assert.equal(result.ok, true);
  assert.equal(result.queueItem.text, "after");
  assert.equal(broadcasts.at(-1)?.params.update.kind, "prompt_queue");
});

test("session/delete_queued_prompt deletes a queued prompt and broadcasts queue", async () => {
  const promptQueue = createSessionPromptQueueManager();
  const item = promptQueue.enqueue({
    sessionId: "s1",
    text: "remove me",
    clientMessageId: "client-1",
  });
  const broadcasts: any[] = [];

  const result = (await handleSessionRpcRequest(
    "session/delete_queued_prompt",
    { sessionId: "s1", queueItemId: item.id },
    {
      promptQueue,
      broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
    } as any,
  )) as { ok: boolean; queue: { queued: unknown[] } };

  assert.equal(result.ok, true);
  assert.equal(result.queue.queued.length, 0);
  assert.equal(broadcasts.at(-1)?.params.update.queue.queued.length, 0);
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
    configId: undefined,
    value: undefined,
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
    configId: undefined,
    value: undefined,
  });
  assert.deepEqual(result, {
    ok: true,
    draftId: "draft-1",
    state: { agentMode: "plan" },
    options: [],
    message: "Runtime draft config updated.",
  });
});

test("session/configure forwards arbitrary config option values", async () => {
  let configured: unknown;
  await handleSessionRpcRequest(
    "session/configure",
    { draftId: "draft-1", configId: "notify", value: true },
    {
      configureRuntimeDraft: (params: unknown) => {
        configured = params;
        return {
          ok: true,
          draftId: "draft-1",
          state: {},
          options: [{ id: "notify", currentValue: true }],
          message: "Runtime draft config updated.",
        };
      },
    } as any,
  );

  assert.deepEqual(configured, {
    draftId: "draft-1",
    agentMode: undefined,
    model: undefined,
    reasoningEffort: undefined,
    configId: "notify",
    value: true,
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

test("session/new uses cwd without requiring cwd", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/repo",
    cwds: ["old-worktree"],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const agent = { id: "codex", name: "Codex" };
  let runtimeWorktree: unknown;
  let storedSummary: any;
  const sessions = new Map();

  const result = await handleSessionRpcRequest(
    "session/new",
    { projectId: "project-1", cwd: "D:/repo", agentId: "codex" },
    {
      loadAvailableHelms: () => [helm],
      loadAvailableWorktrees: () => [],
      loadAvailableAgents: () => [agent],
      loadAvailableProjectsWithSemanticSummaries: () => [project],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string) => (id === project.id ? project : undefined),
      resolveProviderById: (id: string) => (id === agent.id ? agent : undefined),
      resolveHelmById: (id: string) => (id === helm.id ? helm : undefined),
      buildResumeInfo: () => ({ mode: "none", state: "history-only", reason: "test", checkedAt: "2026-05-13T00:00:00.000Z" }),
      hydrateSessionSummary: (summary: any) => ({
        ...summary,
        resume: sessions.has(summary.id)
          ? { mode: "same-process", state: "resume-available", reason: "active", checkedAt: "2026-05-16T00:00:00.000Z" }
          : { mode: "none", state: "history-only", reason: "missing active runtime", checkedAt: "2026-05-16T00:00:00.000Z" },
      }),
      sessionStore: {
        upsert: (summary: any) => { storedSummary = summary; },
      },
      persistRuntimeDescriptor: () => undefined,
      broadcastNotification: () => undefined,
      logInfo: () => undefined,
      logError: () => undefined,
      handleRuntimeEvent: () => undefined,
      updateSessionSummary: () => undefined,
      sessions,
      createRuntime: async ({ worktree }: any) => {
        runtimeWorktree = worktree;
        return {
          runtimeSessionId: "runtime-1",
          sessionCapabilities: { sessionLoad: true },
          sessionConfigState: {},
          sessionModelState: {},
        };
      },
    } as any,
  ) as { session: { cwd?: string; runtimeSessionId?: string } };

  assert.deepEqual(runtimeWorktree, {
    name: "repo",
    path: "D:/repo",
    summary: undefined,
  });
  assert.equal(storedSummary.cwd, "D:/repo");
  assert.equal(result.session.cwd, "D:/repo");
  assert.equal(result.session.runtimeSessionId, "runtime-1");
  assert.equal((result.session as any).resume.mode, "same-process");
});

test("session/new preserves explicit reasoning until authoritative config options are known", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/repo",
    cwds: [],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const agent = { id: "claude", name: "Claude" };
  let runtimeSessionConfig: any;
  let storedSummary: any;
  const sessions = new Map();

  const result = await handleSessionRpcRequest(
    "session/new",
    {
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: "claude",
      model: "claude-haiku-4-5",
      reasoningEffort: "high",
    },
    {
      loadAvailableHelms: () => [helm],
      loadAvailableWorktrees: () => [],
      loadAvailableAgents: () => [agent],
      loadAvailableProjectsWithSemanticSummaries: () => [project],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string) => (id === project.id ? project : undefined),
      resolveProviderById: (id: string) => (id === agent.id ? agent : undefined),
      resolveHelmById: (id: string) => (id === helm.id ? helm : undefined),
      buildResumeInfo: () => ({
        mode: "none",
        state: "history-only",
        reason: "test",
        checkedAt: "2026-05-16T00:00:00.000Z",
      }),
      hydrateSessionSummary: (summary: any) => summary,
      sessionStore: {
        upsert: (summary: any) => {
          storedSummary = summary;
        },
      },
      persistRuntimeDescriptor: () => undefined,
      broadcastNotification: () => undefined,
      logInfo: () => undefined,
      logError: () => undefined,
      handleRuntimeEvent: () => undefined,
      updateSessionSummary: () => undefined,
      sessions,
      createRuntime: async ({ sessionConfig }: any) => {
        runtimeSessionConfig = sessionConfig;
        return {
          runtimeSessionId: "runtime-claude",
          sessionCapabilities: { sessionLoad: true },
          sessionConfigState: { reasoningEffort: "high" },
          sessionModelState: {},
        };
      },
    } as any,
  ) as { session: { reasoningEffort?: string } };

  assert.equal(runtimeSessionConfig.reasoningEffort, "high");
  assert.equal(runtimeSessionConfig.model, "claude-haiku-4-5");
  assert.equal(storedSummary.reasoningEffort, "high");
  assert.equal(result.session.reasoningEffort, "high");
});

test("session/draft preserves explicit reasoning until authoritative config options are known", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/repo",
    cwds: [],
  };
  const helm = { id: "local-helm", name: "Local Helm" };
  const agent = { id: "claude", name: "Claude" };
  let draftSessionConfig: any;

  await handleSessionRpcRequest(
    "session/draft",
    {
      deckClientId: "deck-1",
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: "claude",
      model: "claude-haiku-4-5",
      reasoningEffort: "medium",
    },
    {
      loadAvailableHelms: () => [helm],
      loadAvailableWorktrees: () => [],
      loadAvailableAgents: () => [agent],
      loadAvailableProjectsWithSemanticSummaries: () => [project],
      setHelms: () => undefined,
      setWorktrees: () => undefined,
      setAgents: () => undefined,
      setProjects: () => undefined,
      resolveProjectById: (id: string) => (id === project.id ? project : undefined),
      resolveProviderById: (id: string) => (id === agent.id ? agent : undefined),
      resolveHelmById: (id: string) => (id === helm.id ? helm : undefined),
      createRuntimeDraft: async ({ sessionConfig }: any) => {
        draftSessionConfig = sessionConfig;
        return { ok: true };
      },
    } as any,
  );

  assert.equal(draftSessionConfig.reasoningEffort, "medium");
  assert.equal(draftSessionConfig.model, "claude-haiku-4-5");
});
