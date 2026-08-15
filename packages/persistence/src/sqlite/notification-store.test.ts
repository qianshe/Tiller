import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteNotificationStore } from "./notification-store.js";

test("notification history survives reopening the SQLite store", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "tiller-notifications-")), "sessions.sqlite");
  const first = createSqliteNotificationStore(dbPath);
  const stored = first.append({
    kind: "warning",
    source: "storage",
    code: "STORAGE_DEGRADED",
    message: "Storage is temporarily unavailable.",
    occurredAt: "2026-07-18T12:00:00.000Z",
  });
  first.close();

  const reopened = createSqliteNotificationStore(dbPath);
  assert.deepEqual(reopened.list({ limit: 10 }), [stored]);
  reopened.close();
});

test("notification clear removes history and survives reopening", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "tiller-notifications-clear-")), "sessions.sqlite");
  const first = createSqliteNotificationStore(dbPath);
  first.append({
    kind: "warning",
    source: "storage",
    message: "Old notification",
    occurredAt: "2026-07-18T12:00:00.000Z",
  });

  const clearedAt = first.clear?.();
  assert.equal(typeof clearedAt, "string");
  assert.deepEqual(first.list({ limit: 10 }), []);
  first.close();

  const reopened = createSqliteNotificationStore(dbPath);
  assert.equal(reopened.getClearedAt?.(), clearedAt);
  assert.deepEqual(reopened.list({ limit: 10 }), []);
  const newNotification = reopened.append({
    kind: "info",
    source: "runtime",
    message: "New notification",
    occurredAt: "2099-01-01T00:00:00.000Z",
  });
  assert.deepEqual(reopened.list({ limit: 10 }), [newNotification]);
  reopened.close();
});
