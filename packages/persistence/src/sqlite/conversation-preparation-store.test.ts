import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationPreparation } from "@tiller/shared";
import { createSqliteConversationPreparationStore } from "./conversation-preparation-store";

test("conversation preparation store persists optional configuration across reopen", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-preparation-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const preparation: ConversationPreparation = {
    id: "preparation-1",
    content: "Investigate the sync issue",
    revision: 1,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
  const first = createSqliteConversationPreparationStore(dbPath);
  assert.throws(() => first.upsert({ ...preparation, id: "empty", content: "   " }), /must not be empty/);
  first.upsert(preparation);
  first.close();

  const reopened = createSqliteConversationPreparationStore(dbPath);
  try {
    assert.deepEqual(reopened.get(preparation.id), preparation);
    assert.deepEqual(reopened.list(), [preparation]);
    reopened.remove(preparation.id);
    assert.equal(reopened.get(preparation.id), undefined);
  } finally {
    reopened.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
