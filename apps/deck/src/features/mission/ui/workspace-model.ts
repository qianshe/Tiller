import type { ProjectFileSummary } from "@tiller/shared";
import { formatProjectSummaryForDisplay } from "../utils/project-display";
import {
  buildMissionPanelPages,
  resolveMissionActivityLoading,
  selectMissionPanelPage,
} from "../utils/session-render-state";
import {
  isSessionExecutionPending,
  resolveSessionRestoreGate,
} from "../utils/session-state";
import { resolvePendingToolActivity } from "../../logbook";

export function buildMissionWorktreeModel(input: any) {
  const {
    prompt,
    promptImages,
    socketRef,
    activeSessionId,
    selectedProjectId,
    selectedCwd,
    selectedAgentId,
    activeSession,
    diffs = {},
    outputs = {},
    toolCalls = {},
    statuses = {},
    copy,
    customMissionPanelPages,
    selectedMissionPanelPageId,
    activeSessionProjectId,
    activeSessionProject,
    draftProject,
    selectedWorktree,
    selectedDraftAgent,
    activeSessionMessages,
    pendingPermission,
    missionHelms,
    effectiveMissionHelmId,
    activeHelm,
    missionProjects,
    worktrees,
    resumeStartRequestsRef,
    draftModelLoading,
  } = input;
  const effectiveProjectId = selectedProjectId || missionProjects[0]?.id;
  const effectiveWorktreeId = selectedCwd || selectedWorktree?.path;
  const effectiveAgentId = selectedAgentId;
  const activeSessionStatus = activeSession
    ? (statuses[activeSession.id] ?? activeSession.status)
    : "idle";
  const activeSessionRestoreGate = resolveSessionRestoreGate({
    activeSession,
    activeSessionStatus,
    resumeStartPending: Boolean(
      activeSession && resumeStartRequestsRef?.current?.has(activeSession.id),
    ),
  });
  const canSend = Boolean(
    activeSessionRestoreGate.canChat &&
    activeSessionStatus !== "starting" &&
    (prompt.trim() || promptImages.length) &&
    socketRef.current &&
    (activeSessionId ||
      (effectiveProjectId && effectiveWorktreeId && effectiveAgentId)) &&
    (!draftModelLoading) &&
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
  const pendingToolActivity =
    activeSession && isSessionExecutionPending(activeSessionStatus)
      ? resolvePendingToolActivity(activeToolCalls)
      : null;
  const missionActivityLoading = activeSession
    ? resolveMissionActivityLoading({
        status: activeSessionStatus,
        messages: activeSessionMessages ?? [],
        toolCalls: activeToolCalls,
        pendingPermission: pendingPermission ?? null,
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
  const projectFilesScope = {
    projectId: activeSessionProjectId ?? null,
    cwd: activeSession?.cwd ?? null,
  };
  const projectFilesEntry = activeSession
    ? {
        loading: false,
        files: [],
        message:
          "Web 端暂不拉取全量 Git 文件；请通过 Git Diff 或航行日志查看结构变化。",
      }
    : undefined;
  const projectFiles = [] as ProjectFileSummary[];
  const overviewProject = activeSessionProject ?? draftProject;
  const overviewProjectName = overviewProject?.name ?? "未选项目";
  const overviewWorktree = activeSession
    ? ((worktrees ?? []).find(
        (worktree: any) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(activeSession.cwd),
      ) ??
      selectedWorktree)
    : selectedWorktree;
  const overviewWorktreeName =
    overviewWorktree?.name ?? activeSession?.worktreeName ?? "未选择";
  const overviewAgentName =
    activeSession?.agentName ?? selectedDraftAgent?.name ?? "未选舰员";
  const currentGitBranch =
    activeSessionProject?.gitCurrentBranch ?? draftProject?.gitCurrentBranch ?? null;
  const overviewPath = overviewWorktree?.path ?? overviewProject?.path;
  const projectOverviewItems = overviewProject
    ? [
        `Helm · ${activeMissionHelm?.name ?? overviewProject.helmId ?? "未选择"}`,
        `Project · ${overviewProjectName}`,
        `Worktree · ${overviewWorktreeName}`,
        `ACP · ${overviewAgentName}`,
        overviewPath
          ? `路径 · ${overviewPath}`
          : "路径 · 等待 Helm 返回",
        `摘要 · ${formatProjectSummaryForDisplay(overviewProject.summary, overviewProjectName)}`,
      ]
    : [];
  const visibleProjectFiles = [] as ProjectFileSummary[];
  const sessionExecutionPending = Boolean(
    activeSession && isSessionExecutionPending(activeSessionStatus),
  );

  return {
    canSend,
    activeSessionRestoreGate,
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
    overviewWorktreeName,
    overviewAgentName,
    currentGitBranch,
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
  };
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
