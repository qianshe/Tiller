import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteSessionOutputBodyStore } from "./output-body-store";

test("sqlite output body store persists text bodies and metadata", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-output-body-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const rootPath = join(tempDir, "output-bodies");
  const store = createSqliteSessionOutputBodyStore({ dbPath, rootPath });

  try {
    const text = "stdout line 1\nstdout line 2\n";
    const stored = store.putText({
      sessionId: "session-1",
      outputId: "chunk-1",
      text,
    });

    assert.equal(stored.sessionId, "session-1");
    assert.equal(stored.outputId, "chunk-1");
    assert.equal(stored.byteSize, Buffer.byteLength(text, "utf8"));
    assert.equal(stored.mimeType, "text/plain; charset=utf-8");
    assert.equal(stored.uri, `/api/sessions/session-1/outputs/chunk-1`);
    assert.equal(stored.id, "session-1:chunk-1");
    assert.ok(stored.sha256);
    assert.equal(stored.storageKey, join(stored.sha256.slice(0, 2), `${stored.sha256}.txt`));
    assert.equal(existsSync(join(rootPath, stored.storageKey)), true);
    assert.equal(readFileSync(join(rootPath, stored.storageKey), "utf8"), text);

    assert.deepEqual(store.get("session-1", "chunk-1"), stored);
    assert.equal(store.readText("session-1", "chunk-1"), text);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite output body store removes session metadata and orphaned files", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-output-body-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const rootPath = join(tempDir, "output-bodies");
  const store = createSqliteSessionOutputBodyStore({ dbPath, rootPath });

  try {
    const first = store.putText({
      sessionId: "session-1",
      outputId: "chunk-1",
      text: "same body",
    });
    const second = store.putText({
      sessionId: "session-2",
      outputId: "chunk-2",
      text: "same body",
    });

    assert.equal(first.storageKey, second.storageKey);
    store.removeSession("session-1");

    assert.equal(store.get("session-1", "chunk-1"), undefined);
    assert.equal(store.readText("session-1", "chunk-1"), undefined);
    assert.equal(existsSync(join(rootPath, first.storageKey)), true);
    assert.deepEqual(store.get("session-2", "chunk-2"), second);

    store.removeSession("session-2");
    assert.equal(store.get("session-2", "chunk-2"), undefined);
    assert.equal(existsSync(join(rootPath, second.storageKey)), false);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
