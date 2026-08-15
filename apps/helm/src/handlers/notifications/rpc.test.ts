import assert from "node:assert/strict";
import test from "node:test";
import { handleNotificationRpcRequest } from "./rpc.js";

test("notification/list returns persisted Helm notification history", () => {
  const notifications = [{
    id: "notification-1",
    kind: "warning",
    source: "storage",
    message: "Storage unavailable",
    occurredAt: "2026-07-18T12:00:00.000Z",
  }];
  const result = handleNotificationRpcRequest(
    "notification/list",
    { limit: 10 },
    {
      notificationStore: {
        list: (options: { limit?: number }) => {
          assert.equal(options.limit, 10);
          return notifications;
        },
      },
    } as any,
  );

  assert.deepEqual(result, { notifications });
});

test("notification/list includes the persisted clear watermark", () => {
  const result = handleNotificationRpcRequest(
    "notification/list",
    { limit: 10 },
    {
      notificationStore: {
        list: () => [],
        getClearedAt: () => "2026-08-15T00:00:00.000Z",
      },
    } as any,
  );

  assert.deepEqual(result, {
    notifications: [],
    clearedAt: "2026-08-15T00:00:00.000Z",
  });
});

test("notification/clear clears Helm history and broadcasts to all clients", () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const clearedAt = "2026-08-15T00:00:00.000Z";
  const result = handleNotificationRpcRequest(
    "notification/clear",
    {},
    {
      notificationStore: {
        list: () => [],
        clear: () => clearedAt,
      },
      broadcastNotification: (method: string, params: unknown) => {
        calls.push({ method, params });
      },
    } as any,
  );

  assert.deepEqual(result, { ok: true, clearedAt });
  assert.deepEqual(calls, [{
    method: "notification/cleared",
    params: { clearedAt },
  }]);
});
