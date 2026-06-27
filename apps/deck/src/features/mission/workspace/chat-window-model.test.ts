import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import {
  buildChatWindowModel,
  MAX_OPEN_CHAT_SESSION_WINDOWS,
} from "./chat-window-model";

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

test("chat window model keeps only the focused session visible in mission mobile mode", () => {
  const active = session("session-1");
  const focused = session("session-2");
  const hidden = session("session-3");
  const model = buildChatWindowModel({
    sessions: [active, focused, hidden],
    activeSessionId: active.id,
    activeSession: active,
    openChatSessionIds: [hidden.id, focused.id],
    focusedChatWindowId: `session:${focused.id}`,
    draftChatWindow: null,
    isMissionMobile: true,
  });

  assert.deepEqual(model.persistedOpenChatSessionIds, [hidden.id, focused.id]);
  assert.deepEqual(model.visibleChatSessionIds, [focused.id]);
  assert.deepEqual(model.openSessions.map((item) => item.id), [focused.id]);
  assert.deepEqual(Array.from(model.openSessionIdSet), [focused.id]);
  assert.equal(model.selectedComposerSession?.id, focused.id);
});

test("chat window model hides real sessions when the focused mobile window is a draft", () => {
  const active = session("session-1");
  const model = buildChatWindowModel({
    sessions: [active, session("session-2")],
    activeSessionId: active.id,
    activeSession: active,
    openChatSessionIds: [active.id],
    focusedChatWindowId: "draft:project-1",
    draftChatWindow: {
      id: "draft:project-1",
      projectId: "project-1",
      cwd: "D:/repo",
      agentId: "codex",
    },
    isMissionMobile: true,
  });

  assert.equal(model.focusedDraftWindow?.id, "draft:project-1");
  assert.deepEqual(model.visibleChatSessionIds, []);
  assert.deepEqual(model.openSessions, []);
  assert.deepEqual(Array.from(model.openSessionIdSet), []);
  assert.equal(model.selectedComposerSession, null);
});

test("chat window model falls back to the active session when mobile focus points to a missing session", () => {
  const active = session("session-1");
  const secondary = session("session-2");
  const model = buildChatWindowModel({
    sessions: [active, secondary],
    activeSessionId: active.id,
    activeSession: active,
    openChatSessionIds: [secondary.id],
    focusedChatWindowId: "session:missing-session",
    draftChatWindow: null,
    isMissionMobile: true,
  });

  assert.equal(model.focusedRealSessionId, "missing-session");
  assert.deepEqual(model.visibleChatSessionIds, [active.id]);
  assert.deepEqual(model.openSessions.map((item) => item.id), [active.id]);
  assert.deepEqual(Array.from(model.openSessionIdSet), [active.id]);
  assert.equal(model.selectedComposerSession?.id, active.id);
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

test("chat window model limits restored visible sessions to avoid oversized hydration", () => {
  const active = session("session-1");
  const restoredSessionIds = Array.from(
    { length: MAX_OPEN_CHAT_SESSION_WINDOWS },
    (_, index) => `session-${index + 2}`,
  );
  const model = buildChatWindowModel({
    sessions: [active, ...restoredSessionIds.map((id) => session(id))],
    activeSessionId: active.id,
    activeSession: active,
    openChatSessionIds: restoredSessionIds,
    focusedChatWindowId: `session:${restoredSessionIds.at(-1)}`,
    draftChatWindow: null,
  });

  assert.deepEqual(model.visibleChatSessionIds, [
    active.id,
    ...restoredSessionIds.slice(0, MAX_OPEN_CHAT_SESSION_WINDOWS - 1),
  ]);
  assert.deepEqual(
    model.openSessions.map((item) => item.id),
    model.visibleChatSessionIds,
  );
});
