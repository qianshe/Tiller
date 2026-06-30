import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentPlan } from "@tiller/shared";
import { createSqliteSessionPlanStore } from "./store";

test("sqlite session plan store persists and removes plans by session", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-session-plan-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionPlanStore(dbPath);
  const plan: AgentPlan = {
    updatedAt: "2026-06-30T10:00:00.000Z",
    entries: [
      { content: "迁移到 canonical timeline", priority: "high", status: "completed" },
    ],
  };

  try {
    assert.equal(store.get("session-1"), undefined);
    assert.deepEqual(store.replace("session-1", plan), plan);
    assert.deepEqual(store.get("session-1"), plan);

    store.remove("session-1");
    assert.equal(store.get("session-1"), undefined);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
