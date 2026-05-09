import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogPanel } from "./activity-log-panel.js";

test("activity log panel shows real user prompts and tool activity but hides assistant messages", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "terminal",
          title: "bash",
          status: "completed",
          input: "git branch --show-current",
          output: "main",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:03.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [
        {
          id: "user-1",
          role: "user",
          text: "查看当前分支",
          timestamp: "2026-05-08T01:00:01.000Z",
        },
        {
          id: "wrapper-echo",
          role: "user",
          text: "[analyze-mode]\nSYNTHESIZE findings before proceeding.\n---\n查看当前分支",
          timestamp: "2026-05-08T01:00:01.500Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "当前分支是 main。",
          timestamp: "2026-05-08T01:00:04.000Z",
        },
      ],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.doesNotMatch(html, /Assistant/);
  assert.doesNotMatch(html, /当前分支是 main。/);
  assert.doesNotMatch(html, /SYNTHESIZE findings/);
  assert.match(html, /Prompt/);
  assert.match(html, /查看当前分支/);
  assert.match(html, /Shell/);
  assert.match(html, /完成/);
  assert.match(html, /git branch --show-current/);
});

test("activity log panel labels namespaced tools as MCP", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Tool: sanshu/zhi",
          status: "completed",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:02.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /MCP/);
  assert.match(html, /Tool: sanshu\/zhi/);
});

test("activity log panel labels command-shaped generic tools as shell", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Write-Output \"hello\"",
          status: "completed",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:02.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  assert.match(html, /Shell/);
  assert.match(html, /Write-Output/);
});

test("activity log panel does not render provider diagnostics as assistant activity", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogPanel, {
      sessionId: "session-1",
      sessionToolCalls: [
        {
          id: "tool-1",
          kind: "tool",
          title: "Tool: read_file",
          status: "completed",
          timestamp: "2026-05-08T01:00:02.000Z",
          updatedAt: "2026-05-08T01:00:02.000Z",
        },
      ],
      commandChunks: [],
      sessionMessages: [
        {
          id: "session-1-msg-s0",
          role: "assistant",
          text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata;",
          timestamp: "2026-05-08T01:00:01.000Z",
        },
        {
          id: "session-1-msg-s1",
          role: "assistant",
          text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata; this can degrade performance.",
          timestamp: "2026-05-08T01:00:03.000Z",
        },
      ],
      visibleCount: 10,
      visibleLimit: 10,
      copy: { commandOutput: "航行日志", noCommandOutput: "暂无活动" },
      onShowMore: () => {},
      onLoadOlder: () => {},
    }),
  );

  const assistantCards = html.match(/Assistant/g) ?? [];
  assert.equal(assistantCards.length, 0);
  assert.doesNotMatch(html, /this can degrade performance/);
  assert.match(html, /Tool/);
  assert.match(html, /Tool: read_file/);
});
