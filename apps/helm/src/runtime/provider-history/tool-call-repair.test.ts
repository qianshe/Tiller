import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall, SessionSummary } from "@tiller/shared";
import { repairSessionToolCalls } from "./tool-call-repair.js";

function summary(sessionId: string): SessionSummary {
  return {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "main",
    agentId: "claudecode",
    agentName: "ClaudeCode",
    status: "running",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    messageCount: 0,
  };
}

test("repairSessionToolCalls keeps explicit Claude shell tools stable when titles contain rg commands", () => {
  const sessionId = "session-claude-shell-rg";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-1",
      kind: "shell",
      title: "rg \"tool_call\" apps/helm/src",
      status: "completed",
      input: JSON.stringify({ command: "rg \"tool_call\" apps/helm/src" }),
      timestamp: "2026-07-07T00:34:40.000Z",
      updatedAt: "2026-07-07T00:34:40.000Z",
    },
  ];

  const repaired = repairSessionToolCalls(
    {
      sessionId,
      providerId: "claudecode",
      summary: summary(sessionId),
    },
    toolCalls,
  );

  assert.equal(repaired.changedCount, 0);
  assert.equal(repaired.toolCalls[0]?.kind, "shell");
  assert.equal(repaired.toolCalls[0]?.title, "rg \"tool_call\" apps/helm/src");
});
