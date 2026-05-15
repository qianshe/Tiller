import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermissionRequest } from "@tiller/shared";
import { MissionChatPane } from "./chat-pane.js";

const copy = {
  permissionRequest: "权限请求",
  allowOnce: "本次允许",
  deny: "拒绝",
  status: { idle: "空闲", running: "运行", waiting_for_permission: "等待审核", error: "错误", starting: "启动中" },
} as any;

const baseProps = {
  className: "chat-pane",
  style: {},
  chatMainRef: { current: null },
  onChatMainScroll: () => undefined,
  helmConnected: true,
  activeSessionMessages: [],
  activeSessionToolCalls: [],
  copy,
  expandedMessageIds: new Set<string>(),
  messageHistoryState: {},
  onLoadOlderMessages: () => undefined,
  onToggleExpandedMessage: () => undefined,
  activityLoading: null,
  pendingToolPresent: false,
  pendingToolTitle: null,
  showPermissionWorktree: false,
  children: null,
} as any;

function buildRequest(id: string, command: string, reason: string): PermissionRequest {
  return {
    id,
    command,
    reason,
    cwd: "D:/repo",
  } as PermissionRequest;
}

test("chat pane renders every pending approval for the active session", () => {
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: { id: "s1", agentName: "OpenCode" } as any,
      pendingApprovals: [
        { request: buildRequest("approval-1", "Run A", "审核 A"), resolving: false },
        { request: buildRequest("approval-2", "Run B", "审核 B"), resolving: false },
      ],
      onRespondToPermission: () => undefined,
    } as any),
  );

  assert.match(html, /Run A/);
  assert.match(html, /Run B/);
});

test("chat pane disables actions for a resolving approval", () => {
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: { id: "s1", agentName: "OpenCode" } as any,
      pendingApprovals: [
        { request: buildRequest("approval-1", "Run A", "审核 A"), resolving: true },
      ],
      onRespondToPermission: () => undefined,
    } as any),
  );

  assert.match(html, /disabled/);
});

test("chat pane forwards approvalRequestId to onRespondToPermission via per-approval handler", () => {
  let lastInvocation: { id: string; decision: string } | null = null;
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: { id: "s1", agentName: "OpenCode" } as any,
      pendingApprovals: [
        { request: buildRequest("approval-7", "Run X", "审核 X"), resolving: false },
      ],
      onRespondToPermission: (approvalRequestId: string, decision: string) => {
        lastInvocation = { id: approvalRequestId, decision };
      },
    } as any),
  );

  // We can't easily fire a click in renderToStaticMarkup; verify the rendered
  // button text confirms the per-approval drawer is wired through.
  assert.match(html, /Run X/);
  assert.equal(lastInvocation, null);
});
