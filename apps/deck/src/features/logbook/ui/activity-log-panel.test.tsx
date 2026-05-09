import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogPanel } from "./activity-log-panel.js";

test("activity log panel renders assistant stream messages alongside tool activity", () => {
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

  assert.match(html, /Assistant/);
  assert.match(html, /当前分支是 main。/);
  assert.match(html, /Prompt/);
  assert.match(html, /查看当前分支/);
  assert.match(html, /Shell/);
  assert.match(html, /git branch --show-current/);
});
