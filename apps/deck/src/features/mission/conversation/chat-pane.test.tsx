import assert from "node:assert/strict";
import test from "node:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionSummary } from "@tiller/shared";
import { MissionChatPane } from "./chat-pane.js";

function buildSession(): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    cwd: "D:/myProject/tools/Tiller",
    worktreeName: "main",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-07-06T10:00:00.000Z",
    updatedAt: "2026-07-06T10:05:00.000Z",
    messageCount: 0,
    title: "移动端会话",
  };
}

function renderChatPane(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <MissionChatPane
      className="mission-chat-pane"
      style={{}}
      isMissionMobile
      chatMainRef={createRef<HTMLDivElement>()}
      onChatMainScroll={() => undefined}
      helmConnected
      activeSession={null}
      openSessions={[]}
      selectedSessionId={null}
      activeSessionMessages={[]}
      sessionMessagesById={{}}
      sessionTimelineById={{}}
      sessionLegacyEvidenceById={{}}
      activeSessionPlan={null}
      sessionPlansById={{}}
      dismissedCompletedSessionPlanKeys={{}}
      activeSessionToolCalls={[]}
      sessionToolCallsById={{}}
      copy={{} as never}
      expandedMessageIds={new Set()}
      messageHistoryState={{}}
      onLoadOlderMessages={() => undefined}
      onLoadLegacyEvidence={() => undefined}
      onToggleExpandedMessage={() => undefined}
      activityLoading={null}
      pendingToolPresent={false}
      pendingApprovals={[]}
      pendingToolTitle={null}
      showPermissionWorktree={false}
      displayCollapsed={false}
      inspectorCollapsed={false}
      sidebarCollapsed={false}
      showThinking={false}
      canToggleDisplay
      projectOptions={[{ id: "project-1", name: "Tiller" }]}
      onExpandSidebar={() => undefined}
      onToggleDisplay={() => undefined}
      onToggleInspector={() => undefined}
      onToggleThinking={() => undefined}
      onCreateTask={() => undefined}
      onFocusSession={() => undefined}
      onSelectSessionView={() => undefined}
      onRenameSession={() => undefined}
      onCloseSessionView={() => undefined}
      onClearSession={() => undefined}
      onRespondToPermission={() => undefined}
      onUpdateQueuedPrompt={() => undefined}
      onDeleteQueuedPrompt={() => undefined}
      children={<div />}
      {...overrides}
    />,
  );
}

test("MissionChatPane shows a centered mobile create-session entry when no session is selected", () => {
  const html = renderChatPane();

  assert.match(html, /aria-label="新建会话"/u);
  assert.match(html, /title="在当前项目中新建会话"/u);
  assert.match(html, />新建会话</u);
});

test("MissionChatPane swaps the mobile close button for a create-session action when a session is selected", () => {
  const session = buildSession();
  const html = renderChatPane({
    activeSession: session,
    openSessions: [session],
    selectedSessionId: session.id,
  });

  assert.match(html, /aria-label="当前项目下新建会话"/u);
  assert.match(html, /title="更多会话操作"/u);
  assert.doesNotMatch(html, /title="关闭此 session"/u);
});

test("MissionChatPane can hide the card close action in the dashboard chat-only window", () => {
  const session = buildSession();
  const html = renderChatPane({
    isMissionMobile: false,
    hideSessionCloseAction: true,
    activeSession: session,
    openSessions: [session],
    selectedSessionId: session.id,
  });

  assert.doesNotMatch(html, /title="关闭此 session"/u);
});

test("MissionChatPane renders the desktop onboarding card on a desktop empty state", () => {
  const html = renderChatPane({ isMissionMobile: false });

  assert.match(html, /工作台引导/u);
  assert.match(html, /配置 ACP Agent/u);
  assert.match(html, /添加项目路径/u);
});

test("MissionChatPane does not render the onboarding card when sessions exist", () => {
  const session = buildSession();
  const html = renderChatPane({
    isMissionMobile: false,
    activeSession: session,
    openSessions: [session],
    selectedSessionId: session.id,
  });

  assert.doesNotMatch(html, /工作台引导/u);
});

test("MissionChatPane can keep only the session surface without its workspace header", () => {
  const session = buildSession();
  const html = renderChatPane({
    isMissionMobile: false,
    hideWorkspaceHeader: true,
    activeSession: session,
    openSessions: [session],
    selectedSessionId: session.id,
  });

  assert.doesNotMatch(html, />工作台</u);
  assert.doesNotMatch(html, /title="更多"/u);
  assert.match(html, /title="更多会话操作"/u);
  assert.match(html, /移动端会话/u);
});

test("MissionChatPane keeps the mobile create-session button on a mobile empty state", () => {
  const html = renderChatPane({});

  assert.match(html, /aria-label="新建会话"/u);
  assert.doesNotMatch(html, /工作台引导/u);
});
