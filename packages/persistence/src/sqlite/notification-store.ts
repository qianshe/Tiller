import { randomUUID } from "node:crypto";
import type {
  NotificationStore,
  StoredNotification,
} from "../notification-store.js";
import { openSessionDatabase, runTransaction } from "./core.js";

const MAX_STORED_NOTIFICATIONS = 200;

export function createSqliteNotificationStore(dbPath: string): NotificationStore & {
  close: () => void;
} {
  const db = openSessionDatabase(dbPath);
  return {
    append(notification) {
      const stored: StoredNotification = {
        ...notification,
        id: notification.id ?? randomUUID(),
      };
      const clearedAt = readClearedAt();
      if (clearedAt && isAtOrBefore(stored.occurredAt, clearedAt)) {
        return stored;
      }
      db.prepare(`
        INSERT OR REPLACE INTO helm_notifications(id, occurred_at, payload_json)
        VALUES (?, ?, ?)
      `).run(stored.id, stored.occurredAt, JSON.stringify(stored));
      db.prepare(`
        DELETE FROM helm_notifications
        WHERE id NOT IN (
          SELECT id
          FROM helm_notifications
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        )
      `).run(MAX_STORED_NOTIFICATIONS);
      return stored;
    },
    list(options = {}) {
      const limit = normalizeLimit(options.limit);
      const clearedAt = readClearedAt();
      const rows = db.prepare(`
        SELECT payload_json
        FROM helm_notifications
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?
      `).all(MAX_STORED_NOTIFICATIONS) as Array<{ payload_json: string }>;
      return rows
        .map((row) => parseStoredNotification(row.payload_json))
        .filter((notification): notification is StoredNotification =>
          notification !== null
          && (!clearedAt || !isAtOrBefore(notification.occurredAt, clearedAt)),
        )
        .slice(0, limit);
    },
    clear() {
      return runTransaction(db, () => {
        const clearedAt = new Date().toISOString();
        db.prepare("DELETE FROM helm_notifications").run();
        db.prepare(`
          INSERT OR REPLACE INTO helm_notification_state(id, cleared_at)
          VALUES (1, ?)
        `).run(clearedAt);
        return clearedAt;
      });
    },
    getClearedAt() {
      return readClearedAt();
    },
    close() {
      db.close();
    },
  };

  function readClearedAt(): string | null {
    const row = db.prepare(
      "SELECT cleared_at FROM helm_notification_state WHERE id = 1",
    ).get() as { cleared_at?: unknown } | undefined;
    return typeof row?.cleared_at === "string" ? row.cleared_at : null;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 100;
  }
  return Math.max(1, Math.min(MAX_STORED_NOTIFICATIONS, Math.trunc(limit)));
}

function parseStoredNotification(value: string): StoredNotification | null {
  try {
    const candidate = JSON.parse(value) as Partial<StoredNotification>;
    return typeof candidate.id === "string"
      && (candidate.kind === "error" || candidate.kind === "warning" || candidate.kind === "info")
      && typeof candidate.source === "string"
      && typeof candidate.message === "string"
      && typeof candidate.occurredAt === "string"
      ? candidate as StoredNotification
      : null;
  } catch {
    return null;
  }
}

function isAtOrBefore(candidate: string, boundary: string): boolean {
  const candidateTime = Date.parse(candidate);
  const boundaryTime = Date.parse(boundary);
  return Number.isFinite(candidateTime)
    && Number.isFinite(boundaryTime)
    && candidateTime <= boundaryTime;
}
