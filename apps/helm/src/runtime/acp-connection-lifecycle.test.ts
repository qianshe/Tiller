import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunSessionOperation,
  preferRestoreStrategy,
} from "./acp-connection-lifecycle.js";

test("session operations are gated by advertised ACP capabilities", () => {
  const caps = { sessionLoad: true, sessionResume: false, sessionList: true };
  assert.equal(canRunSessionOperation(caps, "list"), true);
  assert.equal(canRunSessionOperation(caps, "load"), true);
  assert.equal(canRunSessionOperation(caps, "resume"), false);
});

test("restore strategy prefers load only when transcript replay is needed", () => {
  const caps = { sessionLoad: true, sessionResume: true };
  assert.equal(preferRestoreStrategy(caps, true), "load");
  assert.equal(preferRestoreStrategy(caps, false), "resume");
});

test("restore strategy falls back to load when resume is unavailable", () => {
  assert.equal(
    preferRestoreStrategy({ sessionLoad: true, sessionResume: false }, false),
    "load",
  );
  assert.equal(preferRestoreStrategy({}, true), null);
});
