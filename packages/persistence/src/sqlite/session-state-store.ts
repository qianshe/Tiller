import type { CanonicalSessionState, SessionUpdateRecord } from "@tiller/shared";
import type { SessionStateStore } from "../session-state-store";
import { openSessionDatabase, runTransaction } from "./core";
import { createSessionUpdateInserter, maybeCompactSessionUpdates } from "./session-update-store";

export function createSqliteSessionStateStore(dbPath: string): SessionStateStore {
  const db = openSessionDatabase(dbPath);
  const select = db.prepare(
    "SELECT applied_sequence, payload_json FROM session_states WHERE session_id = ?",
  );
  const replace = createSessionStateReplacer(db);
  const remove = db.prepare("DELETE FROM session_states WHERE session_id = ?");
  const insertUpdate = createSessionUpdateInserter(db);

  return {
    get(sessionId) {
      const row = select.get(sessionId) as {
        applied_sequence: number;
        payload_json: string;
      } | undefined;
      if (!row) {
        return undefined;
      }
      const state = JSON.parse(row.payload_json) as CanonicalSessionState;
      return {
        ...state,
        sequence: row.applied_sequence,
      };
    },
    getAppliedSequence(sessionId) {
      const row = select.get(sessionId) as { applied_sequence: number } | undefined;
      return row?.applied_sequence ?? 0;
    },
    replace: (sessionId, state) => replace(sessionId, state),
    commitUpdate(update: SessionUpdateRecord, state: CanonicalSessionState) {
      return runTransaction(db, () => {
        insertUpdate(update);
        const committed = replace(update.sessionId, state);
        maybeCompactSessionUpdates(db, update);
        return committed;
      });
    },
    remove(sessionId) {
      remove.run(sessionId);
    },
    close() {
      db.close();
    },
  };
}

export function createSessionStateReplacer(db: ReturnType<typeof openSessionDatabase>) {
  const replaceStatement = db.prepare(`
    INSERT INTO session_states(session_id, applied_sequence, updated_at, payload_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      applied_sequence = excluded.applied_sequence,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  return (sessionId: string, state: CanonicalSessionState) => {
    replaceStatement.run(
      sessionId,
      state.sequence,
      new Date().toISOString(),
      JSON.stringify(state),
    );
    return state;
  };
}
