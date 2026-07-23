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
    newSessionPromptPendingScopesRef: { current: new Set<string>() },
    restoreInitialPrompt: () => undefined,
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
});

test("createSession waits for a loading draft before sending the initial prompt", async () => {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  let resolveDraft: (result: { draftId: string }) => void = () => undefined;
  const draftResult = new Promise<{ draftId: string }>((resolve) => {
    resolveDraft = resolve;
  });
  const { context } = createContext({
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        loading: true,
        warmed: true,
        deckClientId: "deck-1",
        projectId: "project-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return method === "session/draft" ? draftResult : Promise.resolve({});
    },
  });

  const created = createSession("hello", undefined, context);

  assert.equal(created, true);
  assert.equal(
    context.newSessionPromptPendingScopesRef.current.has("D:/repo:codex"),
    true,
  );
  assert.equal(dispatched[0]?.method, "session/draft");
  assert.equal(dispatched.some(({ method }) => method === "session/new"), false);
  assert.equal(dispatched.some(({ method }) => method === "session/prompt"), false);
  resolveDraft({ draftId: "draft-codex-1" });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(dispatched[1]?.method, "session/prompt");
  assert.deepEqual(dispatched[1]?.params, {
    draftId: "draft-codex-1",
    text: "hello",
    content: undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(context.newSessionPromptPendingScopesRef.current.size, 0);
});

test("createSession rejects duplicate prompts while the same draft is activating", async () => {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  let resolveDraft: (result: { draftId: string }) => void = () => undefined;
  const draftResult = new Promise<{ draftId: string }>((resolve) => {
    resolveDraft = resolve;
  });
  const { context } = createContext({
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        loading: true,
        warmed: true,
        deckClientId: "deck-1",
        projectId: "project-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return method === "session/draft" ? draftResult : Promise.resolve({});
    },
  });

  assert.equal(createSession("first", undefined, context), true);
  assert.equal(createSession("second", undefined, context), false);
  assert.deepEqual(dispatched.map(({ method }) => method), ["session/draft"]);

  resolveDraft({ draftId: "draft-codex-1" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched.map(({ method }) => method), ["session/draft", "session/prompt"]);
});

test("createSession consumes a ready draft only once while its prompt is pending", async () => {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  let resolvePrompt: (result: unknown) => void = () => undefined;
  const promptResult = new Promise((resolve) => {
    resolvePrompt = resolve;
  });
  const { context } = createContext({
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
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return method === "session/prompt" ? promptResult : Promise.resolve({});
    },
  });

  assert.equal(createSession("first", undefined, context), true);
  assert.equal(createSession("second", undefined, context), false);
  assert.deepEqual(dispatched.map(({ method }) => method), ["session/prompt"]);

  resolvePrompt({});
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(context.newSessionPromptPendingScopesRef.current.size, 0);
});

test("createSession restores the first prompt when draft activation fails", async () => {
  const restored: Array<{ prompt: string; content: unknown }> = [];
  const { context } = createContext({
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        loading: true,
        warmed: true,
        deckClientId: "deck-1",
        projectId: "project-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    dispatch: () => Promise.reject(new Error("draft failed")),
    restoreInitialPrompt: (prompt: string, content: unknown) => {
      restored.push({ prompt, content });
    },
  });

  assert.equal(createSession("hello", [{ type: "text", text: "hello" }], context), true);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(restored, [{
    prompt: "hello",
    content: [{ type: "text", text: "hello" }],
  }]);
  assert.equal(context.newSessionPromptPendingScopesRef.current.size, 0);
});

test("createSession allows prompts for different draft scopes concurrently", async () => {
  const dispatched: Array<{ method: string; params: any }> = [];
  const pendingScopesRef = { current: new Set<string>() };
  let resolveCodexDraft: (result: { draftId: string }) => void = () => undefined;
  let resolveClaudePrompt: (result: unknown) => void = () => undefined;
  const codexDraftResult = new Promise<{ draftId: string }>((resolve) => {
    resolveCodexDraft = resolve;
  });
  const claudePromptResult = new Promise((resolve) => {
    resolveClaudePrompt = resolve;
  });
  const dispatch = (_client: unknown, method: string, params: any) => {
    dispatched.push({ method, params });
    if (method === "session/draft") {
      return codexDraftResult;
    }
    if (method === "session/prompt" && params.draftId === "draft-claude-1") {
      return claudePromptResult;
    }
    return Promise.resolve({});
  };
  const { context: codexContext } = createContext({
    newSessionPromptPendingScopesRef: pendingScopesRef,
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        loading: true,
        warmed: true,
        deckClientId: "deck-1",
        projectId: "project-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    dispatch,
  });
  const { context: claudeContext } = createContext({
    selectedAgentId: "claude",
    filteredAgents: [
      { id: "codex", name: "Codex" },
      { id: "claude", name: "Claude" },
    ],
    newSessionPromptPendingScopesRef: pendingScopesRef,
    agentModelOptions: {
      "claude::D:/repo::project-1": {
        loading: false,
        warmed: true,
        draftId: "draft-claude-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    dispatch,
  });

  assert.equal(createSession("codex prompt", undefined, codexContext), true);
  assert.equal(createSession("claude prompt", undefined, claudeContext), true);
  assert.deepEqual(
    dispatched.map(({ method, params }) => [method, params.draftId ?? params.agentId]),
    [
      ["session/draft", "codex"],
      ["session/prompt", "draft-claude-1"],
    ],
  );

  resolveCodexDraft({ draftId: "draft-codex-1" });
  resolveClaudePrompt({});
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pendingScopesRef.current.size, 0);
});
