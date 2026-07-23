import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionRestoreGate } from "./session-state.js";

function sessionWithResume(resume: any) {
  return {
    id: "session-1",
    status: "idle",
    resume,
  } as any;
}

test("restore gate allows active same-process sessions to continue chatting", () => {
  const gate = resolveSessionRestoreGate({
    activeSession: sessionWithResume({
      state: "resume-available",
      mode: "same-process",
      restoreMethod: "client-reconnect",
    }),
    activeSessionStatus: "idle",
    resumeStartPending: false,
  });

  assert.equal(gate.canChat, true);
  assert.equal(gate.state, "ready");
});

test("restore gate ignores stale pending flags after same-process resume is authoritative", () => {
  const gate = resolveSessionRestoreGate({
    activeSession: sessionWithResume({
      state: "resume-available",
      mode: "same-process",
      restoreMethod: "client-reconnect",
    }),
    activeSessionStatus: "idle",
    resumeStartPending: true,
  });

  assert.equal(gate.canChat, true);
  assert.equal(gate.state, "ready");
});

test("restore gate blocks historical sessions until ACP restore succeeds", () => {
  const gate = resolveSessionRestoreGate({
    activeSession: sessionWithResume({
      state: "resume-available",
      mode: "reconnect",
      restoreMethod: "session/load",
    }),
    activeSessionStatus: "idle",
    resumeStartPending: true,
  });

  assert.equal(gate.canChat, false);
  assert.equal(gate.state, "restoring");
  assert.match(gate.message, /正在恢复 ACP 会话/);
});

test("restore gate reports history-only sessions as not chat-capable", () => {
  const gate = resolveSessionRestoreGate({
    activeSession: sessionWithResume({
      state: "history-only",
      mode: "none",
      restoreMethod: "ui-history",
    }),
    activeSessionStatus: "idle",
    resumeStartPending: false,
  });

  assert.equal(gate.canChat, false);
  assert.equal(gate.state, "history-only");
  assert.match(gate.message, /仅可查看历史/);
});
