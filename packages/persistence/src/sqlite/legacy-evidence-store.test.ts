import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteSessionLegacyEvidenceStore } from "./legacy-evidence-store";
import { openSessionDatabase } from "./core";

test("legacy evidence pages raw message rows by storage position without timestamp sorting", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-legacy-evidence-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const db = openSessionDatabase(dbPath);
  const sessionId = "legacy-session";
  const insert = db.prepare(`
    INSERT INTO session_messages(session_id, id, position, role, timestamp, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    sessionId,
    "arrived-first",
    99,
    "assistant",
    "2026-07-11T12:00:00.000Z",
    JSON.stringify({
      id: "arrived-first",
      role: "assistant",
      text: "first row, later timestamp",
      timestamp: "2026-07-11T12:00:00.000Z",
    }),
  );
  insert.run(
    sessionId,
    "arrived-second",
    1,
    "assistant",
    "2026-07-11T01:00:00.000Z",
    JSON.stringify({
      id: "arrived-second",
      role: "assistant",
      text: "second row, earlier timestamp",
      timestamp: "2026-07-11T01:00:00.000Z",
    }),
  );
  insert.run(
    sessionId,
    "malformed-row",
    2,
    "assistant",
    "2026-07-11T02:00:00.000Z",
    "{bad json",
  );
  db.close();

  const store = createSqliteSessionLegacyEvidenceStore(dbPath);
  try {
    assert.deepEqual(store.describe(sessionId), {
      sessionId,
      available: true,
      counts: { message: 3, tool_call: 0, output: 0 },
    });

    const page = store.listPage(sessionId, { source: "message", limit: 3 });
    assert.deepEqual(
      page.items.map((item) => [item.sourcePosition, item.entity.id]),
      [[1, "arrived-first"], [2, "arrived-second"]],
    );
    assert.deepEqual(page.issues, [{
      source: "message",
      sourcePosition: 3,
      code: "invalid_payload",
    }]);
    assert.equal(page.nextCursor, undefined);
    assert.equal(page.hasMore, false);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("legacy evidence bounds an oversized raw payload without loading it into the page", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-legacy-evidence-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const db = openSessionDatabase(dbPath);
  const payload = JSON.stringify({ id: "oversized", body: "x".repeat(20 * 1024) });
  db.prepare(`
    INSERT INTO session_messages(session_id, id, position, role, timestamp, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-session",
    "oversized",
    1,
    "assistant",
    "2026-07-11T12:00:00.000Z",
    payload,
  );
  db.close();

  const store = createSqliteSessionLegacyEvidenceStore(dbPath);
  try {
    const page = store.listPage("legacy-session", { source: "message" });
    assert.deepEqual(page.items, []);
    assert.equal(page.issues[0]?.code, "payload_too_large");
    assert.equal(page.issues[0]?.payloadBytes, Buffer.byteLength(payload));
    assert.equal(page.issues[0]?.preview?.startsWith('{"id":"oversized"'), true);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
