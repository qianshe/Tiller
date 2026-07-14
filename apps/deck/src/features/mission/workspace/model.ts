import type { ProjectFileSummary } from "@tiller/shared";
import { formatProjectSummaryForDisplay } from "../utils/project-display";
import {
  buildMissionDisplayTabs,
  resolveMissionActivityLoading,
  selectMissionDisplayTab,
} from "../utils/session-render-state";
import {
  deriveHistoricalActivityFromTimeline,
  mergeHistoricalAndLiveOutputs,
  mergeHistoricalAndLiveToolCalls,
} from "../utils/timeline-activity";
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
    composerSession,
    diffs = {},
    outputs = {},
    toolCalls = {},
    sessionTimeline = {},
    statuses = {},
    copy,
    selectedMissionDisplayTabId,
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
  const effectiveComposerSession = composerSession ?? activeSession;
  const effectiveComposerSessionId = effectiveComposerSession?.id ?? activeSessionId;
  const effectiveProjectId = selectedProjectId || missionProjects[0]?.id;
  const effectiveWorktreeId = selectedCwd || selectedWorktree?.path;
  const effectiveAgentId = selectedAgentId;
  const activeSessionStatus = activeSession
    ? (statuses[activeSession.id] ?? activeSession.status)
    : "idle";
  const composerSessionStatus = effectiveComposerSession
    ? (statuses[effectiveComposerSession.id] ?? effectiveComposerSession.status)
    : "idle";
  const activeSessionRestoreGate = resolveSessionRestoreGate({
    activeSession,
    activeSessionStatus,
    resumeStartPending: Boolean(
      activeSession && resumeStartRequestsRef?.current?.has(activeSession.id),
    ),
  });
  const composerSessionRestoreGate = resolveSessionRestoreGate({
    activeSession: effectiveComposerSession,
    activeSessionStatus: composerSessionStatus,
    resumeStartPending: Boolean(
      effectiveComposerSession &&
        resumeStartRequestsRef?.current?.has(effectiveComposerSession.id),
    ),
  });
  const composerModelLoading = Boolean(draftModelLoading);
  const composerSessionRestoring =
    composerSessionRestoreGate.state === "checking" ||
    composerSessionRestoreGate.state === "restoring";
  const canSend = Boolean(
    composerSessionRestoreGate.canChat &&
    composerSessionStatus !== "starting" &&
    (prompt.trim() || promptImages.length) &&
    socketRef.current &&
    (effectiveComposerSessionId ||
      (effectiveProjectId && effectiveWorktreeId && effectiveAgentId)) &&
    (!composerModelLoading) &&
    (!promptImages.length ||
      !effectiveComposerSession ||
      effectiveComposerSession.imageInput !== false),
  );
  const activeMissionHelm =
    missionHelms.find((helm: any) => helm.id === effectiveMissionHelmId) ??
    activeHelm;
  const activeMissionHelmProjectCount = missionProjects.length;
  const activeDiffs = activeSession ? (diffs[activeSession.id] ?? []) : [];
  const activeTimelineActivity = activeSession
    ? deriveHistoricalActivityFromTimeline(sessionTimeline[activeSession.id])
    : { outputs: [], toolCalls: [] };
  const activeOutputs = activeSession
    ? mergeHistoricalAndLiveOutputs(
      activeTimelineActivity.outputs,
      outputs[activeSession.id] ?? [],
    )
    : [];
  const activeToolCalls = activeSession
    ? mergeHistoricalAndLiveToolCalls(
      activeTimelineActivity.toolCalls,
      toolCalls[activeSession.id] ?? [],
    )
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
  const missionDisplayTabs = buildMissionDisplayTabs(
    missionDiffCount,
    missionLogCount,
  );
  const selectedMissionDisplayTab = selectMissionDisplayTab(
    missionDisplayTabs,
    selectedMissionDisplayTabId,
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
  const worktreeScopeProject = activeSessionProject ?? draftProject;
  const filteredWorktrees =
    worktreeScopeProject?.worktrees?.length
      ? worktreeScopeProject.worktrees
      : (worktrees ?? []).filter(
          (worktree: any) =>
            normalizeWorktreePath(worktree.path) === normalizeWorktreePath(worktreeScopeProject?.path) ||
            Boolean(
              worktreeScopeProject?.path &&
                normalizeWorktreePath(worktree.path)?.startsWith(
                  `${normalizeWorktreePath(worktreeScopeProject.path)}/`,
                ),
            ),
        );
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
    effectiveComposerSession && isSessionExecutionPending(composerSessionStatus),
  );

  return {
    canSend,
    activeSessionRestoreGate,
    composerSessionRestoreGate,
    activeMissionHelm,
    activeDiffs,
    activeOutputs,
    activeToolCalls,
    activeSessionStatus,
    composerSessionStatus,
    pendingToolActivity,
    missionActivityLoading,
    missionDiffCount,
    missionLogCount,
    missionStatusLabel,
    missionDisplayTabs,
    selectedMissionDisplayTab,
    projectFilesScope,
    projectFilesEntry,
    projectFiles,
    overviewProject,
    overviewProjectName,
    filteredWorktrees,
    overviewWorktreeName,
    overviewAgentName,
    currentGitBranch,
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
    composerModelLoading,
    composerSessionRestoring,
  };
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
