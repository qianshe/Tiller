import type {
  CanonicalApprovalState,
  CanonicalSessionState,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionApprovalStore } from "../session-approval-store";
import { openSessionDatabase, runTransaction } from "./core";
import { createSessionStateReplacer } from "./session-state-store";
import { createSessionUpdateInserter, maybeCompactSessionUpdates } from "./session-update-store";

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
    ) {
      return runTransaction(db, () => {
        insertUpdate(update);
        replaceSessionState(update.sessionId, sessionState);
        const committed = replace(update.sessionId, approvalState);
        maybeCompactSessionUpdates(db, update);
        return committed;
      });
    },
    remove(sessionId) {
      removeStatement.run(sessionId);
    },
    close() {
      db.close();
    },
  };
}
