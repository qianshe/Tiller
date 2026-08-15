import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationPreparation, SessionSummary } from "@tiller/shared";
import { handleConversationRpcRequest } from "./rpc";

test("conversation save persists before broadcasting and enforces revision conflicts", async () => {
  const records = new Map<string, ConversationPreparation>();
  const order: string[] = [];
  const context = {
    conversationPreparationStore: {
      get: (id: string) => records.get(id),
      list: () => [...records.values()],
      upsert: (preparation: ConversationPreparation) => {
        order.push("persist");
        records.set(preparation.id, preparation);
      },
      remove: (id: string) => records.delete(id),
    },
    broadcastNotification: (method: string) => {
      order.push(`broadcast:${method}`);
    },
  } as any;

  const created = await handleConversationRpcRequest(
    "conversation/save",
    { content: "Prepare a task" },
    context,
  ) as { preparation: ConversationPreparation };
  assert.deepEqual(order, ["persist", "broadcast:conversation/update"]);
  assert.equal(created.preparation.revision, 1);
  assert.equal(created.preparation.projectId, undefined);

  await assert.rejects(() => handleConversationRpcRequest(
    "conversation/save",
    { id: created.preparation.id, revision: 0, content: "stale" },
    context,
  ), /revision conflict/);
  assert.equal(records.get(created.preparation.id)?.content, "Prepare a task");

  const listed = await handleConversationRpcRequest("conversation/list", {}, context) as {
    preparations: ConversationPreparation[];
  };
  assert.equal(listed.preparations.length, 1);
});

