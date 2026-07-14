import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  PersistSessionDiffBodyInput,
  StoredSessionDiffBody,
} from "../diff-body-store";
import { openSessionDatabase, runTransaction, type DatabaseSync } from "./core";

export type SqliteSessionDiffBodyStoreOptions = {
  dbPath: string;
  rootPath: string;
};

export function createSqliteSessionDiffBodyStore(options: SqliteSessionDiffBodyStoreOptions) {
  const db = openSessionDatabase(options.dbPath);
  const rootPath = options.rootPath;
  mkdirSync(rootPath, { recursive: true });

  return {
    putText(input: PersistSessionDiffBodyInput) {
      const sha256 = createHash("sha256").update(input.text, "utf8").digest("hex");
      const existing = getDiffBody(db, input.sessionId, input.path);
      if (existing?.sha256 === sha256) {
        return existing;
      }
      const storageKey = buildStorageKey(sha256);
      const filePath = join(rootPath, storageKey);
      mkdirSync(dirname(filePath), { recursive: true });
      if (!existsSync(filePath)) {
        writeFileSync(filePath, input.text, "utf8");
      }
      const diffBody: StoredSessionDiffBody = {
        id: buildDiffBodyRecordId(input.sessionId, input.path),
        sessionId: input.sessionId,
        path: input.path,
        mimeType: "text/plain; charset=utf-8",
        sha256,
        byteSize: Buffer.byteLength(input.text, "utf8"),
        storageKey,
        uri: `/api/sessions/${encodeURIComponent(input.sessionId)}/diffs/${encodeURIComponent(input.path)}`,
        createdAt: new Date().toISOString(),
      };
      upsertDiffBody(db, diffBody);
      removeUnreferencedFile(db, rootPath, existing?.storageKey);
      return diffBody;
    },
    get(sessionId: string, path: string) {
      return getDiffBody(db, sessionId, path);
    },
    readText(sessionId: string, path: string) {
      const diffBody = getDiffBody(db, sessionId, path);
      return diffBody ? readFileSync(join(rootPath, diffBody.storageKey), "utf8") : undefined;
    },
    removeSession(sessionId: string) {
      removeSessionDiffBodies(db, rootPath, sessionId);
    },
    close() {
      db.close();
    },
  };
}

function buildStorageKey(sha256: string) {
  return join(sha256.slice(0, 2), `${sha256}.diff`);
}

function buildDiffBodyRecordId(sessionId: string, path: string) {
  return createHash("sha256").update(`${sessionId}\u0000${path}`, "utf8").digest("hex");
}

function upsertDiffBody(db: DatabaseSync, body: StoredSessionDiffBody) {
  db.prepare(`
    INSERT INTO session_diff_bodies(
      id, session_id, path, mime_type, sha256, byte_size, storage_key, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, path) DO UPDATE SET
      id = excluded.id,
      mime_type = excluded.mime_type,
      sha256 = excluded.sha256,
      byte_size = excluded.byte_size,
      storage_key = excluded.storage_key,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `).run(
    body.id,
    body.sessionId,
    body.path,
    body.mimeType,
    body.sha256,
    body.byteSize,
    body.storageKey,
    body.createdAt,
    JSON.stringify(body),
  );
}

function getDiffBody(db: DatabaseSync, sessionId: string, path: string) {
  const row = db.prepare(
    "SELECT payload_json FROM session_diff_bodies WHERE session_id = ? AND path = ?",
  ).get(sessionId, path) as { payload_json: string } | undefined;
  return row ? parseDiffBody(row.payload_json) : undefined;
}

function removeSessionDiffBodies(db: DatabaseSync, rootPath: string, sessionId: string) {
  const rows = db.prepare(
    "SELECT DISTINCT storage_key FROM session_diff_bodies WHERE session_id = ?",
  ).all(sessionId) as Array<{ storage_key: string }>;
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_diff_bodies WHERE session_id = ?").run(sessionId);
  });
  for (const row of rows) {
    removeUnreferencedFile(db, rootPath, row.storage_key);
  }
}

function removeUnreferencedFile(db: DatabaseSync, rootPath: string, storageKey: string | undefined) {
  if (!storageKey) {
    return;
  }
  const remaining = db.prepare(
    "SELECT 1 FROM session_diff_bodies WHERE storage_key = ? LIMIT 1",
  ).get(storageKey);
  if (remaining) {
    return;
  }
  const filePath = join(rootPath, storageKey);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

function parseDiffBody(value: string) {
  try {
    return JSON.parse(value) as StoredSessionDiffBody;
  } catch {
    return undefined;
  }
}
