import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionToolLoading } from "./tool-loading.js";

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
