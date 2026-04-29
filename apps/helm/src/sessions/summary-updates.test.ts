import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "./summary-updates";

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    workspaceId: "workspace-1",
    workspaceName: "Tiller",
    agentId: "agent-1",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    messageCount: 2,
    ...overrides,
  };
}

test("applyUserPromptToSummary increments send count once per user prompt", () => {
  const next = applyUserPromptToSummary(createSummary(), "请检查总览统计。", "2026-04-28T01:00:00.000Z");

  assert.equal(next.messageCount, 3);
  assert.equal(next.updatedAt, "2026-04-28T01:00:00.000Z");
  assert.equal(next.lastMessagePreview, "请检查总览统计。");
});

test("applyAgentMessageToSummary does not increment count for streamed agent chunks", () => {
  const message: AgentMessage = {
    id: "agent-chunk-1",
    role: "assistant",
    text: "正在分析...",
    timestamp: "2026-04-28T01:00:01.000Z",
  };

  const next = applyAgentMessageToSummary(createSummary(), message);

  assert.equal(next.messageCount, 2);
  assert.equal(next.updatedAt, message.timestamp);
  assert.equal(next.lastMessagePreview, "正在分析...");
});


test("Helm summary count remains send-based across streamed agent chunks", () => {
  let summary = createSummary({ messageCount: 0 });
  summary = applyUserPromptToSummary(summary, "第一轮任务", "2026-04-28T01:00:00.000Z");

  for (const [index, text] of ["正在", "分析", "完成"].entries()) {
    summary = applyAgentMessageToSummary(summary, {
      id: `agent-chunk-${index}`,
      role: "assistant",
      text,
      timestamp: `2026-04-28T01:00:0${index + 1}.000Z`,
    });
  }

  summary = applyUserPromptToSummary(summary, "第二轮任务", "2026-04-28T01:01:00.000Z");

  assert.equal(summary.messageCount, 2);
  assert.equal(summary.lastMessagePreview, "第二轮任务");
});
