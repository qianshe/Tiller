import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";

test("session store persists summaries, de-duplicates by id, and returns newest first", async () => {
  let mod: null | {
    createSessionStore: (filePath: string) => {
      list: () => SessionSummary[];
      upsert: (summary: SessionSummary) => SessionSummary[];
      remove: (sessionId: string) => SessionSummary[];
    };
  } = null;

  try {
    mod = await import("./store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionStore, "createSessionStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-summary-store-"));

  try {
    const filePath = join(tempRoot, "sessions.json");
    const store = mod.createSessionStore(filePath);
    const first: SessionSummary = {
      id: "session-1",
      projectId: "project-alpha",
      projectName: "Project Alpha",
      helmId: "helm-local",
      workspaceId: "workspace-a",
      workspaceName: "Workspace A",
      agentId: "agent-opencode",
      agentName: "OpenCode",
      status: "running",
      createdAt: "2026-04-26T10:00:00.000Z",
      updatedAt: "2026-04-26T10:02:00.000Z",
      messageCount: 1,
      runtimeSessionId: "acp-session-1",
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
      projectId: "project-beta",
      projectName: "Project Beta",
      helmId: "helm-local",
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
      runtimeSessionId: "acp-session-1",
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
    assert.equal(summaries[0]?.runtimeSessionId, "acp-session-1");
    assert.equal(summaries[0]?.resume?.state, "resume-available");
    assert.equal(summaries[1]?.id, "session-2");
    assert.equal(summaries[1]?.resume?.state, "history-only");
    assert.equal(summaries[0]?.projectId, "project-alpha");
    assert.equal(summaries[0]?.projectName, "Project Alpha");
    assert.equal(summaries[0]?.helmId, "helm-local");
    assert.equal(summaries[1]?.projectId, "project-beta");
    assert.equal(summaries[1]?.helmId, "helm-local");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session store normalizes legacy summaries without project or helm fields", async () => {
  const mod = await import("./store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-summary-store-legacy-"));

  try {
    const filePath = join(tempRoot, "sessions.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        {
          id: "session-legacy",
          workspaceId: "workspace-legacy",
          workspaceName: "Legacy Workspace",
          agentId: "agent-legacy",
          agentName: "Legacy Agent",
          status: "idle",
          createdAt: "2026-04-26T09:00:00.000Z",
          updatedAt: "2026-04-26T09:10:00.000Z",
          messageCount: 1,
        },
      ]),
      "utf8",
    );

    const store = mod.createSessionStore(filePath);
    const summaries = store.list();

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.projectId, "legacy-project");
    assert.equal(summaries[0]?.projectName, "Legacy Workspace");
    assert.equal(summaries[0]?.helmId, "legacy-helm");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session store removes only the targeted session summary", async () => {
  const mod = await import("./store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-summary-store-delete-"));

  try {
    const filePath = join(tempRoot, "sessions.json");
    const store = mod.createSessionStore(filePath);
    store.upsert({
      id: "session-a",
      projectId: "project-a",
      projectName: "Project A",
      helmId: "helm-local",
      workspaceId: "workspace-a",
      workspaceName: "Workspace A",
      agentId: "agent-a",
      agentName: "Agent A",
      status: "idle",
      createdAt: "2026-04-27T08:15:00.000Z",
      updatedAt: "2026-04-27T08:15:00.000Z",
      messageCount: 0,
    });
    store.upsert({
      id: "session-b",
      projectId: "project-b",
      projectName: "Project B",
      helmId: "helm-local",
      workspaceId: "workspace-b",
      workspaceName: "Workspace B",
      agentId: "agent-b",
      agentName: "Agent B",
      status: "idle",
      createdAt: "2026-04-27T08:15:01.000Z",
      updatedAt: "2026-04-27T08:15:01.000Z",
      messageCount: 0,
    });

    store.remove("session-a");

    const reloadedStore = mod.createSessionStore(filePath);
    assert.equal(reloadedStore.list().length, 1);
    assert.equal(reloadedStore.list()[0]?.id, "session-b");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
