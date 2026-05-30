import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { shouldAttachDraftWindowToSession } from "./draft-window";

test("shouldAttachDraftWindowToSession matches project cwd and optional agent", () => {
  const session = {
    id: "session-1",
    projectId: "project-1",
    cwd: "D:/repo/worktree",
    agentId: "agent-1",
  } as SessionSummary;

  assert.equal(
    shouldAttachDraftWindowToSession(
      { projectId: "project-1", cwd: "D:\\repo\\worktree", agentId: "agent-1" },
      session,
    ),
    true,
  );
  assert.equal(
    shouldAttachDraftWindowToSession(
      { projectId: "project-1", cwd: "D:/repo/worktree", agentId: null },
      session,
    ),
    true,
  );
});

test("shouldAttachDraftWindowToSession rejects mismatched project cwd or agent", () => {
  const session = {
    id: "session-1",
    projectId: "project-1",
    cwd: "D:/repo/worktree",
    agentId: "agent-1",
  } as SessionSummary;

  assert.equal(
    shouldAttachDraftWindowToSession(
      { projectId: "project-2", cwd: "D:/repo/worktree", agentId: "agent-1" },
      session,
    ),
    false,
  );
  assert.equal(
    shouldAttachDraftWindowToSession(
      { projectId: "project-1", cwd: "D:/repo/other", agentId: "agent-1" },
      session,
    ),
    false,
  );
  assert.equal(
    shouldAttachDraftWindowToSession(
      { projectId: "project-1", cwd: "D:/repo/worktree", agentId: "agent-2" },
      session,
    ),
    false,
  );
});
