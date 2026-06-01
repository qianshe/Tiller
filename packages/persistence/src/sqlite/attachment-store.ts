import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  PersistSessionAttachmentInput,
  StoredSessionAttachment,
} from "../attachment-store";
import {
  openSessionDatabase,
  runTransaction,
  type DatabaseSync,
} from "./core";

export type SqliteSessionAttachmentStoreOptions = {
  dbPath: string;
  rootPath: string;
};

export function createSqliteSessionAttachmentStore(options: SqliteSessionAttachmentStoreOptions) {
  const db = openSessionDatabase(options.dbPath);
  const rootPath = options.rootPath;
  mkdirSync(rootPath, { recursive: true });

  return {
    put(input: PersistSessionAttachmentInput) {
      const bytes = Buffer.from(input.dataBase64, "base64");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = input.messageId
        ? getAttachmentByMessageSha(db, input.sessionId, input.messageId, sha256)
        : undefined;
      if (existing) {
        return existing;
      }
      const id = randomUUID();
      const storageKey = buildStorageKey(sha256);
      const filePath = join(rootPath, storageKey);
      mkdirSync(dirname(filePath), { recursive: true });
      if (!existsSync(filePath)) {
        writeFileSync(filePath, bytes);
      }

      const attachment: StoredSessionAttachment = {
        id,
        sessionId: input.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
        mimeType: input.mimeType,
        ...(input.name ? { name: input.name } : {}),
        sha256,
        byteSize: bytes.byteLength,
        storageKey,
        uri: `/api/sessions/${encodeURIComponent(input.sessionId)}/attachments/${encodeURIComponent(id)}`,
        createdAt: new Date().toISOString(),
      };
      upsertAttachment(db, attachment);
      return attachment;
    },
    get(id: string) {
      return getAttachment(db, id);
    },
    listForMessage(sessionId: string, messageId: string) {
      return listAttachmentsForMessage(db, sessionId, messageId);
    },
    removeSession(sessionId: string) {
      removeSessionAttachments(db, rootPath, sessionId);
    },
    readBytes(id: string) {
      const attachment = getAttachment(db, id);
      return attachment ? readFileSync(join(rootPath, attachment.storageKey)) : undefined;
    },
    close() {
      db.close();
    },
  };
}

function buildStorageKey(sha256: string) {
  return join(sha256.slice(0, 2), sha256);
}

function upsertAttachment(db: DatabaseSync, attachment: StoredSessionAttachment) {
  db.prepare(
    `
    INSERT OR REPLACE INTO session_attachments(
      id,
      session_id,
      message_id,
      mime_type,
      name,
      sha256,
      byte_size,
      storage_key,
      created_at,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    attachment.id,
    attachment.sessionId,
    attachment.messageId ?? null,
    attachment.mimeType,
    attachment.name ?? null,
    attachment.sha256,
    attachment.byteSize,
    attachment.storageKey,
    attachment.createdAt,
    JSON.stringify(attachment),
  );
}

function getAttachment(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT payload_json FROM session_attachments WHERE id = ?").get(id) as
    | { payload_json: string }
    | undefined;
  return row ? parseAttachment(row.payload_json) : undefined;
}

function listAttachmentsForMessage(db: DatabaseSync, sessionId: string, messageId: string) {
  const rows = db
    .prepare(
      `
      SELECT payload_json
      FROM session_attachments
      WHERE session_id = ? AND message_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    )
    .all(sessionId, messageId) as Array<{ payload_json: string }>;
  return rows.map((row) => parseAttachment(row.payload_json)).filter(isNotUndefined);
}

function getAttachmentByMessageSha(
  db: DatabaseSync,
  sessionId: string,
  messageId: string,
  sha256: string,
) {
  const row = db
    .prepare(
      `
      SELECT payload_json
      FROM session_attachments
      WHERE session_id = ? AND message_id = ? AND sha256 = ?
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `,
    )
    .get(sessionId, messageId, sha256) as { payload_json: string } | undefined;
  return row ? parseAttachment(row.payload_json) : undefined;
}

function removeSessionAttachments(db: DatabaseSync, rootPath: string, sessionId: string) {
  const rows = db
    .prepare("SELECT DISTINCT storage_key FROM session_attachments WHERE session_id = ?")
    .all(sessionId) as Array<{ storage_key: string }>;
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_attachments WHERE session_id = ?").run(sessionId);
  });
  for (const row of rows) {
    const remaining = db
      .prepare("SELECT 1 FROM session_attachments WHERE storage_key = ? LIMIT 1")
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

function parseAttachment(value: string) {
  try {
    return JSON.parse(value) as StoredSessionAttachment;
  } catch {
    return undefined;
  }
}

function isNotUndefined<T>(value: T | undefined): value is T {
  return typeof value !== "undefined";
}
