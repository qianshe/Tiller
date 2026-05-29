import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  PermissionRequest,
  SessionSummary,
} from "@tiller/shared";
import {
  resolveChatSessionMessages,
  resolveChatSessionToolCalls,
  resolveChatSessionToolLoading,
} from "./chat-session-state";

const activeSession = {
  id: "active-session",
  status: "running",
} as SessionSummary;
const backgroundSession = {
  id: "background-session",
  status: "running",
} as SessionSummary;

test("resolveChatSessionMessages falls back to active session messages", () => {
  const activeMessages = [{ id: "message-1" }] as AgentMessage[];

  assert.equal(
    resolveChatSessionMessages(activeSession, {
      activeSessionId: activeSession.id,
      activeSessionMessages: activeMessages,
      sessionMessagesById: {},
    }),
    activeMessages,
  );
});

test("resolveChatSessionToolCalls prefers cached calls for non-active sessions", () => {
  const backgroundToolCalls = [
    { id: "tool-1", kind: "shell", status: "running", title: "Tool: shell" },
  ] as AgentToolCall[];

  assert.equal(
    resolveChatSessionToolCalls(backgroundSession, {
      activeSessionId: activeSession.id,
      activeSessionToolCalls: [],
      sessionToolCallsById: { [backgroundSession.id]: backgroundToolCalls },
    }),
    backgroundToolCalls,
  );
});

test("resolveChatSessionToolLoading keeps active stream loading state authoritative", () => {
  const loading = resolveChatSessionToolLoading(activeSession, {
    activeSessionId: activeSession.id,
    activeSessionMessages: [],
    activeSessionToolCalls: [],
    sessionMessagesById: {},
    sessionToolCallsById: {},
    activityLoading: { title: "Tool: shell" },
    pendingToolPresent: true,
    pendingApprovals: [],
  });

  assert.deepEqual(loading, {
    activity: { title: "Tool: shell" },
    pendingToolPresent: true,
  });
});

test("resolveChatSessionToolLoading derives background loading without approval noise", () => {
  const approval = { id: "approval-1" } as PermissionRequest;

  assert.equal(
    resolveChatSessionToolLoading(backgroundSession, {
      activeSessionId: activeSession.id,
      activeSessionMessages: [],
      activeSessionToolCalls: [],
      sessionMessagesById: { [backgroundSession.id]: [] },
      sessionToolCallsById: { [backgroundSession.id]: [] },
      activityLoading: null,
      pendingToolPresent: false,
      pendingApprovals: [{ sessionId: backgroundSession.id, request: approval }],
    }),
    undefined,
  );
});
