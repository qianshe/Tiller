import assert from "node:assert/strict";
import test from "node:test";
import { useDeckStore } from "../../../store";
import { useSessionCommandActions } from "./session-command-actions.js";

(globalThis as any).WebSocket ??= { OPEN: 1 };

function resetApprovals() {
  useDeckStore.setState({
    approvalItemsById: {},
    pendingApprovalIds: [],
    pendingApprovalIdsBySession: {},
  } as any);
}

function createActions(overrides: Record<string, unknown> = {}) {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  const options = {
    prompt: "",
    promptImages: [],
    draftContexts: [],
    socketRef: { current: null },
    rpcClientRef: { current: { socket: { readyState: (globalThis as any).WebSocket.OPEN } } },
    setImagePasteNotice: () => undefined,
    activeSessionId: null,
    activeSession: null,
    statuses: {},
    projects: [],
    filteredWorktrees: [],
    filteredAgents: [],
    pendingPromptRef: { current: null },
    pendingPromptContentRef: { current: undefined },
    newSessionPromptPendingScopesRef: { current: new Set<string>() },
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return Promise.resolve({});
    },
    normalizeModelSelection: (model: string) => model,
    selectedModel: "provider-default",
    navigateToView: () => undefined,
    setPrompt: () => undefined,
    setPromptImages: () => undefined,
    clearDraftContexts: () => undefined,
    createClientUserMessageId: () => "client-message-1",
    appendUserMessage: () => undefined,
    permissionRequests: {},
    resumeStartRequestsRef: { current: new Set<string>() },
    setResumeStartRequestIds: () => undefined,
    setResumeFeedback: () => undefined,
    ...overrides,
  } as any;

  return { actions: useSessionCommandActions(options), dispatched };
}

test("requestSessionResumeStart exposes restoring sessions reactively", () => {
  let restoringSessionIds = new Set<string>();
  const { actions, dispatched } = createActions({
    setResumeStartRequestIds: (update: (current: Set<string>) => Set<string>) => {
      restoringSessionIds = update(restoringSessionIds);
    },
  });

  actions.requestSessionResumeStart("session-restore", "正在恢复");

  assert.deepEqual([...restoringSessionIds], ["session-restore"]);
  assert.deepEqual(dispatched, [
    { method: "session/resume", params: { sessionId: "session-restore" } },
  ]);
});

test("respondToPermission dispatches approval response without requiring an active session", () => {
  resetApprovals();
  useDeckStore.getState().upsertApproval({
    sessionId: "s2",
    request: {
      id: "approval-dashboard",
      command: "MCP • sanshu/zhi :: {}",
      reason: "Approve MCP tool call",
      cwd: "D:/repo",
    } as any,
  });
  const { actions, dispatched } = createActions({ activeSessionId: null });

  actions.respondToPermission("approval-dashboard", "allow");

  assert.deepEqual(dispatched, [
    {
      method: "approval/respond",
      params: { approvalRequestId: "approval-dashboard", decision: "allow" },
    },
  ]);
  assert.equal(
    useDeckStore.getState().approvalItemsById["approval-dashboard"]?.resolving,
    true,
  );
});

test("submitPromptFromKeyboard requests submit on desktop Enter", () => {
  const { actions } = createActions();
  let prevented = false;
  let submitted = false;

  actions.submitPromptFromKeyboard({
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    nativeEvent: { isComposing: false },
    preventDefault: () => {
      prevented = true;
    },
    currentTarget: {
      form: {
        requestSubmit: () => {
          submitted = true;
        },
      },
    },
  } as any);

  assert.equal(prevented, true);
  assert.equal(submitted, true);
});

test("submitPromptFromKeyboard leaves mobile Enter to the textarea", () => {
  const { actions } = createActions({ isMobile: true });
  let prevented = false;
  let submitted = false;

  actions.submitPromptFromKeyboard({
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    nativeEvent: { isComposing: false },
    preventDefault: () => {
      prevented = true;
    },
    currentTarget: {
      form: {
        requestSubmit: () => {
          submitted = true;
        },
      },
    },
  } as any);

  assert.equal(prevented, false);
  assert.equal(submitted, false);
});

