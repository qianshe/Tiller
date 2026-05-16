import assert from "node:assert/strict";
import test from "node:test";
import { createSession } from "./session-actions.js";

(globalThis as any).WebSocket ??= { OPEN: 1 };

function createContext(overrides: Record<string, unknown> = {}) {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  const context = {
    selectedProjectId: "project-1",
    projects: [{ id: "project-1", path: "D:/repo" }],
    selectedWorktree: { name: "main", path: "D:/repo" },
    filteredWorktrees: [{ name: "main", path: "D:/repo" }],
    selectedAgentId: "codex",
    filteredAgents: [{ id: "codex", name: "Codex" }],
    agentModelOptions: {},
    rpcClientRef: { current: { socket: { readyState: (globalThis as any).WebSocket.OPEN } } },
    pendingPromptRef: { current: null as string | null },
    pendingPromptContentRef: { current: undefined },
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return Promise.resolve({});
    },
    effectiveDraftAgentMode: undefined,
    normalizeModelSelection: (model: string) => model === "provider-default" ? undefined : model,
    selectedModel: "provider-default",
    selectedReasoningEffort: "medium",
    navigateToView: () => undefined,
    ...overrides,
  } as any;

  return { context, dispatched };
}

test("createSession falls back to session/new when an initial prompt has no ready draft", () => {
  const { context, dispatched } = createContext();

  const created = createSession("hello", [{ type: "text", text: "hello" }], context);

  assert.equal(created, true);
  assert.equal(dispatched[0]?.method, "session/new");
  assert.deepEqual(dispatched[0]?.params, {
    projectId: "project-1",
    cwd: "D:/repo",
    agentId: "codex",
    agentMode: undefined,
    model: undefined,
    reasoningEffort: "medium",
  });
  assert.equal(context.pendingPromptRef.current, "hello");
  assert.deepEqual(context.pendingPromptContentRef.current, [{ type: "text", text: "hello" }]);
});

test("createSession sends the selected model in the session/new request", () => {
  const { context, dispatched } = createContext({
    selectedModel: "gpt-5.5",
    selectedReasoningEffort: "high",
  });

  const created = createSession("hello", undefined, context);

  assert.equal(created, true);
  assert.equal(dispatched[0]?.method, "session/new");
  assert.deepEqual(dispatched[0]?.params, {
    projectId: "project-1",
    cwd: "D:/repo",
    agentId: "codex",
    agentMode: undefined,
    model: "gpt-5.5",
    reasoningEffort: "high",
  });
});

test("createSession sends an initial prompt through a ready draft", () => {
  const { context, dispatched } = createContext({
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        loading: false,
        warmed: true,
        draftId: "draft-codex-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
  });

  const created = createSession("hello", undefined, context);

  assert.equal(created, true);
  assert.equal(dispatched[0]?.method, "session/prompt");
  assert.deepEqual(dispatched[0]?.params, {
    draftId: "draft-codex-1",
    text: "hello",
    content: undefined,
  });
}
);
