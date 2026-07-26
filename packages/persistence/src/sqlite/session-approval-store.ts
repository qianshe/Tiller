import type {
  ApprovalHistoryPage,
  ApprovalStatus,
  CanonicalApproval,
  CanonicalApprovalState,
  CanonicalSessionState,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionApprovalStore } from "../session-approval-store";
import { decodeCursor, encodeCursor, normalizePageLimit } from "../pagination";
import { openSessionDatabase, runTransaction } from "./core";
import { createSessionStateReplacer } from "./session-state-store";
import { createSessionUpdateInserter, maybeCompactSessionUpdates } from "./session-update-store";

const DEFAULT_APPROVAL_HISTORY_LIMIT = 100;
const MAX_APPROVAL_HISTORY_LIMIT = 200;

type ApprovalHistoryRow = {
  record_key: string;
  status: ApprovalStatus;
  sequence: number;
  updated_at: string;
  payload_json: string;
};

export function createSqliteSessionApprovalStore(dbPath: string): SessionApprovalStore {
  const db = openSessionDatabase(dbPath);
  const select = db.prepare(
    "SELECT applied_sequence, payload_json FROM session_approval_states WHERE session_id = ?",
  );
  const replaceStatement = db.prepare(`
    INSERT INTO session_approval_states(session_id, applied_sequence, updated_at, payload_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      applied_sequence = excluded.applied_sequence,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  const removeStatement = db.prepare(
    "DELETE FROM session_approval_states WHERE session_id = ?",
  );
  const removeHistoryStatement = db.prepare(
    "DELETE FROM session_approval_history WHERE session_id = ?",
  );
  const upsertHistoryStatement = db.prepare(`
    INSERT INTO session_approval_history(
      record_key,
      session_id,
      runtime_instance_id,
      approval_request_id,
      status,
      sequence,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_key) DO UPDATE SET
      status = excluded.status,
      sequence = excluded.sequence,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  const clearProcessedHistoryStatement = db.prepare(`
    DELETE FROM session_approval_history
    WHERE status IN ('resolved', 'expired')
  `);
  const insertUpdate = createSessionUpdateInserter(db);
  const replaceSessionState = createSessionStateReplacer(db);

  function replace(sessionId: string, state: CanonicalApprovalState) {
    replaceStatement.run(
      sessionId,
      state.sequence,
      new Date().toISOString(),
      JSON.stringify(state),
    );
    return state;
  }

  function upsertHistory(record: CanonicalApproval) {
    const normalized = {
      ...record,
      createdAt: record.createdAt ?? record.updatedAt,
    };
    upsertHistoryStatement.run(
      approvalRecordKey(normalized),
      normalized.sessionId,
      normalized.runtimeInstanceId,
      normalized.id,
      normalized.status,
      normalized.sequence,
      normalized.createdAt,
      normalized.updatedAt,
      JSON.stringify(normalized),
    );
  }

  return {
    get(sessionId) {
      const row = select.get(sessionId) as {
        applied_sequence: number;
        payload_json: string;
      } | undefined;
      if (!row) {
        return undefined;
      }
      const state = JSON.parse(row.payload_json) as CanonicalApprovalState;
      return { ...state, sequence: row.applied_sequence };
    },
    replace,
    commitUpdate(
      update: SessionUpdateRecord,
      approvalState: CanonicalApprovalState,
      sessionState: CanonicalSessionState,
      historyRecord?: CanonicalApproval,
    ) {
      return runTransaction(db, () => {
        insertUpdate(update);
        replaceSessionState(update.sessionId, sessionState);
        const committed = replace(update.sessionId, approvalState);
        if (historyRecord) {
          upsertHistory(historyRecord);
        }
        maybeCompactSessionUpdates(db, update);
        return committed;
      });
    },
    listHistory(options = {}) {
      return listApprovalHistory(db, options);
    },
    clearProcessedHistory() {
      const result = clearProcessedHistoryStatement.run() as { changes?: number };
      return result.changes ?? 0;
    },
    remove(sessionId) {
      runTransaction(db, () => {
        removeStatement.run(sessionId);
        removeHistoryStatement.run(sessionId);
      });
    },
    close() {
      db.close();
    },
  };
}

function listApprovalHistory(
  db: ReturnType<typeof openSessionDatabase>,
  options: { limit?: number; before?: string },
): ApprovalHistoryPage {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_APPROVAL_HISTORY_LIMIT,
    MAX_APPROVAL_HISTORY_LIMIT,
  );
  const before = decodeCursor(options.before, 2);
  const rows = queryApprovalHistory(db, before, limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    approvals: pageRows.map(rowToApproval),
    nextCursor: hasMore && last
      ? encodeCursor(last.updated_at, last.record_key)
      : undefined,
    hasMore,
  };
}

function queryApprovalHistory(
  db: ReturnType<typeof openSessionDatabase>,
  before: string[] | null,
  limit: number,
): ApprovalHistoryRow[] {
  if (!before) {
    return db.prepare(`
      SELECT record_key, status, sequence, updated_at, payload_json
      FROM session_approval_history
      ORDER BY updated_at DESC, record_key DESC
      LIMIT ?
    `).all(limit) as ApprovalHistoryRow[];
  }
  const [updatedAt, recordKey] = before;
  return db.prepare(`
    SELECT record_key, status, sequence, updated_at, payload_json
    FROM session_approval_history
    WHERE updated_at < ? OR (updated_at = ? AND record_key < ?)
    ORDER BY updated_at DESC, record_key DESC
    LIMIT ?
  `).all(updatedAt, updatedAt, recordKey, limit) as ApprovalHistoryRow[];
}

function rowToApproval(row: ApprovalHistoryRow): CanonicalApproval {
  const approval = JSON.parse(row.payload_json) as CanonicalApproval;
  return {
    ...approval,
    status: row.status,
    sequence: row.sequence,
    updatedAt: row.updated_at,
  };
}

function approvalRecordKey(approval: CanonicalApproval): string {
  return JSON.stringify([
    approval.sessionId,
    approval.runtimeInstanceId,
    approval.id,
  ]);
}
