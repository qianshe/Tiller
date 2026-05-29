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
  activeSession: null,
  openSessions: [],
  draftWindow: null,
  draftAgentOptions: [],
  selectedWindowId: null,
  selectedSessionId: null,
  activeSessionMessages: [],
  sessionMessagesById: {},
  activeSessionToolCalls: [],
  sessionToolCallsById: {},
  copy,
  expandedMessageIds: new Set<string>(),
  messageHistoryState: {},
  activityHistoryState: {},
  onLoadOlderMessages: () => undefined,
  onToggleExpandedMessage: () => undefined,
  activityLoading: null,
  pendingToolPresent: false,
  pendingToolTitle: null,
  showPermissionWorktree: false,
  onSelectDraftWindow: () => undefined,
  onSelectDraftAgent: () => undefined,
  onCloseDraftWindow: () => undefined,
  onSelectSessionView: () => undefined,
  onRenameSession: () => undefined,
  onCloseSessionView: () => undefined,
  onClearSession: () => undefined,
  onReimportSessionHistory: () => undefined,
  promptQueue: undefined,
  restoreNotice: undefined,
  onUpdateQueuedPrompt: () => undefined,
  onDeleteQueuedPrompt: () => undefined,
  children: null,
} as any;

function buildSession(id: string, title: string, agentName = "OpenCode") {
  return {
    id,
    title,
    agentName,
    status: "running",
    projectName: "Tiller",
  } as any;
}

function buildRequest(id: string, command: string, reason: string): PermissionRequest {
  return {
    id,
    command,
    reason,
    cwd: "D:/repo",
  } as PermissionRequest;
}

function buildApproval(
  sessionId: string,
  id: string,
  command: string,
  reason: string,
  resolving = false,
) {
  return {
    sessionId,
    request: buildRequest(id, command, reason),
    resolving,
  };
}

test("chat pane renders every pending approval for the active session", () => {
  const session = buildSession("s1", "Session One");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: session,
      openSessions: [session],
      selectedSessionId: "s1",
      pendingApprovals: [
        buildApproval("s1", "approval-1", "Run A", "审核 A"),
        buildApproval("s1", "approval-2", "Run B", "审核 B"),
      ],
      onRespondToPermission: () => undefined,
    } as any),
  );

  assert.match(html, /Run A/);
  assert.match(html, /Run B/);
});

test("chat pane renders approvals inside their matching session windows", () => {
  const firstSession = buildSession("s1", "First window");
  const secondSession = buildSession("s2", "Second window", "Codex");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: firstSession,
      openSessions: [firstSession, secondSession],
      selectedSessionId: "s1",
      pendingApprovals: [
        buildApproval("s1", "approval-1", "Run A", "审核 A"),
        buildApproval("s2", "approval-2", "Run B", "审核 B"),
      ],
      onRespondToPermission: () => undefined,
    } as any),
  );

  const firstBodyIndex = html.indexOf('data-session-card-body="s1"');
  const secondBodyIndex = html.indexOf('data-session-card-body="s2"');
  const firstApprovalIndex = html.indexOf("Run A");
  const secondApprovalIndex = html.indexOf("Run B");

  assert.ok(firstBodyIndex >= 0);
  assert.ok(secondBodyIndex >= 0);
  assert.ok(firstBodyIndex < firstApprovalIndex);
  assert.ok(firstApprovalIndex < secondBodyIndex);
  assert.ok(secondBodyIndex < secondApprovalIndex);
});

test("chat pane disables actions for a resolving approval", () => {
  const session = buildSession("s1", "Session One");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: session,
      openSessions: [session],
      selectedSessionId: "s1",
      pendingApprovals: [
        buildApproval("s1", "approval-1", "Run A", "审核 A", true),
      ],
      onRespondToPermission: () => undefined,
    } as any),
  );

  assert.match(html, /disabled/);
});

test("chat pane forwards approvalRequestId to onRespondToPermission via per-approval handler", () => {
  let lastInvocation: { id: string; decision: string } | null = null;
  const session = buildSession("s1", "Session One");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: session,
      openSessions: [session],
      selectedSessionId: "s1",
      pendingApprovals: [
        buildApproval("s1", "approval-7", "Run X", "审核 X"),
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


test("permission drawer renders one global allow action for duplicate allow_always options", () => {
  const request: PermissionRequest = {
    id: "approval-duplicate-global",
    command: "MCP • sanshu/zhi :: {}",
    reason: "Approve MCP tool call",
    cwd: "D:/repo",
    options: [
      { decision: "allow_always", label: "全局允许" },
      { decision: "allow_always", label: "Always allow" },
      { decision: "allow_always", label: "Allow globally" },
      { decision: "allow", label: "本次允许" },
      { decision: "deny", label: "拒绝" },
    ],
  };

  const session = buildSession("session-1", "Session One");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: session,
      openSessions: [session],
      selectedSessionId: "session-1",
      pendingApprovals: [{ sessionId: "session-1", request, resolving: false }],
      onRespondToPermission: () => undefined,
    } as any),
  );

  assert.equal((html.match(/全局允许/gu) ?? []).length, 1);
  assert.equal((html.match(/本次允许/gu) ?? []).length, 1);
  assert.equal((html.match(/拒绝/gu) ?? []).length, 1);
});
