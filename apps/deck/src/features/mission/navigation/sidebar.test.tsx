import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HelmSummary, ProjectSummary } from "@tiller/shared";
import { MissionSidebar } from "./sidebar.js";

function helm(): HelmSummary {
  return {
    id: "helm-1",
    name: "Local Helm",
    host: "127.0.0.1",
    port: 47631,
  } as HelmSummary;
}

function project(): ProjectSummary {
  return {
    id: "project-1",
    helmId: "helm-1",
    name: "Tiller",
    path: "D:/myProject/tools/Tiller",
    worktrees: [{ name: "main", path: "D:/myProject/tools/Tiller" }],
  } as ProjectSummary;
}

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <MissionSidebar
      effectiveSidebarCollapsed={false}
      missionSidebarCollapsed={false}
      missionSidebarPaneStyle={{}}
      handleMissionTreeScroll={() => undefined}
      setMissionSidebarCollapsed={() => undefined}
      missionHelms={[helm()]}
      effectiveMissionHelmId="helm-1"
      expandedMissionHelmIds={new Set(["helm-1"])}
      projects={[project()]}
      helmConnectionStates={{}}
      activeProfileId="helm-1"
      connection="connected"
      toggleMissionHelmNode={() => undefined}
      missionSelectedProjectId="project-1"
      expandedMissionProjectIds={new Set()}
      sessions={[]}
      sessionCountsByProject={{ "project-1": 0 }}
      currentGitBranch={null}
      missionDiffCount={0}
      runtimeOverviewItems={[]}
      setActiveSessionId={() => undefined}
      statuses={{}}
      completedUnreadSessionIds={{}}
      copy={{
        status: {
          idle: "空闲",
          running: "运行中",
          waiting_for_permission: "待审批",
          error: "错误",
          starting: "启动中",
          cancelled: "已取消",
        },
      }}
      activeSessionId={null}
      highlightedSessionId={null}
      openSessionIds={new Set()}
      openSession={() => undefined}
      renderMissionAgentIcon={() => <span>AI</span>}
      resolveDisplaySessionTitle={(session) => session.title ?? session.id}
      regenerateSessionTitle={() => undefined}
      regeneratingIds={new Set()}
      formatRelativeTime={() => "1m"}
      setPendingSessionCleanup={() => undefined}
      sessionHistoryState={{ hasMore: false, loading: false }}
      toggleMissionProjectNode={() => undefined}
      setSelectedMissionMobilePane={() => undefined}
      resizer={null}
      {...overrides}
    />,
  );
}

test("MissionSidebar keeps mobile header focused on search and collapse actions", () => {
  const html = renderSidebar();

  assert.match(html, /aria-label="搜索任务"/u);
  assert.doesNotMatch(html, /aria-label="新建任务"/u);
});
