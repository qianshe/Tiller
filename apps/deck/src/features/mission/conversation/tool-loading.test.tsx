import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionToolLoading, MissionToolLoadingTitle } from "./tool-loading.js";

test("mission tool loading renders as a compact elevated status card", () => {
  const html = renderToStaticMarkup(
    createElement(MissionToolLoading, {
      activity: { title: "Tool: mcp_router/search_context" },
      pendingToolPresent: true,
    }),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /rounded-xl/);
  assert.match(html, /border-border-ghost/);
  assert.match(html, /bg-surface-elevated/);
  assert.match(html, /正在执行工具/);
  assert.match(html, /mcp_router\/search_context/);
});

test("mission loading renders stable ACP running copy without tool wording", () => {
  const html = renderToStaticMarkup(
    createElement(MissionToolLoading, {
      activity: { title: "ACP 正在运行" },
      pendingToolPresent: false,
    }),
  );

  assert.match(html, /ACP 正在运行/);
  assert.match(html, /等待下一次状态更新/);
  assert.doesNotMatch(html, /正在执行工具/);
  assert.doesNotMatch(html, /等待 ACP 运行中 返回结果/);
});

test("mission tool loading title reports the session as running without tool wording", () => {
  const html = renderToStaticMarkup(
    createElement(MissionToolLoadingTitle, {
      activity: { title: "Tool: mcp_router/search_context" },
      pendingToolPresent: true,
    }),
  );

  assert.match(html, /role=\"status\"/);
  assert.match(html, /运行中/);
  assert.doesNotMatch(html, /工具执行中/);
  assert.doesNotMatch(html, />等待 mcp_router\/search_context 返回结果/);
});
