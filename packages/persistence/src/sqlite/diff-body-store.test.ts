import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteSessionDiffBodyStore } from "./diff-body-store";

test("sqlite diff body store persists and releases immutable patch bodies", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-diff-body-store-"));
  const store = createSqliteSessionDiffBodyStore({
    dbPath: join(tempDir, "sessions.sqlite"),
    rootPath: join(tempDir, "diffs"),
  });

  try {
    const stored = store.putText({
      sessionId: "session-1",
      path: "src/file.ts",
      text: "diff --git a/src/file.ts b/src/file.ts\n+line\n",
    });
    assert.equal(store.readText("session-1", "src/file.ts"), "diff --git a/src/file.ts b/src/file.ts\n+line\n");
    assert.equal(existsSync(join(tempDir, "diffs", stored.storageKey)), true);

    store.removeSession("session-1");
    assert.equal(store.get("session-1", "src/file.ts"), undefined);
    assert.equal(existsSync(join(tempDir, "diffs", stored.storageKey)), false);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
