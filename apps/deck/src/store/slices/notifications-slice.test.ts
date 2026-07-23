import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotificationsSlice,
  MAX_DECK_NOTIFICATIONS,
  type NotificationsSlice,
} from "./notifications-slice.js";
import { createStore } from "zustand/vanilla";

function createTestStore() {
  return createStore<NotificationsSlice>()((...args) => ({
    ...createNotificationsSlice(...args),
  }));
}

test("notifications keep runtime error context without prompt contents", () => {
  const store = createTestStore();
  store.getState().addNotification({
    kind: "error",
    message: "ACP connection closed",
    source: "runtime",
    code: "ACP_PROMPT_FAILED",
    sessionId: "session-1",
  });

  const notification = store.getState().notifications[0];
  assert.equal(notification?.message, "ACP connection closed");
  assert.equal(notification?.source, "runtime");
  assert.equal(notification?.code, "ACP_PROMPT_FAILED");
  assert.equal(notification?.sessionId, "session-1");
  assert.match(notification?.createdAt ?? "", /^20/);
  assert.equal("prompt" in notification!, false);
});

test("notifications omit absent optional context", () => {
  const store = createTestStore();
  store.getState().addNotification({
    kind: "warning",
    message: "Storage is temporarily unavailable",
    code: undefined,
    sessionId: undefined,
  });

  assert.deepEqual(store.getState().notifications[0], {
    id: store.getState().notifications[0]?.id,
    kind: "warning",
    message: "Storage is temporarily unavailable",
    source: "runtime",
    createdAt: store.getState().notifications[0]?.createdAt,
  });
});

test("duplicate notifications merge by source and keep the original timestamp", () => {
  const store = createTestStore();
  store.getState().addNotification({
    kind: "error",
    message: "Storage unavailable",
    source: "storage",
    code: "STORAGE_UNAVAILABLE",
  });
  store.getState().addNotification({
    kind: "error",
    message: "Storage unavailable",
    source: "storage",
  });

  assert.equal(store.getState().notifications.length, 1);
  assert.equal(store.getState().notifications[0]?.code, "STORAGE_UNAVAILABLE");
  assert.match(store.getState().notifications[0]?.createdAt ?? "", /^20/);
});

test("notifications are capped and can be cleared", () => {
  const store = createTestStore();
  for (let index = 0; index < MAX_DECK_NOTIFICATIONS + 5; index += 1) {
    store.getState().addNotification({ kind: "info", message: `notice-${index}` });
  }

  assert.equal(store.getState().notifications.length, MAX_DECK_NOTIFICATIONS);
  assert.equal(store.getState().notifications[0]?.message, `notice-${MAX_DECK_NOTIFICATIONS + 4}`);
  store.getState().clearNotifications();
  assert.deepEqual(store.getState().notifications, []);
});
