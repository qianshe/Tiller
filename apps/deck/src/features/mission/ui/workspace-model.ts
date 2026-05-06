import { sortProjectFileSummaries } from "@tiller/shared";
import { projectFilesKey } from "../utils/project-files-key";
import { formatProjectSummaryForDisplay } from "../utils/project-display";
import { resolveProjectFilesScope } from "../utils/session-derivations";
import {
  buildMissionPanelPages,
  joinClassNames,
  resolveVisibleProjectFiles,
  selectMissionPanelPage,
} from "../utils/session-render-state";
import { isSessionExecutionPending } from "../utils/session-state";
import { resolvePendingToolActivity } from "../../logbook";

export function buildMissionWorkspaceModel(input: any) {
  const {
    prompt,
    promptImages,
    socketRef,
    activeSessionId,
    selectedProjectId,
    selectedWorkspaceId,
    selectedAgentId,
    activeSession,
    diffs,
    outputs,
    toolCalls,
    statuses,
    copy,
    customMissionPanelPages,
    selectedMissionPanelPageId,
    activeSessionProjectId,
    projectFilesByScope,
    activeSessionProject,
    draftProject,
    selectedWorkspace,
    selectedDraftAgent,
    projectFileFilter,
    collapsedProjectFileDirectories,
    missionHelms,
    effectiveMissionHelmId,
    activeHelm,
    missionProjects,
  } = input;
  const effectiveProjectId = selectedProjectId || missionProjects[0]?.id;
  const effectiveWorkspaceId = selectedWorkspaceId || selectedWorkspace?.id;
  const effectiveAgentId = selectedAgentId || selectedDraftAgent?.id;
  const canSend = Boolean(
    (prompt.trim() || promptImages.length) &&
    socketRef.current &&
    (activeSessionId ||
      (effectiveProjectId && effectiveWorkspaceId && effectiveAgentId)) &&
    (!promptImages.length ||
      !activeSession ||
      activeSession.imageInput !== false),
  );
  const activeMissionHelm =
    missionHelms.find((helm: any) => helm.id === effectiveMissionHelmId) ??
    activeHelm;
  const activeMissionHelmProjectCount = missionProjects.length;
  const activeDiffs = activeSession ? (diffs[activeSession.id] ?? []) : [];
  const activeOutputs = activeSession ? (outputs[activeSession.id] ?? []) : [];
  const activeToolCalls = activeSession
    ? (toolCalls[activeSession.id] ?? [])
    : [];
  const activeSessionStatus = activeSession
    ? (statuses[activeSession.id] ?? activeSession.status)
    : "idle";
  const pendingToolActivity =
    activeSession && isSessionExecutionPending(activeSessionStatus)
      ? resolvePendingToolActivity(activeToolCalls)
      : null;
  const missionActivityLoading =
    activeSession && isSessionExecutionPending(activeSessionStatus)
      ? (pendingToolActivity ?? {
          title: "Agent 响应",
          status: activeSessionStatus,
        })
      : null;
  const missionDiffCount = activeDiffs.length;
  const missionLogCount = activeToolCalls.length || activeOutputs.length;
  const missionStatusLabel = activeSession
    ? copy.status[statuses[activeSession.id] ?? activeSession.status]
    : "待创建";
  const missionPanelPages = buildMissionPanelPages(
    missionDiffCount,
    missionLogCount,
    customMissionPanelPages,
  );
  const selectedMissionPanelPage = selectMissionPanelPage(
    missionPanelPages,
    selectedMissionPanelPageId,
  );
  const projectFilesScope = resolveProjectFilesScope({
    activeSession,
    activeSessionProjectId,
  });
  const projectFilesEntry =
    projectFilesScope.projectId && projectFilesScope.workspaceId
      ? projectFilesByScope[
          projectFilesKey(
            projectFilesScope.projectId,
            projectFilesScope.workspaceId,
          )
        ]
      : undefined;
  const projectFiles = [...(projectFilesEntry?.files ?? [])].sort(
    sortProjectFileSummaries,
  );
  const overviewProject = activeSessionProject ?? draftProject;
  const overviewProjectName = overviewProject?.name ?? "未选项目";
  const overviewWorkspaceName =
    activeSession?.workspaceName ?? selectedWorkspace?.name ?? "未选择";
  const overviewAgentName =
    activeSession?.agentName ?? selectedDraftAgent?.name ?? "未选舰员";
  const projectOverviewItems = overviewProject
    ? [
        `Helm · ${activeMissionHelm?.name ?? overviewProject.helmId ?? "未选择"}`,
        `Project · ${overviewProjectName}`,
        `Workspace · ${overviewWorkspaceName}`,
        `ACP · ${overviewAgentName}`,
        overviewProject.path
          ? `路径 · ${overviewProject.path}`
          : "路径 · 等待 Helm 返回",
        `摘要 · ${formatProjectSummaryForDisplay(overviewProject.summary, overviewProjectName)}`,
      ]
    : [];
  const visibleProjectFiles = resolveVisibleProjectFiles(
    projectFiles,
    projectFileFilter,
    collapsedProjectFileDirectories,
  );
  const sessionExecutionPending = Boolean(
    activeSession && isSessionExecutionPending(activeSessionStatus),
  );

  return {
    canSend,
    activeMissionHelm,
    activeDiffs,
    activeOutputs,
    activeToolCalls,
    activeSessionStatus,
    pendingToolActivity,
    missionActivityLoading,
    missionDiffCount,
    missionLogCount,
    missionStatusLabel,
    missionPanelPages,
    selectedMissionPanelPage,
    projectFilesScope,
    projectFilesEntry,
    projectFiles,
    overviewProject,
    overviewProjectName,
    overviewWorkspaceName,
    overviewAgentName,
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
  };
}
