import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";

test("session RPC lists paged sessions", async () => {
  const sessions = [{ id: "s1", updatedAt: "2026-05-06T00:00:00.000Z" }];
  const result = await handleSessionRpcRequest("session/list", { limit: 20 }, {
    sessionStore: { list: () => sessions },
    migrateStoredSessionSummary: (item: unknown) => item,
    logInfo: () => undefined,
  } as any);

  assert.deepEqual(result, {
    sessions,
    nextCursor: undefined,
    hasMore: false,
    before: undefined,
  });
});

test("session RPC notification cancels active runtime", async () => {
  let cancelled = false;
  const handled = await handleSessionRpcNotification("session/cancel", { sessionId: "s1" }, {
    sessions: new Map([["s1", { runtime: { cancel: () => { cancelled = true; } } }]]),
  } as any);

  assert.equal(handled, true);
  assert.equal(cancelled, true);
});
