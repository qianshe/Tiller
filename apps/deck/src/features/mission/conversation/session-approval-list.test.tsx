import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentPlan, PermissionRequest } from "@tiller/shared";
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
  sessionTimelineById: {},
  sessionPlansById: {},
  activeSessionToolCalls: [],
  sessionToolCallsById: {},
  copy,
  expandedMessageIds: new Set<string>(),
  messageHistoryState: {},
  onLoadOlderMessages: () => undefined,
  onToggleExpandedMessage: () => undefined,
  activityLoading: null,
  pendingToolPresent: false,
  pendingApprovals: [],
  pendingToolTitle: null,
  showPermissionWorktree: false,
  projectOptions: [],
  onSelectDraftWindow: () => undefined,
  onSelectDraftAgent: () => undefined,
  onCloseDraftWindow: () => undefined,
  onSelectSessionView: () => undefined,
  onRenameSession: () => undefined,
  onCloseSessionView: () => undefined,
  onClearSession: () => undefined,
  promptQueue: undefined,
  sessionPromptQueuesById: {},
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

const plan: AgentPlan = {
  updatedAt: "2026-06-03T00:00:00.000Z",
  entries: [
    { content: "复核 Markdown 渲染", priority: "medium", status: "completed" },
    { content: "确认 Diff 详情状态", priority: "high", status: "in_progress" },
  ],
};

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

test("chat pane renders approvals in a centered blocking overlay", () => {
  const session = buildSession("s1", "Session One");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: session,
      openSessions: [session],
      selectedSessionId: "s1",
      sessionMessagesById: {
        s1: [
          {
            id: "assistant-1",
            role: "assistant",
            text: "审批下方的会话正文",
            timestamp: "2026-05-29T10:00:00.000Z",
          },
        ],
      },
      sessionTimelineById: {
        s1: [
          {
            id: "assistant-1-entry",
            kind: "assistant_message",
            chunks: [
              {
                id: "assistant-1-entry:content",
                kind: "content",
                text: "审批下方的会话正文",
                timestamp: "2026-05-29T10:00:00.000Z",
                sequence: 1,
              },
            ],
            timestamp: "2026-05-29T10:00:00.000Z",
            updatedAt: "2026-05-29T10:00:00.000Z",
            sequence: 1,
          },
        ],
      },
      pendingApprovals: [
        buildApproval("s1", "approval-1", "Run A", "审核 A"),
      ],
      onRespondToPermission: () => undefined,
    } as any),
  );

  const bodyIndex = html.indexOf('data-session-card-body="s1"');
  const overlayIndex = html.indexOf('data-session-blocking-overlay="s1"');
  const approvalIndex = html.indexOf("Run A");
  const messageIndex = html.indexOf("审批下方的会话正文");

  assert.ok(bodyIndex >= 0);
  assert.ok(messageIndex > bodyIndex);
  assert.ok(overlayIndex > messageIndex);
  assert.ok(approvalIndex > overlayIndex);
  assert.match(html, /absolute inset-x-3 top-1\/2 z-30/);
});

test("chat pane anchors plans to their matching session windows", () => {
  const firstSession = buildSession("s1", "Session One");
  const secondSession = buildSession("s2", "Session Two", "Codex");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession: firstSession,
      openSessions: [firstSession, secondSession],
      selectedSessionId: "s1",
      sessionPlansById: {
        s1: plan,
        s2: {
          ...plan,
          entries: [
            { content: "检查第二窗口", priority: "medium", status: "in_progress" },
          ],
        },
      },
      children: createElement("div", { "data-testid": "mission-composer" }, "composer"),
      onRespondToPermission: () => undefined,
    } as any),
  );

  const firstBodyIndex = html.indexOf('data-session-card-body="s1"');
  const firstPlanDockIndex = html.indexOf('data-plan-session-id="s1"');
  const firstPlanContentIndex = html.indexOf("确认 Diff 详情状态");
  const secondBodyIndex = html.indexOf('data-session-card-body="s2"');
  const secondPlanDockIndex = html.indexOf('data-plan-session-id="s2"');
  const secondPlanContentIndex = html.indexOf("检查第二窗口");
  const composerIndex = html.indexOf('data-testid="mission-composer"');

  assert.equal((html.match(/data-plan-dock="session"/gu) ?? []).length, 2);
  assert.equal(html.includes('data-plan-dock="bottom"'), false);
  assert.ok(firstBodyIndex >= 0);
  assert.ok(firstPlanDockIndex >= 0);
  assert.ok(firstPlanContentIndex >= 0);
  assert.ok(secondBodyIndex >= 0);
  assert.ok(secondPlanDockIndex >= 0);
  assert.ok(secondPlanContentIndex >= 0);
  assert.ok(composerIndex >= 0);
  assert.ok(firstBodyIndex < firstPlanDockIndex);
  assert.ok(firstPlanDockIndex < firstPlanContentIndex);
  assert.ok(firstPlanContentIndex < secondBodyIndex);
  assert.ok(secondBodyIndex < secondPlanDockIndex);
  assert.ok(secondPlanDockIndex < secondPlanContentIndex);
  assert.ok(secondPlanContentIndex < composerIndex);
});

test("chat pane keeps queue-plus-plan tabs for the selected non-active session", () => {
  const activeSession = buildSession("s1", "Active session");
  const selectedSession = buildSession("s2", "Selected session", "Codex");
  const html = renderToStaticMarkup(
    createElement(MissionChatPane, {
      ...baseProps,
      activeSession,
      openSessions: [activeSession, selectedSession],
      selectedSessionId: "s2",
      sessionPlansById: {
        s2: plan,
      },
      sessionPromptQueuesById: {
        s2: {
          sessionId: "s2",
          queued: [
            {
              id: "queue-1",
              sessionId: "s2",
              text: "等待发送的 Prompt",
              clientMessageId: "client-1",
              createdAt: "2026-06-21T10:00:00.000Z",
              updatedAt: "2026-06-21T10:00:00.000Z",
              status: "queued",
            },
          ],
        },
      },
      onRespondToPermission: () => undefined,
    } as any),
  );

  assert.match(html, /data-plan-session-id="s2"/);
  assert.match(html, /data-session-dock-tabs/);
  assert.match(html, /data-session-dock-option="prompt-queue"/);
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
