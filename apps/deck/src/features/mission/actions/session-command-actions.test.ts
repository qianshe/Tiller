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
    approvalToastQueue: [],
  } as any);
}

function createActions(overrides: Record<string, unknown> = {}) {
  const dispatched: Array<{ method: string; params: unknown }> = [];
  const options = {
    prompt: "",
    promptImages: [],
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
    dispatch: (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
      return Promise.resolve({});
    },
    normalizeModelSelection: (model: string) => model,
    selectedModel: "provider-default",
    navigateToView: () => undefined,
    setPrompt: () => undefined,
    setPromptImages: () => undefined,
    createClientUserMessageId: () => "client-message-1",
    appendUserMessage: () => undefined,
    permissionRequests: {},
    resumeStartRequestsRef: { current: new Set<string>() },
    setResumeFeedback: () => undefined,
    ...overrides,
  } as any;

  return { actions: useSessionCommandActions(options), dispatched };
}

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
