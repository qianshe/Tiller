import assert from "node:assert/strict";
import test from "node:test";
import { createMissionVisualFixture, resolveMissionVisualSessionCount } from "./visual-fixture";

test("resolveMissionVisualSessionCount defaults to one session", () => {
  assert.equal(resolveMissionVisualSessionCount("?visual=mission"), 1);
  assert.equal(resolveMissionVisualSessionCount("?visual=mission&visualWindows=bad"), 1);
});

test("resolveMissionVisualSessionCount enables two visual windows", () => {
  assert.equal(resolveMissionVisualSessionCount("?visual=mission&visualWindows=2"), 2);
  assert.equal(resolveMissionVisualSessionCount("?visual=mission&visualWindows=3"), 2);
});

test("createMissionVisualFixture can build a two-window mission fixture", () => {
  const fixture = createMissionVisualFixture({
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "4269",
    visualSearch: "?visual=mission&visualWindows=2",
  });

  assert.equal(fixture.sessions.length, 2);
  assert.deepEqual(fixture.openChatSessionIds, ["visual-session", "visual-session-secondary"]);
  assert.equal(fixture.focusedChatWindowId, "session:visual-session");
  assert.ok(fixture.sessionPlans["visual-session"]);
  assert.ok(fixture.sessionPlans["visual-session-secondary"]);
  const messages = fixture.messages["visual-session"];
  assert.ok(messages);
  assert.ok(messages.length >= 6);
  assert.match(
    messages.map((message) => message.text).join("\n"),
    /浮层与滚动行为/,
  );
  const promptQueue = fixture.promptQueues["visual-session"];
  assert.ok(promptQueue);
  assert.equal(promptQueue.queued.length, 2);
  assert.deepEqual(fixture.pendingApprovalIdsBySession["visual-session"], [
    "visual-permission-1",
  ]);
  assert.ok(fixture.approvalItemsById["visual-permission-1"]);
});

test("createMissionVisualFixture can focus a restoring visual window", () => {
  const fixture = createMissionVisualFixture({
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "4269",
    visualSearch: "?visual=mission&visualWindows=2&visualRestore=1",
  });

  assert.equal(fixture.activeSessionId, "visual-session-secondary");
  assert.equal(fixture.focusedChatWindowId, "session:visual-session-secondary");
  assert.deepEqual(fixture.openChatSessionIds, ["visual-session", "visual-session-secondary"]);
  assert.equal(fixture.promptQueues["visual-session-secondary"]?.queued.length, 2);
});

test("createMissionVisualFixture can simulate dashboard status colors", () => {
  const fixture = createMissionVisualFixture({
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "4269",
    visualSearch: "?visual=mission&visualStatusDemo=1",
  });

  assert.equal(fixture.sessions.length, 4);
  assert.deepEqual(fixture.openChatSessionIds, [
    "visual-session",
    "visual-session-secondary",
    "visual-session-error",
  ]);
  assert.deepEqual(fixture.statuses, {
    "visual-session": "idle",
    "visual-session-secondary": "running",
    "visual-session-error": "error",
    "visual-session-idle": "idle",
  });
});
