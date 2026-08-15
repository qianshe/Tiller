import type { ConversationPreparation } from "@tiller/shared";
import {
  validateConversationPreparationContent,
  type ConversationPreparationStore,
} from "../conversation-preparation-store";
import { openSessionDatabase, type DatabaseSync } from "./core";

export function createSqliteConversationPreparationStore(dbPath: string): ConversationPreparationStore & { close: () => void } {
  const db = openSessionDatabase(dbPath);
  return {
    get(id) {
      return getPreparation(db, id);
    },
    list() {
      return db
        .prepare("SELECT payload_json FROM conversation_preparations ORDER BY updated_at DESC, id ASC")
        .all()
        .map((row) => parsePreparation((row as { payload_json: string }).payload_json))
        .filter((item): item is ConversationPreparation => Boolean(item));
    },
    upsert(preparation) {
      const storedPreparation = {
        ...preparation,
        content: validateConversationPreparationContent(preparation.content),
      };
      db.prepare(
        `INSERT INTO conversation_preparations(
          id, project_id, cwd, agent_id, revision, created_at, updated_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          cwd = excluded.cwd,
          agent_id = excluded.agent_id,
          revision = excluded.revision,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json`,
      ).run(
        storedPreparation.id,
        storedPreparation.projectId ?? null,
        storedPreparation.cwd ?? null,
        storedPreparation.agentId ?? null,
        storedPreparation.revision,
        storedPreparation.createdAt,
        storedPreparation.updatedAt,
        JSON.stringify(storedPreparation),
      );
    },
    remove(id) {
      db.prepare("DELETE FROM conversation_preparations WHERE id = ?").run(id);
    },
    close() {
      db.close();
    },
  };
}

function getPreparation(db: DatabaseSync, id: string): ConversationPreparation | undefined {
  const row = db
    .prepare("SELECT payload_json FROM conversation_preparations WHERE id = ?")
    .get(id) as { payload_json?: string } | undefined;
  return row?.payload_json ? parsePreparation(row.payload_json) ?? undefined : undefined;
}

function parsePreparation(payload: string): ConversationPreparation | null {
  try {
    const value = JSON.parse(payload) as ConversationPreparation;
    return typeof value.id === "string" && typeof value.content === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
