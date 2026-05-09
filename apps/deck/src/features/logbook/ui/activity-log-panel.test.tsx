import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogPanel } from "./activity-log-panel.js";

test("activity log panel hides user and assistant messages while keeping tool activity", () => {
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
  assert.doesNotMatch(html, /Prompt/);
  assert.doesNotMatch(html, /查看当前分支/);
  assert.match(html, /Shell/);
  assert.match(html, /git branch --show-current/);
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
