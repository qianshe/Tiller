import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import { buildMissionPromptText } from "@tiller/shared";
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "./updates";

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    cwd: "worktree-1",
    worktreeName: "Tiller",
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
  const next = applyUserPromptToSummary(
    createSummary(),
    "请检查总览统计。",
    "2026-04-28T01:00:00.000Z",
  );

  assert.equal(next.messageCount, 3);
  assert.equal(next.updatedAt, "2026-04-28T01:00:00.000Z");
  assert.equal(next.lastMessagePreview, "请检查总览统计。");
});

test("applyAgentMessageToSummary keeps the user prompt preview stable across streamed agent chunks", () => {
  const message: AgentMessage = {
    id: "agent-chunk-1",
    role: "assistant",
    text: "正在分析...",
    timestamp: "2026-04-28T01:00:01.000Z",
  };

  const next = applyAgentMessageToSummary(
    createSummary({ lastMessagePreview: "请检查总览统计。" }),
    message,
  );

  assert.equal(next.messageCount, 2);
  assert.equal(next.updatedAt, message.timestamp);
  assert.equal(next.lastMessagePreview, "请检查总览统计。");
});

test("Tiller summary count remains send-based across streamed agent chunks", () => {
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

test("applyUserPromptToSummary strips mission prompt markers before preview/title", () => {
  const summary = createSummary({ title: undefined });
  const compiled = buildMissionPromptText("帮我展开", [{
    id: "ctx-1",
    kind: "quote",
    label: "assistant 引用",
    comment: "继续追问",
    excerpt: "use MCP first",
    source: { kind: "quote", messageId: "a1", role: "assistant" },
  }]);

  const next = applyUserPromptToSummary(summary, compiled, "2026-07-06T10:00:00.000Z");
  assert.equal(next.lastMessagePreview, "帮我展开");
  assert.equal(next.title, "帮我展开");
});

test("applyUserPromptToSummary falls back to first context label for context-only sends", () => {
  const summary = createSummary({ title: undefined });
  const compiled = buildMissionPromptText("", [{
    id: "ctx-1",
    kind: "diff",
    label: "panel.tsx:44-46",
    comment: "问问这里",
    excerpt: "+ new",
    source: { kind: "diff", filePath: "panel.tsx", startLine: 44, endLine: 46 },
  }]);

  const next = applyUserPromptToSummary(summary, compiled, "2026-07-06T10:00:00.000Z");
  assert.equal(next.lastMessagePreview, "panel.tsx:44-46");
  assert.equal(next.title, "panel.tsx:44-46");
});
