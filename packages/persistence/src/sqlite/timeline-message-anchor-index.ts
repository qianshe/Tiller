import type { SessionTimelineMessageGroupAnchor } from "../timeline-store";
import { runTransaction, type DatabaseSync } from "./core";

type TimelineMessageAnchorRow = {
  session_id: string;
  group_id: string;
  group_kind: "user" | "assistant";
  anchor_position: number;
  start_position: number;
  anchor_timestamp: string;
};

export function createSqliteTimelineMessageAnchorIndex(db: DatabaseSync) {
  return {
    isInitialized(sessionId: string) {
      return Boolean(db.prepare(`
        SELECT 1
        FROM session_timeline_anchor_states
        WHERE session_id = ?
        LIMIT 1
      `).get(sessionId));
    },
    listNewestAnchors(sessionId: string, beforeAnchorPosition?: number, limit = 50) {
      const params: Array<string | number> = beforeAnchorPosition === undefined
        ? [sessionId, normalizeAnchorLimit(limit)]
        : [sessionId, beforeAnchorPosition, normalizeAnchorLimit(limit)];
      const sql = beforeAnchorPosition === undefined
        ? `
          SELECT *
          FROM session_timeline_message_anchors
          WHERE session_id = ?
          ORDER BY anchor_position DESC, group_id DESC
          LIMIT ?
        `
        : `
          SELECT *
          FROM session_timeline_message_anchors
          WHERE session_id = ? AND anchor_position < ?
          ORDER BY anchor_position DESC, group_id DESC
          LIMIT ?
        `;
      return (db.prepare(sql).all(...params) as TimelineMessageAnchorRow[]).map(rowToAnchorRecord);
    },

    listNewestUserAnchors(sessionId: string, beforeAnchorPosition?: number, limit = 50) {
      const params: Array<string | number> = beforeAnchorPosition === undefined
        ? [sessionId, "user", normalizeAnchorLimit(limit)]
        : [sessionId, "user", beforeAnchorPosition, normalizeAnchorLimit(limit)];
      const sql = beforeAnchorPosition === undefined
        ? `
          SELECT *
          FROM session_timeline_message_anchors
          WHERE session_id = ? AND group_kind = ?
          ORDER BY anchor_position DESC, group_id DESC
          LIMIT ?
        `
        : `
          SELECT *
          FROM session_timeline_message_anchors
          WHERE session_id = ? AND group_kind = ? AND anchor_position < ?
          ORDER BY anchor_position DESC, group_id DESC
          LIMIT ?
        `;
      return (db.prepare(sql).all(...params) as TimelineMessageAnchorRow[]).map(rowToAnchorRecord);
    },

    getAnchor(sessionId: string, anchorPosition: number, groupId?: string) {
      const row = groupId
        ? db.prepare(`
          SELECT *
          FROM session_timeline_message_anchors
          WHERE session_id = ? AND anchor_position = ? AND group_id = ?
          LIMIT 1
        `).get(sessionId, anchorPosition, groupId) as TimelineMessageAnchorRow | undefined
        : db.prepare(`
          SELECT *
          FROM session_timeline_message_anchors
          WHERE session_id = ? AND anchor_position = ?
          LIMIT 1
        `).get(sessionId, anchorPosition) as TimelineMessageAnchorRow | undefined;
      return row ? rowToAnchorRecord(row) : undefined;
    },

    getAnchorAtOrBefore(sessionId: string, position: number) {
      const row = db.prepare(`
        SELECT *
        FROM session_timeline_message_anchors
        WHERE session_id = ? AND start_position <= ?
        ORDER BY start_position DESC, anchor_position DESC
        LIMIT 1
      `).get(sessionId, position) as TimelineMessageAnchorRow | undefined;
      return row ? rowToAnchorRecord(row) : undefined;
    },

    listGroupIdsBefore(sessionId: string, startPosition: number) {
      return (db.prepare(`
        SELECT group_id
        FROM session_timeline_message_anchors
        WHERE session_id = ? AND start_position < ?
      `).all(sessionId, startPosition) as Array<{ group_id: string }>).map((row) => row.group_id);
    },

    replaceSessionAnchors(sessionId: string, anchors: SessionTimelineMessageGroupAnchor[]) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_timeline_message_anchors WHERE session_id = ?").run(sessionId);
        const insert = db.prepare(`
          INSERT OR REPLACE INTO session_timeline_message_anchors(
            session_id,
            group_id,
            group_kind,
            anchor_position,
            start_position,
            anchor_timestamp
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const anchor of anchors) {
          insert.run(
            sessionId,
            anchor.groupId,
            anchor.groupKind,
            anchor.anchorPosition,
            anchor.startPosition,
            anchor.anchorTimestamp,
          );
        }
        markInitialized(db, sessionId);
      });
    },

    replaceAnchorsFrom(
      sessionId: string,
      startPosition: number,
      anchors: SessionTimelineMessageGroupAnchor[],
    ) {
      db.prepare(`
        DELETE FROM session_timeline_message_anchors
        WHERE session_id = ? AND (start_position >= ? OR anchor_position >= ?)
      `).run(sessionId, startPosition, startPosition);
      const insert = db.prepare(`
        INSERT OR REPLACE INTO session_timeline_message_anchors(
          session_id,
          group_id,
          group_kind,
          anchor_position,
          start_position,
          anchor_timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const anchor of anchors) {
        insert.run(
          sessionId,
          anchor.groupId,
          anchor.groupKind,
          anchor.anchorPosition,
          anchor.startPosition,
          anchor.anchorTimestamp,
        );
      }
      markInitialized(db, sessionId);
    },

    removeSession(sessionId: string) {
      db.prepare("DELETE FROM session_timeline_message_anchors WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_timeline_anchor_states WHERE session_id = ?").run(sessionId);
    },
  };
}

function markInitialized(db: DatabaseSync, sessionId: string) {
  db.prepare(`
    INSERT INTO session_timeline_anchor_states(session_id, initialized_at)
    VALUES (?, ?)
    ON CONFLICT(session_id) DO UPDATE SET initialized_at = excluded.initialized_at
  `).run(sessionId, new Date().toISOString());
}

function normalizeAnchorLimit(limit: number | undefined) {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return 50;
  }
  return Math.min(limit, 500);
}

function rowToAnchorRecord(row: TimelineMessageAnchorRow): SessionTimelineMessageGroupAnchor {
  return {
    groupId: row.group_id,
    groupKind: row.group_kind,
    anchorPosition: row.anchor_position,
    startPosition: row.start_position,
    anchorTimestamp: row.anchor_timestamp,
  };
}
