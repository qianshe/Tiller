import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";

test("session store persists summaries, de-duplicates by id, and returns newest first", async () => {
  let mod: null | {
    createSessionStore: (filePath: string) => {
      list: () => SessionSummary[];
      upsert: (summary: SessionSummary) => SessionSummary[];
    };
  } = null;

  try {
    mod = await import("./session-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionStore, "createSessionStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-session-store-"));

  try {
    const filePath = join(tempRoot, "sessions.json");
    const store = mod.createSessionStore(filePath);
    const first: SessionSummary = {
      id: "session-1",
      workspaceId: "workspace-a",
      workspaceName: "Workspace A",
      agentId: "agent-opencode",
      agentName: "OpenCode",
      status: "running",
      createdAt: "2026-04-26T10:00:00.000Z",
      updatedAt: "2026-04-26T10:02:00.000Z",
      messageCount: 1,
      lastMessagePreview: "first response",
      resume: {
        mode: "same-process",
        state: "resume-unavailable",
        reason: "Waiting for daemon runtime attach.",
        checkedAt: "2026-04-26T10:02:00.000Z",
        providerId: "agent-opencode",
      },
    };
    const second: SessionSummary = {
      id: "session-2",
      workspaceId: "workspace-b",
      workspaceName: "Workspace B",
      agentId: "agent-codex",
      agentName: "Codex",
      status: "idle",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T11:00:00.000Z",
      messageCount: 2,
      lastMessagePreview: "latest response",
      resume: {
        mode: "none",
        state: "history-only",
        reason: "Provider does not support runtime resume.",
        checkedAt: "2026-04-26T11:00:00.000Z",
        providerId: "agent-codex",
      },
    };

    store.upsert(first);
    store.upsert(second);
    store.upsert({
      ...first,
      status: "waiting_for_permission",
      updatedAt: "2026-04-26T12:00:00.000Z",
      messageCount: 3,
      lastMessagePreview: "permission needed",
      resume: {
        mode: "same-process",
        state: "resume-available",
        reason: "Attached to current daemon process.",
        checkedAt: "2026-04-26T12:00:00.000Z",
        providerId: "agent-opencode",
      },
    });

    const reloadedStore = mod.createSessionStore(filePath);
    const summaries = reloadedStore.list();

    assert.equal(summaries.length, 2);
    assert.equal(summaries[0]?.id, "session-1");
    assert.equal(summaries[0]?.status, "waiting_for_permission");
    assert.equal(summaries[0]?.messageCount, 3);
    assert.equal(summaries[0]?.lastMessagePreview, "permission needed");
    assert.equal(summaries[0]?.resume?.state, "resume-available");
    assert.equal(summaries[1]?.id, "session-2");
    assert.equal(summaries[1]?.resume?.state, "history-only");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
