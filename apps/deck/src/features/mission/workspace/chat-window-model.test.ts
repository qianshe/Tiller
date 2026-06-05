import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { buildChatWindowModel } from "./chat-window-model";

function session(id: string): SessionSummary {
  return {
    id,
    title: id,
    projectId: "project-1",
    cwd: "D:/repo",
    agentId: "codex",
    status: "idle",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  } as SessionSummary;
}

test("chat window model focuses draft when the draft window is selected", () => {
  const model = buildChatWindowModel({
    sessions: [session("session-1")],
    activeSessionId: "session-1",
    activeSession: session("session-1"),
    openChatSessionIds: ["session-1"],
    focusedChatWindowId: "draft-1",
    draftChatWindow: { id: "draft-1", projectId: "project-1", cwd: "D:/repo", agentId: "codex" },
  });

  assert.equal(model.focusedDraftWindow?.id, "draft-1");
  assert.equal(model.focusedRealSessionId, null);
  assert.equal(model.selectedComposerSession, null);
  assert.deepEqual(model.visibleChatSessionIds, ["session-1"]);
});

test("chat window model falls back to active session and includes it in visible sessions", () => {
  const active = session("session-1");
  const model = buildChatWindowModel({
    sessions: [active, session("session-2")],
    activeSessionId: "session-1",
    activeSession: active,
    openChatSessionIds: ["session-2"],
    focusedChatWindowId: null,
    draftChatWindow: null,
  });

  assert.equal(model.focusedDraftWindow, null);
  assert.equal(model.focusedRealSessionId, null);
  assert.deepEqual(model.visibleChatSessionIds, ["session-1", "session-2"]);
  assert.deepEqual(model.openSessions.map((item) => item.id), ["session-1", "session-2"]);
  assert.equal(model.openSessionIdSet.has("session-2"), true);
  assert.equal(model.selectedComposerSession?.id, "session-1");
});

test("chat window model resolves focused real session from prefixed window id", () => {
  const model = buildChatWindowModel({
    sessions: [session("session-1"), session("session-2")],
    activeSessionId: "session-1",
    activeSession: session("session-1"),
    openChatSessionIds: ["session-2"],
    focusedChatWindowId: "session:session-2",
    draftChatWindow: null,
  });

  assert.equal(model.focusedRealSessionId, "session-2");
  assert.equal(model.selectedComposerSession?.id, "session-2");
});
