import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionTimelineEntry } from "@tiller/shared";
import { createHelmSessionStores } from "./store-factory";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

function entry(index: number): SessionTimelineEntry {
  const timestamp = new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 1000).toISOString();
  return {
    id: `assistant-${index}`,
    kind: "assistant_message",
    chunks: [{ id: `assistant-${index}:content`, kind: "content", text: `message ${index}`, timestamp, sequence: index }],
    timestamp,
    updatedAt: timestamp,
    sequence: index,
  };
}

function createOptions(tempDir: string, logs: string[] = []) {
  return {
    sqlitePath: join(tempDir, "sessions.sqlite"),
    attachmentRootPath: join(tempDir, "session-attachments"),
    timelineBlockRootPath: join(tempDir, "timeline-blocks"),
    jsonPaths: {
      sessionHistoryPath: join(tempDir, "sessions.json"),
      sessionMessagesPath: join(tempDir, "session-messages"),
      sessionArtifactsPath: join(tempDir, "session-artifacts"),
      sessionRuntimesPath: join(tempDir, "session-runtimes.json"),
    },
    logDebug: (message: string) => logs.push(message),
    logError: (message: string) => logs.push(`error:${message}`),
  };
}

function closeStores(stores: ReturnType<typeof createHelmSessionStores>) {
  for (const store of Object.values(stores)) {
    (store as { close?: () => void }).close?.();
  }
}

test("createHelmSessionStores blocks_shadow writes blocks and reads sqlite rows with parity logs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-store-factory-"));
  const logs: string[] = [];
  const stores = createHelmSessionStores({
    ...createOptions(tempDir, logs),
    timelineBlockMode: "blocks_shadow",
  });

  try {
    stores.sessionTimelineStore.replace("session-1", [entry(0), entry(1), entry(2)]);
    const page = stores.sessionTimelineStore.listPage("session-1", { limit: 2 });

    assert.deepEqual(page.entries.map((item) => item.id), ["assistant-1", "assistant-2"]);
    assert.equal(existsSync(join(tempDir, "timeline-blocks", encodeURIComponent("session-1"))), true);
    assert.equal(logs.some((message) => message.includes("timeline.block.parity=ok")), true);
  } finally {
    closeStores(stores);
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("createHelmSessionStores blocks_read reads blocks while keeping sqlite rows", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-store-factory-"));
  const stores = createHelmSessionStores({
    ...createOptions(tempDir),
    timelineBlockMode: "blocks_read",
  });

  try {
    stores.sessionTimelineStore.replace("session-1", [entry(0), entry(1), entry(2)]);
    const page = stores.sessionTimelineStore.listPage("session-1", { limit: 2 });

    assert.deepEqual(page.entries.map((item) => item.id), ["assistant-1", "assistant-2"]);
    const db = new DatabaseSync(join(tempDir, "sessions.sqlite"));
    try {
      const row = db.prepare("SELECT COUNT(*) AS count FROM session_timeline_entries WHERE session_id = ?").get("session-1") as { count: number };
      assert.equal(row.count, 3);
    } finally {
      db.close();
    }
  } finally {
    closeStores(stores);
    rmSync(tempDir, { force: true, recursive: true });
  }
});
