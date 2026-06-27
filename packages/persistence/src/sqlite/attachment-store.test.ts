import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteSessionAttachmentStore } from "./attachment-store";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = PNG_BYTES.toString("base64");

test("sqlite attachment store persists image bytes and metadata", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-attachment-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const rootPath = join(tempDir, "attachments");
  const store = createSqliteSessionAttachmentStore({ dbPath, rootPath });

  try {
    const stored = store.put({
      sessionId: "session-1",
      messageId: "message-1",
      mimeType: "image/png",
      name: "screenshot.png",
      dataBase64: PNG_BASE64,
    });

    assert.equal(stored.sessionId, "session-1");
    assert.equal(stored.messageId, "message-1");
    assert.equal(stored.mimeType, "image/png");
    assert.equal(stored.name, "screenshot.png");
    assert.equal(stored.byteSize, PNG_BYTES.byteLength);
    assert.equal(stored.uri, `/api/sessions/session-1/attachments/${stored.id}`);
    assert.ok(stored.sha256);
    assert.equal(stored.storageKey, join(stored.sha256.slice(0, 2), stored.sha256));
    assert.ok(existsSync(join(rootPath, stored.storageKey)));
    assert.deepEqual(readFileSync(join(rootPath, stored.storageKey)), PNG_BYTES);

    assert.deepEqual(store.get(stored.id), stored);
    assert.deepEqual(store.listForMessage("session-1", "message-1"), [stored]);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite attachment store reuses the existing record for the same message image content", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-attachment-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const rootPath = join(tempDir, "attachments");
  const store = createSqliteSessionAttachmentStore({ dbPath, rootPath });

  try {
    const first = store.put({
      sessionId: "session-1",
      messageId: "message-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    const second = store.put({
      sessionId: "session-1",
      messageId: "message-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });

    assert.deepEqual(second, first);
    assert.deepEqual(store.listForMessage("session-1", "message-1"), [first]);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite attachment store removes metadata and files for a session", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-attachment-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const rootPath = join(tempDir, "attachments");
  const store = createSqliteSessionAttachmentStore({ dbPath, rootPath });

  try {
    const first = store.put({
      sessionId: "session-1",
      messageId: "message-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    const second = store.put({
      sessionId: "session-2",
      messageId: "message-2",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });

    assert.equal(first.storageKey, second.storageKey);
    store.removeSession("session-1");

    assert.equal(store.get(first.id), undefined);
    assert.deepEqual(store.listForMessage("session-1", "message-1"), []);
    assert.equal(existsSync(join(rootPath, first.storageKey)), true);
    assert.deepEqual(store.get(second.id), second);
    assert.equal(existsSync(join(rootPath, second.storageKey)), true);

    store.removeSession("session-2");
    assert.equal(store.get(second.id), undefined);
    assert.equal(existsSync(join(rootPath, second.storageKey)), false);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
