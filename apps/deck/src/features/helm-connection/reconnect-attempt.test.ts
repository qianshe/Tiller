import assert from "node:assert/strict";
import test from "node:test";
import {
  requestReconnectAttempt,
  getReconnectAttemptFailureCount,
  clearReconnectAttemptFailure,
  resumeReconnectAttempt,
} from "./reconnect-attempt.js";

test("requestReconnectAttempt retries the same route/profile after a failed auto reconnect", () => {
  clearReconnectAttemptFailure("live:sessions:127.0.0.1:47631");
  const scheduled: Array<() => void> = [];
  let calls = 0;
  const autoConnectAttemptRef = { current: null as string | null };
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
      scheduled.push(handler);
      return 1;
    },
    clearTimeout: () => undefined,
  });

  assert.equal(calls, 1);
  assert.equal(scheduled.length, 1);
  scheduled.shift()!();
  assert.equal(calls, 2);
  assert.equal(scheduled.length, 1);
  cleanup();
});

test("requestReconnectAttempt backs off retry delays after repeated failures", () => {
  clearReconnectAttemptFailure("live:sessions:127.0.0.1:47631");
  const delays: number[] = [];
  const handlers: Array<() => void> = [];
  let calls = 0;
  const attemptKey = "live:sessions:127.0.0.1:47631";
  const autoConnectAttemptRef = { current: null as string | null };
  const manualDisconnectRef = { current: null };

  // 同一 attemptKey 下连续四次失败，观察每次调度延迟递增（1.5s -> 3s -> 6s -> 12s）。
  for (let i = 0; i < 4; i += 1) {
    requestReconnectAttempt({
      activeProfileId: "127.0.0.1:47631",
      attemptKey,
      autoConnectAttemptRef,
      manualDisconnectRef,
      connectToDaemon: () => {
        calls += 1;
      },
      setTimeout: (_handler, timeoutMs) => {
        delays.push(Number(timeoutMs));
        handlers.push(_handler);
        return delays.length;
      },
    });
    if (i < 4) {
      handlers.shift()!();
    }
  }

  assert.deepEqual(delays, [1_500, 3_000, 6_000, 12_000, 30_000]);
  assert.equal(calls, 5);
  // 第 5 次起封顶至 30s。
  assert.equal(getReconnectAttemptFailureCount(attemptKey), 5);
  clearReconnectAttemptFailure(attemptKey);
});

test("requestReconnectAttempt starts immediately for a new attempt key", () => {
  clearReconnectAttemptFailure("live:sessions:127.0.0.1:47631");
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

test("requestReconnectAttempt pauses a retry while the page is hidden and resumes immediately", () => {
  clearReconnectAttemptFailure("live:sessions:127.0.0.1:47631");
  let visible = true;
  const handlers: Array<() => void> = [];
  let calls = 0;
  const attemptKey = "live:sessions:127.0.0.1:47631";
  const autoConnectAttemptRef = { current: null as string | null };

  requestReconnectAttempt({
    activeProfileId: "127.0.0.1:47631",
    attemptKey,
    autoConnectAttemptRef,
    manualDisconnectRef: { current: null },
    connectToDaemon: () => {
      calls += 1;
    },
    isPageVisible: () => visible,
    setTimeout: (handler) => {
      handlers.push(handler);
      return handlers.length;
    },
    clearTimeout: () => undefined,
  });

  visible = false;
  handlers.shift()!();
  assert.equal(calls, 1);
  assert.equal(handlers.length, 0);

  visible = true;
  resumeReconnectAttempt(attemptKey);
  assert.equal(calls, 2);
  clearReconnectAttemptFailure(attemptKey);
});

test("requestReconnectAttempt does not retry after manual disconnect", () => {
  clearReconnectAttemptFailure("live:sessions:127.0.0.1:47631");
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

test("requestReconnectAttempt stops an already scheduled retry after manual disconnect", () => {
  const activeProfileId = "127.0.0.1:47631";
  const attemptKey = `live:sessions:${activeProfileId}`;
  clearReconnectAttemptFailure(attemptKey);
  let scheduled: () => void = () => assert.fail("reconnect retry was not scheduled");
  let calls = 0;
  const manualDisconnectRef = { current: null as string | null };

  requestReconnectAttempt({
    activeProfileId,
    attemptKey,
    autoConnectAttemptRef: { current: null },
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

  assert.equal(calls, 1);
  manualDisconnectRef.current = activeProfileId;
  scheduled();
  assert.equal(calls, 1);
});
