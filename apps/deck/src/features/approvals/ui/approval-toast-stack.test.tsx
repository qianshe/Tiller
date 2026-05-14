import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useDeckStore } from "../../../store";
import { ApprovalToastStack } from "./approval-toast-stack.js";

function buildItem(id: string, command: string, reason: string) {
  return {
    sessionId: "s1",
    request: { id, command, reason, cwd: "D:/repo" } as any,
    createdAt: "2026-05-14T00:00:00.000Z",
    resolving: false,
  };
}

test("approval toast stack renders the head queue item", () => {
  const html = renderToStaticMarkup(
    createElement(ApprovalToastStack, {
      visible: buildItem("approval-toast", "Run toast command", "审核 toast"),
      remainingCount: 0,
      onAutoHide: () => undefined,
      onOpenQueue: () => undefined,
      onRespond: () => undefined,
    } as any),
  );

  assert.match(html, /Run toast command/);
});

test("approval toast stack renders nothing when nothing is visible", () => {
  const html = renderToStaticMarkup(
    createElement(ApprovalToastStack, {
      visible: null,
      remainingCount: 0,
      onAutoHide: () => undefined,
      onOpenQueue: () => undefined,
      onRespond: () => undefined,
    } as any),
  );
  assert.equal(html, "");
});

test("approval toast stack reports remaining count when extra items queued", () => {
  const html = renderToStaticMarkup(
    createElement(ApprovalToastStack, {
      visible: buildItem("approval-1", "Run 1", "r1"),
      remainingCount: 2,
      onAutoHide: () => undefined,
      onOpenQueue: () => undefined,
      onRespond: () => undefined,
    } as any),
  );

  assert.match(html, /Run 1/);
  assert.match(html, /还有 2 项待处理/);
});

test("dismissing a toast keeps the underlying approval in inventory", () => {
  useDeckStore.setState({
    approvalItemsById: {},
    pendingApprovalIds: [],
    pendingApprovalIdsBySession: {},
    approvalToastQueue: [],
  } as any);

  useDeckStore.getState().upsertApproval({
    sessionId: "s1",
    request: {
      id: "approval-keep",
      command: "Run keep",
      reason: "审核 keep",
      cwd: "D:/repo",
    } as any,
  });

  useDeckStore.getState().dismissApprovalToast("approval-keep");

  assert.deepEqual(useDeckStore.getState().approvalToastQueue, []);
  assert.equal(
    useDeckStore.getState().approvalItemsById["approval-keep"]?.request.id,
    "approval-keep",
  );
  assert.deepEqual(useDeckStore.getState().pendingApprovalIds, ["approval-keep"]);
});
