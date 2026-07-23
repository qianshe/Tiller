import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  PersistSessionOutputBodyInput,
  StoredSessionOutputBody,
} from "../output-body-store";
import {
  openSessionDatabase,
  runTransaction,
  type DatabaseSync,
} from "./core";

export type SqliteSessionOutputBodyStoreOptions = {
  dbPath: string;
  rootPath: string;
};

export function createSqliteSessionOutputBodyStore(options: SqliteSessionOutputBodyStoreOptions) {
  const db = openSessionDatabase(options.dbPath);
  const rootPath = options.rootPath;
  mkdirSync(rootPath, { recursive: true });

  return {
    putText(input: PersistSessionOutputBodyInput) {
      const existing = getOutputBody(db, input.sessionId, input.outputId);
      if (existing) {
        return existing;
      }

      const sha256 = createHash("sha256").update(input.text, "utf8").digest("hex");
      const storageKey = buildStorageKey(sha256);
      const filePath = join(rootPath, storageKey);
      mkdirSync(dirname(filePath), { recursive: true });
      if (!existsSync(filePath)) {
        writeFileSync(filePath, input.text, "utf8");
      }

      const outputBody: StoredSessionOutputBody = {
        id: buildOutputBodyRecordId(input.sessionId, input.outputId),
        sessionId: input.sessionId,
        outputId: input.outputId,
        mimeType: "text/plain; charset=utf-8",
        sha256,
        byteSize: Buffer.byteLength(input.text, "utf8"),
        storageKey,
        uri: `/api/sessions/${encodeURIComponent(input.sessionId)}/outputs/${encodeURIComponent(input.outputId)}`,
        createdAt: new Date().toISOString(),
      };
      upsertOutputBody(db, outputBody);
      return outputBody;
    },
    get(sessionId: string, outputId: string) {
      return getOutputBody(db, sessionId, outputId);
    },
    readText(sessionId: string, outputId: string) {
      const outputBody = getOutputBody(db, sessionId, outputId);
      return outputBody ? readFileSync(join(rootPath, outputBody.storageKey), "utf8") : undefined;
    },
    removeSession(sessionId: string) {
      removeSessionOutputBodies(db, rootPath, sessionId);
    },
    close() {
      db.close();
    },
  };
}

function buildStorageKey(sha256: string) {
  return join(sha256.slice(0, 2), `${sha256}.txt`);
}

function buildOutputBodyRecordId(sessionId: string, outputId: string) {
  return `${sessionId}:${outputId}`;
}

function upsertOutputBody(db: DatabaseSync, outputBody: StoredSessionOutputBody) {
  db.prepare(
    `
    INSERT OR REPLACE INTO session_output_bodies(
      id,
      session_id,
      output_id,
      mime_type,
      sha256,
      byte_size,
      storage_key,
      created_at,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    outputBody.id,
    outputBody.sessionId,
    outputBody.outputId,
    outputBody.mimeType,
    outputBody.sha256,
    outputBody.byteSize,
    outputBody.storageKey,
    outputBody.createdAt,
    JSON.stringify(outputBody),
  );
}

function getOutputBody(db: DatabaseSync, sessionId: string, outputId: string) {
  const row = db
    .prepare("SELECT payload_json FROM session_output_bodies WHERE session_id = ? AND output_id = ?")
    .get(sessionId, outputId) as
    | { payload_json: string }
    | undefined;
  return row ? parseOutputBody(row.payload_json) : undefined;
}

function removeSessionOutputBodies(db: DatabaseSync, rootPath: string, sessionId: string) {
  const rows = db
    .prepare("SELECT DISTINCT storage_key FROM session_output_bodies WHERE session_id = ?")
    .all(sessionId) as Array<{ storage_key: string }>;
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_output_bodies WHERE session_id = ?").run(sessionId);
  });
  for (const row of rows) {
    const remaining = db
      .prepare("SELECT 1 FROM session_output_bodies WHERE storage_key = ? LIMIT 1")
      .get(row.storage_key);
    if (remaining) {
      continue;
    }
    const filePath = join(rootPath, row.storage_key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

function parseOutputBody(value: string) {
  try {
    return JSON.parse(value) as StoredSessionOutputBody;
  } catch {
    return undefined;
  }
}
