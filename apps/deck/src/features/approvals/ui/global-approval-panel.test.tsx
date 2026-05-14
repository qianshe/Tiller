import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlobalApprovalPanel } from "./global-approval-panel.js";

function buildItem(
  id: string,
  command: string,
  reason: string,
  sessionId = "s1",
  resolving = false,
) {
  return {
    sessionId,
    request: { id, command, reason, cwd: "D:/repo" } as any,
    createdAt: "2026-05-14T00:00:00.000Z",
    resolving,
  };
}

test("global approval panel lists pending approvals across sessions", () => {
  const html = renderToStaticMarkup(
    createElement(GlobalApprovalPanel, {
      approvals: [
        buildItem("approval-1", "Run A", "审核 A", "s1"),
        buildItem("approval-2", "Run B", "审核 B", "s2"),
      ],
      onOpenSession: () => undefined,
      onRespond: () => undefined,
    } as any),
  );

  assert.match(html, /Run A/);
  assert.match(html, /Run B/);
  assert.match(html, /Session · s1/);
  assert.match(html, /Session · s2/);
});

test("global approval panel renders nothing when inventory is empty", () => {
  const html = renderToStaticMarkup(
    createElement(GlobalApprovalPanel, {
      approvals: [],
      onOpenSession: () => undefined,
      onRespond: () => undefined,
    } as any),
  );
  assert.equal(html, "");
});

test("global approval panel shows resolving state for in-flight approvals", () => {
  const html = renderToStaticMarkup(
    createElement(GlobalApprovalPanel, {
      approvals: [buildItem("approval-1", "Run X", "审核 X", "s1", true)],
      onOpenSession: () => undefined,
      onRespond: () => undefined,
    } as any),
  );

  assert.match(html, /disabled/);
  assert.match(html, /处理中/);
});