test("conversation delete removes storage before the global notification", async () => {
  const record: ConversationPreparation = {
    id: "preparation-1",
    content: "Prepare",
    revision: 2,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
  let current: ConversationPreparation | undefined = record;
  const order: string[] = [];
  const context = {
    conversationPreparationStore: {
      get: () => current,
      list: () => current ? [current] : [],
      upsert: () => undefined,
      remove: () => {
        order.push("remove");
        current = undefined;
      },
    },
    broadcastNotification: (method: string) => order.push(`broadcast:${method}`),
  } as any;

  await handleConversationRpcRequest(
    "conversation/delete",
    { id: record.id, revision: record.revision },
    context,
  );
  assert.deepEqual(order, ["remove", "broadcast:conversation/update"]);
});

function createStartHarness(options: {
  promptError?: Error;
  titleUpdateFails?: boolean;
} = {}) {
  const preparation: ConversationPreparation = {
    id: "preparation-start",
    content: "Implement the prepared task",
    title: "Prepared task",
    projectId: "project-1",
    cwd: "D:/repo",
    agentId: "codex",
    revision: 3,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
  const records = new Map([[preparation.id, preparation]]);
  const notifications: Array<{ method: string; params: unknown }> = [];
  const sessions = new Map<string, { summary: SessionSummary }>();
  const summary: SessionSummary = {
    id: "session-started",
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "main",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    messageCount: 0,
    runtimeSessionId: "runtime-started",
  };
  let createCount = 0;
  let promptCount = 0;
  const context = {
    conversationPreparationStore: {
      get: (id: string) => records.get(id),
      list: () => [...records.values()],
      upsert: (record: ConversationPreparation) => records.set(record.id, record),
      remove: (id: string) => records.delete(id),
    },
    loadAvailableProjectsWithSemanticSummaries: async () => [{
      id: "project-1",
      path: "D:/repo",
      worktrees: [{ path: "D:/repo" }],
    }],
    resolveProjectById: () => ({
      id: "project-1",
      path: "D:/repo",
      worktrees: [{ path: "D:/repo" }],
    }),
    sessions,
    updateSessionSummary: (_sessionId: string, updater: (current: SessionSummary) => SessionSummary) => {
      if (options.titleUpdateFails) return undefined;
      const next = updater(sessions.get(summary.id)?.summary ?? summary);
      sessions.set(summary.id, { summary: next });
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => notifications.push({ method, params }),
  } as any;
  const dependencies = {
    createSession: async () => {
      createCount += 1;
      sessions.set(summary.id, { summary });
      return { session: summary };
    },
    promptSession: async () => {
      promptCount += 1;
      if (options.promptError) throw options.promptError;
      return { accepted: true, runtimeSessionId: summary.runtimeSessionId };
    },
  } as any;

  return {
    context,
    dependencies,
    notifications,
    preparation,
    records,
    counts: () => ({ createCount, promptCount }),
  };
}

test("conversation start creates a real session, prompts it, then removes the preparation", async () => {
  const harness = createStartHarness();

  const result = await handleConversationRpcRequest(
    "conversation/start",
    { preparationId: harness.preparation.id, revision: harness.preparation.revision },
    harness.context,
    harness.dependencies,
  ) as { session: SessionSummary; preparationId?: string };

  assert.equal(result.session.id, "session-started");
  assert.equal(result.preparationId, harness.preparation.id);
  assert.deepEqual(harness.counts(), { createCount: 1, promptCount: 1 });
  assert.equal(harness.records.has(harness.preparation.id), false);
  assert.equal(harness.notifications.some(({ method, params }) =>
    method === "conversation/update" &&
    (params as { kind?: string }).kind === "preparation_deleted"
  ), true);
});

test("conversation start keeps the preparation when session creation or prompting fails", async () => {
  const createHarness = createStartHarness();
  await assert.rejects(() => handleConversationRpcRequest(
    "conversation/start",
    { preparationId: createHarness.preparation.id, revision: createHarness.preparation.revision },
    createHarness.context,
    {
      ...createHarness.dependencies,
      createSession: async () => {
        throw new Error("create failed");
      },
    } as any,
  ), /create failed/);
  assert.equal(createHarness.records.has(createHarness.preparation.id), true);

  const promptHarness = createStartHarness({ promptError: new Error("prompt failed") });
  await assert.rejects(() => handleConversationRpcRequest(
    "conversation/start",
    { preparationId: promptHarness.preparation.id, revision: promptHarness.preparation.revision },
    promptHarness.context,
    promptHarness.dependencies,
  ), /prompt failed/);
  assert.equal(promptHarness.records.has(promptHarness.preparation.id), true);
});

test("conversation start serializes concurrent starts for the same preparation", async () => {
  const harness = createStartHarness();
  let releasePrompt!: () => void;
  let markPromptStarted!: () => void;
  const promptStarted = new Promise<void>((resolve) => {
    markPromptStarted = resolve;
  });
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  harness.dependencies.promptSession = async () => {
    markPromptStarted();
    await promptGate;
    return { accepted: true, runtimeSessionId: "runtime-started" };
  };

  const first = handleConversationRpcRequest(
    "conversation/start",
    { preparationId: harness.preparation.id, revision: harness.preparation.revision },
    harness.context,
    harness.dependencies,
  );
  await promptStarted;
  await assert.rejects(() => handleConversationRpcRequest(
    "conversation/start",
    { preparationId: harness.preparation.id, revision: harness.preparation.revision },
    harness.context,
    harness.dependencies,
  ), /already starting/);
  releasePrompt();
  await first;

  assert.equal(harness.counts().createCount, 1);
});

test("conversation start does not delete a preparation saved with a newer revision", async () => {
  const harness = createStartHarness();
  let releasePrompt!: () => void;
  let markPromptStarted!: () => void;
  const promptStarted = new Promise<void>((resolve) => {
    markPromptStarted = resolve;
  });
  const promptGate = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  harness.dependencies.promptSession = async () => {
    markPromptStarted();
    await promptGate;
    return { accepted: true, runtimeSessionId: "runtime-started" };
  };

  const start = handleConversationRpcRequest(
    "conversation/start",
    { preparationId: harness.preparation.id, revision: harness.preparation.revision },
    harness.context,
    harness.dependencies,
  );
  await promptStarted;

  const saved = await handleConversationRpcRequest(
    "conversation/save",
    {
      id: harness.preparation.id,
      revision: harness.preparation.revision,
      content: "Updated while starting",
    },
    harness.context,
  ) as { preparation: ConversationPreparation };
  assert.equal(saved.preparation.revision, harness.preparation.revision + 1);

  releasePrompt();
  await start;

  assert.deepEqual(harness.records.get(harness.preparation.id), saved.preparation);
  assert.equal(harness.notifications.some(({ method, params }) =>
    method === "conversation/update" &&
    (params as { kind?: string }).kind === "preparation_deleted"
  ), false);
});

test("conversation start reports title update failure without retaining the preparation", async () => {
  const harness = createStartHarness({ titleUpdateFails: true });

  const result = await handleConversationRpcRequest(
    "conversation/start",
    { preparationId: harness.preparation.id, revision: harness.preparation.revision },
    harness.context,
    harness.dependencies,
  ) as { titleUpdateFailed?: string };

  assert.match(result.titleUpdateFailed ?? "", /could not be updated/);
  assert.equal(harness.records.has(harness.preparation.id), false);
});
