import assert from "node:assert/strict";
import test from "node:test";
import type { AgentPlan, SessionSummary, SessionUpdateRecord } from "@tiller/shared";
import { appendTranscriptRepairPlanUpdate } from "./plan-repair";

test("appendTranscriptRepairPlanUpdate stores a replayable plan update record", () => {
  const appended: SessionUpdateRecord[] = [];
  const plan: AgentPlan = {
    updatedAt: "2026-06-05T14:10:05.000Z",
    entries: [
      { content: "恢复 Claude plan", priority: "medium", status: "in_progress" },
    ],
  };

  appendTranscriptRepairPlanUpdate({
    sessionId: "session-1",
    summary: sessionSummary(),
    agent: {
      id: "claudecode",
      name: "ClaudeCode",
      kind: "custom",
      command: "claude-agent-acp",
      transport: "stdio",
      protocol: "acp",
    },
    plan,
    sessionUpdateStore: {
      listPage: () => ({
        updates: [
          {
            sessionId: "session-1",
            runtimeSessionId: "runtime-1",
            providerId: "claudecode",
            sequence: 7,
            source: "acp_load_replay",
            updateType: "message",
            receivedAt: "2026-06-05T14:10:04.000Z",
            payloadJson: "{}",
          },
        ],
      }),
      append: (record) => {
        appended.push(record);
      },
    },
  });

  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.sequence, 8);
  assert.equal(appended[0]?.source, "agent_transcript_repair");
  assert.equal(appended[0]?.updateType, "plan-update");
  assert.deepEqual(JSON.parse(appended[0]?.payloadJson ?? "{}"), {
    type: "plan-update",
    plan,
  });
});

function sessionSummary(): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "claudecode",
    agentName: "ClaudeCode",
    cwd: "D:/repo",
    status: "idle",
    createdAt: "2026-06-05T14:08:11.859Z",
    updatedAt: "2026-06-05T14:10:05.000Z",
    messageCount: 2,
    runtimeSessionId: "runtime-1",
  };
}
