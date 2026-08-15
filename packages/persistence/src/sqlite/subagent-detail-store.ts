import {
  sortSessionTimelineEntries,
  type SessionSubagentDetail,
  type SessionTimelineBatch,
  type SessionTimelineEntry,
} from "@tiller/shared";
import { normalizeLegacyPersistedAgentToolCall } from "../normalize.js";
import { openSessionDatabase, runTransaction } from "./core.js";

type StoredEntryRow = {
  first_sequence: number;
  payload_json: string;
};

export function createSqliteSessionSubagentDetailStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);

  return {
    get(sessionId: string, parentToolCallId: string): SessionSubagentDetail {
      const metadata = db.prepare(`
        SELECT through_sequence
        FROM session_subagent_details
        WHERE session_id = ? AND parent_tool_call_id = ?
      `).get(sessionId, parentToolCallId) as { through_sequence: number } | undefined;
      const rows = db.prepare(`
        SELECT first_sequence, payload_json
        FROM session_subagent_entries
        WHERE session_id = ? AND parent_tool_call_id = ?
        ORDER BY first_sequence ASC, entry_id ASC
      `).all(sessionId, parentToolCallId) as StoredEntryRow[];
      return {
        sessionId,
        parentToolCallId,
        throughSequence: metadata?.through_sequence ?? 0,
        entries: sortSessionTimelineEntries(rows
          .map(parseEntry)
          .filter((entry): entry is SessionTimelineEntry => Boolean(entry))),
      };
    },
    commitBatch(
      sessionId: string,
      parentToolCallId: string,
      batch: SessionTimelineBatch,
    ): void {
      runTransaction(db, () => {
        const existing = db.prepare(`
          SELECT revision, through_sequence
          FROM session_subagent_details
          WHERE session_id = ? AND parent_tool_call_id = ?
        `).get(sessionId, parentToolCallId) as { revision: number; through_sequence: number } | undefined;
        const nextThroughSequence = Math.max(existing?.through_sequence ?? 0, batch.lastSequence);
        db.prepare(`
          INSERT INTO session_subagent_details(
            session_id, parent_tool_call_id, revision, through_sequence, updated_at
          ) VALUES(?, ?, ?, ?, ?)
          ON CONFLICT(session_id, parent_tool_call_id) DO UPDATE SET
            revision = excluded.revision,
            through_sequence = excluded.through_sequence,
            updated_at = excluded.updated_at
        `).run(
          sessionId,
          parentToolCallId,
          (existing?.revision ?? 0) + 1,
          nextThroughSequence,
          new Date().toISOString(),
        );
        const upsert = db.prepare(`
          INSERT INTO session_subagent_entries(
            session_id, parent_tool_call_id, entry_kind, entry_id,
            first_sequence, updated_sequence, payload_json
          ) VALUES(?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, parent_tool_call_id, entry_kind, entry_id) DO UPDATE SET
            first_sequence = MIN(first_sequence, excluded.first_sequence),
            updated_sequence = MAX(updated_sequence, excluded.updated_sequence),
            payload_json = CASE
              WHEN excluded.updated_sequence >= updated_sequence THEN excluded.payload_json
              ELSE payload_json
            END
        `);
        for (const entry of batch.entries) {
          const firstSequence = timelineEntrySequence(entry) ?? batch.lastSequence;
          upsert.run(
            sessionId,
            parentToolCallId,
            entry.kind,
            entry.id,
            firstSequence,
            batch.lastSequence,
            JSON.stringify(entry),
          );
        }
      });
    },
    remove(sessionId: string) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_subagent_entries WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM session_subagent_details WHERE session_id = ?").run(sessionId);
      });
    },
    close() {
      db.close();
    },
  };
}

function parseEntry(row: StoredEntryRow): SessionTimelineEntry | undefined {
  try {
    const value = JSON.parse(row.payload_json) as unknown;
    if (isTimelineEntry(value)) {
      const entry = withFallbackSequence(value, row.first_sequence);
      if (entry.kind !== "tool_call") {
        return entry;
      }
      const toolCall = normalizeLegacyPersistedAgentToolCall(entry.toolCall) ?? entry.toolCall;
      return toolCall === entry.toolCall ? entry : { ...entry, toolCall };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isTimelineEntry(value: unknown): value is SessionTimelineEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as { id?: unknown; kind?: unknown };
  return typeof entry.id === "string" && (
    entry.kind === "user_message" ||
    entry.kind === "system_message" ||
    entry.kind === "assistant_message" ||
    entry.kind === "tool_call" ||
    entry.kind === "command_output" ||
    entry.kind === "context_compaction" ||
    entry.kind === "history_gap"
  );
}

function timelineEntrySequence(entry: SessionTimelineEntry) {
  return "sequence" in entry ? entry.sequence : undefined;
}

function withFallbackSequence(
  entry: SessionTimelineEntry,
  sequence: number,
): SessionTimelineEntry {
  if (!("sequence" in entry) || entry.sequence !== undefined) return entry;
  return { ...entry, sequence };
}