test("submitPrompt refuses an existing session until its timeline is loaded", () => {
  const activeSession = {
    id: "session-1",
    status: "idle",
    resume: {
      state: "resume-available",
      mode: "same-process",
      restoreMethod: "client-reconnect",
    },
  };
  const { actions, dispatched } = createActions({
    prompt: "hello",
    activeSessionId: activeSession.id,
    activeSession,
    statuses: { [activeSession.id]: "idle" },
    messageHistoryState: {},
    sessionTimeline: {},
  });
  let prevented = false;

  actions.submitPrompt({
    preventDefault: () => {
      prevented = true;
    },
  } as any);

  assert.equal(prevented, true);
  assert.deepEqual(dispatched, []);
});

test("submitPrompt refuses a selected session id before its summary and timeline load", () => {
  const { actions, dispatched } = createActions({
    prompt: "hello",
    activeSessionId: "session-loading",
    activeSession: null,
    messageHistoryState: {},
    sessionTimeline: {},
  });

  actions.submitPrompt({ preventDefault: () => undefined } as any);

  assert.deepEqual(dispatched, []);
});

test("failed draft activation restores cleared text and images", async () => {
  const image = { type: "image" as const, data: "abc", mimeType: "image/png" };
  let promptState = "";
  let imageState: typeof image[] = [];
  const { actions } = createActions({
    selectedProjectId: "project-1",
    projects: [{ id: "project-1", name: "Project", path: "D:/repo" }],
    selectedWorktree: { id: "worktree-1", name: "main", path: "D:/repo" },
    filteredWorktrees: [{ id: "worktree-1", name: "main", path: "D:/repo" }],
    selectedAgentId: "codex",
    filteredAgents: [{ id: "codex", name: "Codex" }],
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        warmed: true,
        draftId: "draft-codex-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    setPrompt: (update: string | ((current: string) => string)) => {
      promptState = typeof update === "function" ? update(promptState) : update;
    },
    setPromptImages: (update: typeof image[] | ((current: typeof image[]) => typeof image[])) => {
      imageState = typeof update === "function" ? update(imageState) : update;
    },
    dispatch: () => Promise.reject(new Error("draft activation failed")),
  });

  assert.equal(actions.createSession("hello", [
    { type: "text", text: "hello" },
    image,
  ]), true);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(promptState, "hello");
  assert.deepEqual(imageState, [image]);
});

test("failed draft activation preserves newer composer input", async () => {
  const originalImage = { type: "image" as const, data: "old", mimeType: "image/png" };
  const newImage = { type: "image" as const, data: "new", mimeType: "image/png" };
  let rejectPrompt: (error: Error) => void = () => undefined;
  const promptResult = new Promise((_resolve, reject) => {
    rejectPrompt = reject;
  });
  let promptState = "";
  let imageState: typeof originalImage[] = [];
  const { actions } = createActions({
    selectedProjectId: "project-1",
    projects: [{ id: "project-1", name: "Project", path: "D:/repo" }],
    selectedWorktree: { id: "worktree-1", name: "main", path: "D:/repo" },
    filteredWorktrees: [{ id: "worktree-1", name: "main", path: "D:/repo" }],
    selectedAgentId: "codex",
    filteredAgents: [{ id: "codex", name: "Codex" }],
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        warmed: true,
        draftId: "draft-codex-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
    setPrompt: (update: string | ((current: string) => string)) => {
      promptState = typeof update === "function" ? update(promptState) : update;
    },
    setPromptImages: (
      update: typeof originalImage[] | ((current: typeof originalImage[]) => typeof originalImage[]),
    ) => {
      imageState = typeof update === "function" ? update(imageState) : update;
    },
    dispatch: () => promptResult,
  });

  assert.equal(actions.createSession("old", [
    { type: "text", text: "old" },
    originalImage,
  ]), true);
  promptState = "new";
  imageState = [newImage];
  rejectPrompt(new Error("draft activation failed"));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(promptState, "new");
  assert.deepEqual(imageState, [newImage]);
});
