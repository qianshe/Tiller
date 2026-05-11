import assert from "node:assert/strict";
import test from "node:test";
import { requestReconnectAttempt } from "./reconnect-attempt.js";

test("requestReconnectAttempt retries the same route/profile after a failed auto reconnect", () => {
  let scheduled: () => void = () => assert.fail("reconnect retry was not scheduled");
  let calls = 0;
  const autoConnectAttemptRef = { current: "live:sessions:127.0.0.1:47631" };
  const manualDisconnectRef = { current: null };

  const cleanup = requestReconnectAttempt({
    activeProfileId: "127.0.0.1:47631",
    attemptKey: "live:sessions:127.0.0.1:47631",
    autoConnectAttemptRef,
    manualDisconnectRef,
    connectToDaemon: () => {
      calls += 1;
    },
    setTimeout: (handler) => {
      scheduled = handler;
      return 1;
    },
    clearTimeout: () => undefined,
  });

  assert.equal(calls, 0);
  scheduled();
  assert.equal(calls, 1);
  cleanup();
});

test("requestReconnectAttempt starts immediately for a new attempt key", () => {
  let calls = 0;
  const autoConnectAttemptRef = { current: null };

  requestReconnectAttempt({
    activeProfileId: "127.0.0.1:47631",
    attemptKey: "live:sessions:127.0.0.1:47631",
    autoConnectAttemptRef,
    manualDisconnectRef: { current: null },
    connectToDaemon: () => {
      calls += 1;
    },
  });

  assert.equal(calls, 1);
  assert.equal(autoConnectAttemptRef.current, "live:sessions:127.0.0.1:47631");
});

test("requestReconnectAttempt does not retry after manual disconnect", () => {
  let scheduled = false;
  let calls = 0;
  const activeProfileId = "127.0.0.1:47631";

  requestReconnectAttempt({
    activeProfileId,
    attemptKey: `live:sessions:${activeProfileId}`,
    autoConnectAttemptRef: { current: `live:sessions:${activeProfileId}` },
    manualDisconnectRef: { current: activeProfileId },
    connectToDaemon: () => {
      calls += 1;
    },
    setTimeout: () => {
      scheduled = true;
      return 1;
    },
    clearTimeout: () => undefined,
  });

  assert.equal(scheduled, false);
  assert.equal(calls, 0);
});
