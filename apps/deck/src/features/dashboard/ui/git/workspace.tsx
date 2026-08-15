import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { FileDiffSummary, HelmSummary, ProjectSummary, WorktreeSummary } from "@tiller/shared";
import {
  Button,
  Icon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusDot,
} from "../../../../shared/ui";
import type { DeckRpcClient } from "../../../helm-connection";
import { daemonProfileKey } from "../../../helm-connection";
import { GitGraphPanel } from "../../../mission";
import {
  GitDiffDetail,
  GitDiffFileList,
  GIT_GRAPH_CACHE_TTL_MS,
  GIT_STATUS_CACHE_TTL_MS,
  gitCwdKey,
  gitScopeKey,
  isGitCacheFresh,
  requestGitGraph,
  refreshGitStatusAndGraph,
  resolveGitGraph,
  resolveGitStatus,
  toGitFileDiff,
  type GitDispatchResult,
} from "../../../git";
import type { GitGraphState, GitStatusState } from "../../../../store/facade";
import {
  resolveDashboardGitMobilePane,
  resolveDashboardGitSelectedFilePath,
  type DashboardGitMobilePane,
} from "./selection";

type GitDispatch = (
  client: DeckRpcClient,
  method: string,
  params: unknown,
  options?: { sourceHelmKey?: string },
) => Promise<unknown>;

type DashboardGitInventory = {
  projects?: ProjectSummary[];
  worktrees?: WorktreeSummary[];
};

type DashboardGitProjectOption = {
  key: string;
  label: string;
  project: ProjectSummary;
  helmKey: string;
  helmName: string;
  helmEndpoint: string;
  connection: "connecting" | "connected" | "disconnected";
  worktrees: WorktreeSummary[];
};

export type DashboardGitWorkspaceProps = {
  currentHelmKey: string;
  currentConnection: "connecting" | "connected" | "disconnected";
  configuredHelms?: HelmSummary[];
  helms?: HelmSummary[];
  helmConnectionStates?: Record<string, "connecting" | "connected" | "disconnected">;
  helmInventories?: Record<string, DashboardGitInventory | undefined>;
  projects: ProjectSummary[];
  worktrees: WorktreeSummary[];
  gitStatusByWorktree: Record<string, GitStatusState>;
  rpcClientRef: { current: DeckRpcClient | null };
  helmRpcClientRefs: { current: Map<string, DeckRpcClient> };
  dispatch: GitDispatch;
  gitGraphByWorktree?: Record<string, GitGraphState>;
  setGitGraphByWorktree?: (
    updater: (current: Record<string, GitGraphState>) => Record<string, GitGraphState>,
  ) => void;
  isMobile?: boolean;
};

const GIT_HISTORY_RATIO_DEFAULT = 0.4;
const GIT_HISTORY_RATIO_MIN = 0.2;
const GIT_HISTORY_RATIO_MAX = 0.75;

export function clampGitHistoryRatio(ratio: number) {
  if (!Number.isFinite(ratio)) {
    return GIT_HISTORY_RATIO_DEFAULT;
  }
  return Math.min(GIT_HISTORY_RATIO_MAX, Math.max(GIT_HISTORY_RATIO_MIN, ratio));
}

function resolveGitSidebarRows(changesOpen: boolean, historyOpen: boolean, historyRatio: number) {
  if (changesOpen && historyOpen) {
    const clampedRatio = clampGitHistoryRatio(historyRatio);
    return `minmax(0,${1 - clampedRatio}fr) 8px minmax(0,${clampedRatio}fr)`;
  }
  if (changesOpen) {
    return "minmax(0,1fr) 32px";
  }
  if (historyOpen) {
    return "32px minmax(0,1fr)";
  }
  return "32px 32px";
}

function normalizePath(path: string | undefined) {
  return path === undefined ? undefined : gitCwdKey(path);
}

function helmKeyForSummary(helm: HelmSummary) {
  return daemonProfileKey(helm.host, String(helm.port));
}

function resolveHelmLabel(helm: HelmSummary | undefined, fallbackKey: string) {
  return helm?.name?.trim() || fallbackKey;
}

function resolveHelmEndpoint(helm: HelmSummary | undefined, fallbackKey: string) {
  return helm ? `${helm.host}:${helm.port}` : fallbackKey;
}

function worktreeMatchesProject(worktree: WorktreeSummary, project: ProjectSummary) {
  const path = normalizePath(worktree.path);
  const projectPath = normalizePath(project.path);
  return Boolean(
    path &&
      (project.worktrees?.some((item) => normalizePath(item.path) === path) ||
        path === projectPath ||
        (projectPath && path.startsWith(`${projectPath}/`))),
  );
}

function resolveProjectWorktrees(project: ProjectSummary | undefined, inventoryWorktrees: WorktreeSummary[]) {
  if (!project) return [];
  const configured = project.worktrees?.filter((item) => item.path.trim()) ?? [];
  if (configured.length) return configured;
  const discovered = inventoryWorktrees.filter((item) => worktreeMatchesProject(item, project));
  if (discovered.length) return discovered;
  if (project.path?.trim()) {
    return [{
      name: project.gitCurrentBranch || project.path.split(/[\\/]/u).filter(Boolean).at(-1) || project.path,
      path: project.path,
      branch: project.gitCurrentBranch,
      kind: "root",
    } satisfies WorktreeSummary];
  }
  return [];
}

function resolveSelectedWorktree(worktrees: WorktreeSummary[], project: ProjectSummary) {
  const root = normalizePath(project.path);
  return worktrees.find((item) => normalizePath(item.path) === root) ?? worktrees[0];
}

function resolveConnectionState(
  helmKey: string,
  currentHelmKey: string,
  currentConnection: DashboardGitWorkspaceProps["currentConnection"],
  helmConnectionStates: DashboardGitWorkspaceProps["helmConnectionStates"],
) {
  return helmConnectionStates?.[helmKey] ?? (helmKey === currentHelmKey ? currentConnection : "disconnected");
}

function buildGitProjectOptions({
  currentHelmKey,
  currentConnection,
  configuredHelms,
  helms,
  helmConnectionStates,
  helmInventories,
  projects,
  worktrees,
}: Pick<DashboardGitWorkspaceProps, "currentHelmKey" | "currentConnection" | "configuredHelms" | "helms" | "helmConnectionStates" | "helmInventories" | "projects" | "worktrees">): DashboardGitProjectOption[] {
  const helmCatalog = new Map<string, HelmSummary>();
  for (const helm of [...(configuredHelms ?? []), ...(helms ?? [])]) {
    helmCatalog.set(helmKeyForSummary(helm), helm);
  }
  if (!helmCatalog.has(currentHelmKey)) {
    helmCatalog.set(currentHelmKey, {
      id: currentHelmKey,
      name: "当前 Helm",
      host: currentHelmKey.split(":")[0] || currentHelmKey,
      port: Number(currentHelmKey.split(":").at(-1) || 0),
    });
  }

  const helmKeys = new Set([...helmCatalog.keys(), ...Object.keys(helmInventories ?? {})]);
  const rawOptions: DashboardGitProjectOption[] = [];
  for (const helmKey of helmKeys) {
    const inventory = helmInventories?.[helmKey];
    const isCurrent = helmKey === currentHelmKey;
    const helm = helmCatalog.get(helmKey);
    const helmProjects = isCurrent ? (inventory?.projects?.length ? inventory.projects : projects) : inventory?.projects ?? [];
    const helmWorktrees = isCurrent ? (inventory?.worktrees?.length ? inventory.worktrees : worktrees) : inventory?.worktrees ?? [];
    const connection = resolveConnectionState(helmKey, currentHelmKey, currentConnection, helmConnectionStates);
    for (const project of helmProjects) {
      rawOptions.push({
        key: `${helmKey}::${project.id}`,
        project,
        helmKey,
        helmName: resolveHelmLabel(helm, helmKey),
        helmEndpoint: resolveHelmEndpoint(helm, helmKey),
        connection,
        worktrees: resolveProjectWorktrees(project, helmWorktrees),
        label: project.name || project.id,
      });
    }
  }

  rawOptions.sort((left, right) => {
    const nameOrder = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    if (nameOrder !== 0) return nameOrder;
    return left.helmName.localeCompare(right.helmName, undefined, { sensitivity: "base" });
  });

  const nameCounts = new Map<string, number>();
  for (const option of rawOptions) nameCounts.set(option.label, (nameCounts.get(option.label) ?? 0) + 1);
  const usedLabels = new Set<string>();
  return rawOptions.map((option) => {
    const duplicateName = (nameCounts.get(option.label) ?? 0) > 1;
    let label = duplicateName ? `${option.label} · ${option.helmName}` : option.label;
    if (usedLabels.has(label)) label = `${label} · ${option.helmEndpoint}`;
    if (usedLabels.has(label)) label = `${label} · ${option.project.id}`;
    usedLabels.add(label);
    return { ...option, label };
  });
}

export function DashboardGitWorkspace({
  currentHelmKey,
  currentConnection,
  configuredHelms = [],
  helms = [],
  helmConnectionStates = {},
  helmInventories = {},
  projects,
  worktrees,
  gitStatusByWorktree,
  rpcClientRef,
  helmRpcClientRefs,
  dispatch,
  gitGraphByWorktree = {},
  setGitGraphByWorktree,
  isMobile = false,
}: DashboardGitWorkspaceProps) {
  const projectOptions = useMemo(
    () => buildGitProjectOptions({ currentHelmKey, currentConnection, configuredHelms, helms, helmConnectionStates, helmInventories, projects, worktrees }),
    [configuredHelms, currentConnection, currentHelmKey, helmConnectionStates, helmInventories, helms, projects, worktrees],
  );
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [selectedCwd, setSelectedCwd] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(new Set());
  const [activePane, setActivePane] = useState<"changes" | "detail">("changes");
  const [changesOpen, setChangesOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRatio, setHistoryRatio] = useState(GIT_HISTORY_RATIO_DEFAULT);
  const [mobileScopeOpen, setMobileScopeOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | undefined>();
  const [patchLoadingPath, setPatchLoadingPath] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | undefined>();
  const requestedGraphKeysRef = useRef(new Set<string>());
  const requestedCommitDetailKeysRef = useRef(new Set<string>());
  const requestedPatchKeysRef = useRef(new Set<string>());
  const refreshGenerationRef = useRef(0);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const loadGraphRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const gitSidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!projectOptions.some((item) => item.key === selectedProjectKey)) {
      setSelectedProjectKey(projectOptions[0]?.key ?? "");
      setSelectedCwd("");
    }
  }, [projectOptions, selectedProjectKey]);

  const selectedProjectOption = projectOptions.find((item) => item.key === selectedProjectKey);
  const selectedProject = selectedProjectOption?.project;
  const selectedProjectId = selectedProject?.id ?? "";
  const selectedHelmKey = selectedProjectOption?.helmKey ?? "";
  const projectWorktrees = selectedProjectOption?.worktrees ?? [];
  const targetConnection = selectedProjectOption?.connection ?? "disconnected";
  const targetClient = selectedHelmKey === currentHelmKey ? rpcClientRef.current : helmRpcClientRefs.current.get(selectedHelmKey) ?? null;
  const scope = selectedProjectOption && selectedProjectId && selectedCwd
    ? { helmKey: selectedHelmKey, projectId: selectedProjectId, cwd: selectedCwd }
    : null;
  const scopeKey = scope ? gitScopeKey(scope) : null;
  const status = scope ? resolveGitStatus(gitStatusByWorktree, scope) : undefined;
  const graph = scope ? resolveGitGraph(gitGraphByWorktree, scope) : undefined;
  const statusError = status?.error && !status.remoteRefreshError ? status.error : undefined;
  const files = useMemo(() => status?.files.map(toGitFileDiff) ?? [], [status]);
  const selectedFile = files.find((file) => file.path === selectedFilePath);
  const mobilePane = resolveDashboardGitMobilePane(activePane, historyOpen);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const nextWorktree = projectWorktrees.find((item) => normalizePath(item.path) === normalizePath(selectedCwd)) ?? (selectedProject ? resolveSelectedWorktree(projectWorktrees, selectedProject) : undefined);
    if (nextWorktree?.path !== selectedCwd) setSelectedCwd(nextWorktree?.path ?? "");
  }, [projectWorktrees, selectedCwd, selectedProject]);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    setSelectedFilePath(null);
    setCollapsedDirectories(new Set());
    setPatchError(undefined);
    setPatchLoadingPath(null);
    setRefreshError(undefined);
    setActivePane("changes");
    setChangesOpen(true);
    setHistoryOpen(false);
  }, [scopeKey]);

  const dispatchForScope = useCallback(async (method: string, params: Record<string, unknown>): Promise<GitDispatchResult> => {
    if (!targetClient || targetConnection !== "connected") throw new Error("目标 Helm 未连接");
    return await dispatch(targetClient, method, params, { sourceHelmKey: selectedHelmKey }) as GitDispatchResult;
  }, [dispatch, selectedHelmKey, targetClient, targetConnection]);

  const refresh = useCallback(async () => {
    if (!scope) return;
    const generation = ++refreshGenerationRef.current;
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      const result = await refreshGitStatusAndGraph(dispatchForScope, { projectId: scope.projectId, cwd: scope.cwd, scopeKey: scopeKey ?? undefined, hasGraph: false, refreshRemote: false });
      if (result?.ok !== true && generation === refreshGenerationRef.current) setRefreshError(result?.message || "Git 状态刷新失败");
    } catch (error) {
      if (generation === refreshGenerationRef.current) setRefreshError(error instanceof Error ? error.message : "Git 状态刷新失败");
    } finally {
      if (generation === refreshGenerationRef.current) setRefreshing(false);
    }
  }, [dispatchForScope, scope, scopeKey]);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!scopeKey || !scope || targetConnection !== "connected" || !targetClient) {
      setRefreshing(false);
      return;
    }
    const cachedStatus = statusRef.current;
    if (
      cachedStatus?.loading ||
      isGitCacheFresh(cachedStatus?.lastUpdated, GIT_STATUS_CACHE_TTL_MS)
    ) {
      setRefreshing(false);
      return;
    }
    void refreshRef.current?.();
  }, [scopeKey, targetClient, targetConnection]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refreshWhenStale = () => {
      if (!scopeKey || targetConnection !== "connected" || !targetClient) return;
      const cachedStatus = statusRef.current;
      if (
        cachedStatus?.loading ||
        isGitCacheFresh(cachedStatus?.lastUpdated, GIT_STATUS_CACHE_TTL_MS)
      ) {
        return;
      }
      void refreshRef.current?.();
    };
    window.addEventListener("focus", refreshWhenStale);
    return () => window.removeEventListener("focus", refreshWhenStale);
  }, [scopeKey, targetClient, targetConnection]);

  const loadGraph = useCallback(async (force = false) => {
    if (!scope || !scopeKey || !targetClient || targetConnection !== "connected") return;
    if (
      graph?.loading ||
      (!force && isGitCacheFresh(graph?.lastUpdated, GIT_GRAPH_CACHE_TTL_MS)) ||
      requestedGraphKeysRef.current.has(scopeKey)
    ) return;
    requestedGraphKeysRef.current.add(scopeKey);
    setGitGraphByWorktree?.((current) => ({
      ...current,
      [scopeKey]: { projectId: scope.projectId, cwd: scope.cwd, commits: graph?.commits ?? [], ...(graph?.head ? { head: graph.head } : {}), ...(graph?.signature ? { signature: graph.signature } : {}), scopeKey, loading: true, message: "正在加载提交历史..." },
    }));
    try {
      const result = await requestGitGraph(dispatchForScope, {
        projectId: scope.projectId,
        cwd: scope.cwd,
        scopeKey,
        knownSignature: graph?.signature,
      });
      if (result?.ok === false) throw new Error(result.message || "提交历史加载失败");
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交历史加载失败";
      setGitGraphByWorktree?.((current) => current[scopeKey] ? { ...current, [scopeKey]: { ...current[scopeKey], loading: false, error: message, message } } : current);
    } finally {
      requestedGraphKeysRef.current.delete(scopeKey);
    }
  }, [dispatchForScope, graph, scope, scopeKey, setGitGraphByWorktree, targetClient, targetConnection]);
  loadGraphRef.current = loadGraph;

  useEffect(() => {
    if (historyOpen) void loadGraphRef.current?.();
  }, [historyOpen, scopeKey, targetClient, targetConnection]);

  useEffect(() => {
    if (targetConnection !== "connected") {
      refreshGenerationRef.current += 1;
      setSelectedFilePath(null);
      setPatchLoadingPath(null);
      setPatchError(undefined);
    }
  }, [targetConnection]);

  useEffect(() => {
    const nextSelectedFilePath = resolveDashboardGitSelectedFilePath(selectedFilePath, files);
    if (nextSelectedFilePath !== selectedFilePath) {
      setSelectedFilePath(nextSelectedFilePath);
      if (isMobile && !nextSelectedFilePath) setActivePane("changes");
    }
  }, [files, isMobile, selectedFilePath]);

  const ensurePatch = useCallback(async (path: string) => {
    if (!scope || !status || !targetClient || targetConnection !== "connected") return;
    const generation = refreshGenerationRef.current;
    const file = status.files.find((item) => item.path === path);
    if (!file || file.patch || file.patchRef || file.patchTruncated) return;
    const requestKey = `${scopeKey}:${status.lastUpdated ?? "unknown"}:${path}`;
    if (requestedPatchKeysRef.current.has(requestKey)) return;
    requestedPatchKeysRef.current.add(requestKey);
    setPatchLoadingPath(path);
    setPatchError(undefined);
    try {
      const result = await dispatchForScope("project/git/file_diff", { projectId: scope.projectId, cwd: scope.cwd, paths: [path] });
      if (!result?.ok && generation === refreshGenerationRef.current) {
        requestedPatchKeysRef.current.delete(requestKey);
        setPatchError(result?.message || "该文件没有可展示的 patch");
      }
    } catch (error) {
      if (generation === refreshGenerationRef.current) setPatchError(error instanceof Error ? error.message : "Diff 加载失败");
      requestedPatchKeysRef.current.delete(requestKey);
    } finally {
      if (generation === refreshGenerationRef.current) setPatchLoadingPath((current) => current === path ? null : current);
    }
  }, [dispatchForScope, scope, scopeKey, status, targetClient, targetConnection]);

  useEffect(() => {
    if (selectedFilePath) void ensurePatch(selectedFilePath);
  }, [ensurePatch, selectedFilePath]);

  const handleSelectGitCommit = useCallback(async (commitHash: string) => {
    if (!scope || !scopeKey || !targetClient || targetConnection !== "connected") return;
    const currentDetail = graph?.commitDetails?.[commitHash];
    if (currentDetail?.loading || (currentDetail && !currentDetail.error)) return;
    const requestKey = `${scopeKey}:${commitHash}`;
    if (requestedCommitDetailKeysRef.current.has(requestKey)) return;
    requestedCommitDetailKeysRef.current.add(requestKey);
    setGitGraphByWorktree?.((current) => {
      const previous = current[scopeKey] ?? { projectId: scope.projectId, cwd: scope.cwd, commits: [], scopeKey };
      return { ...current, [scopeKey]: { ...previous, commitDetails: { ...previous.commitDetails, [commitHash]: { commitHash, files: previous.commitDetails?.[commitHash]?.files ?? [], loading: true, message: "正在加载提交详情..." } } } };
    });
    try {
      const result = await dispatchForScope("project/git/commit_detail", { projectId: scope.projectId, cwd: scope.cwd, commitHash });
      if (result?.ok === false) throw new Error(result.message || "提交详情加载失败");
    } catch (error) {
      requestedCommitDetailKeysRef.current.delete(requestKey);
      const message = error instanceof Error ? error.message : "提交详情加载失败";
      setGitGraphByWorktree?.((current) => {
        const previous = current[scopeKey];
        if (!previous) return current;
        const detail = previous.commitDetails?.[commitHash];
        return { ...current, [scopeKey]: { ...previous, commitDetails: { ...previous.commitDetails, [commitHash]: { commitHash, files: detail?.files ?? [], loading: false, message, error: message } } } };
      });
    }
  }, [dispatchForScope, graph, scope, scopeKey, setGitGraphByWorktree, targetClient, targetConnection]);

  const emptyReason = !projectOptions.length
    ? "暂无项目，请先在 Agents / 项目配置中添加项目。"
    : !selectedProjectOption
      ? "请选择项目。"
      : targetConnection !== "connected"
        ? "请先连接目标 Helm。"
        : !projectWorktrees.length
          ? "该项目没有可用工作区。"
          : undefined;
  const handleFileSelect = (path: string) => {
    setSelectedFilePath(path);
    if (isMobile) {
      setHistoryOpen(false);
      setActivePane("detail");
    }
  };
  const handleMobilePaneChange = (pane: DashboardGitMobilePane) => {
    if (pane === "history") {
      setHistoryOpen(true);
      return;
    }
    setHistoryOpen(false);
    setActivePane(pane);
  };
  const handleRefresh = () => {
    void refresh();
    if (historyOpen && scopeKey) {
      requestedGraphKeysRef.current.delete(scopeKey);
      void loadGraphRef.current?.(true);
    }
  };

  return (
    <section className="dashboard-git-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Git 工作台">
      {isMobile ? (
        <div className="flex min-w-0 flex-col gap-2 border-b border-border-ghost bg-surface px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <GitScopeMeta compact project={selectedProject} worktreePath={selectedCwd} status={status} />
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={mobileScopeOpen ? "收起 Git 范围选择" : "展开 Git 范围选择"}
              title={mobileScopeOpen ? "收起 Git 范围选择" : "展开 Git 范围选择"}
              aria-controls="dashboard-git-mobile-scope"
              aria-expanded={mobileScopeOpen}
              onClick={() => setMobileScopeOpen((current) => !current)}
            >
              <Icon name={mobileScopeOpen ? "chevronDown" : "chevronRight"} size={14} />
            </Button>
            <Button variant="outline" size="sm" className="shrink-0" onClick={handleRefresh} disabled={!scope || refreshing || targetConnection !== "connected"}>
              <Icon name="refresh" />
              <span>{refreshing ? "刷新中" : "刷新"}</span>
            </Button>
          </div>
          <div id="dashboard-git-mobile-scope" hidden={!mobileScopeOpen} className="grid min-w-0 grid-cols-2 gap-2">
            <GitScopeSelect compact label="项目" value={selectedProjectKey} onValueChange={(value) => { setSelectedProjectKey(value); setSelectedCwd(""); }} options={projectOptions.map((option) => ({ value: option.key, label: option.label }))} disabled={!projectOptions.length} />
            <GitScopeSelect compact label="Worktree" value={selectedCwd} onValueChange={setSelectedCwd} options={projectWorktrees.map((item) => ({ value: item.path, label: item.branch?.trim() || "未命名分支" }))} disabled={!projectWorktrees.length} />
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border-ghost bg-surface px-3 py-2.5 md:px-4">
          <GitScopeSelect inline label="项目" value={selectedProjectKey} onValueChange={(value) => { setSelectedProjectKey(value); setSelectedCwd(""); }} options={projectOptions.map((option) => ({ value: option.key, label: option.label }))} disabled={!projectOptions.length} />
          <GitScopeSelect inline label="Worktree" value={selectedCwd} onValueChange={setSelectedCwd} options={projectWorktrees.map((item) => ({ value: item.path, label: item.branch?.trim() || "未命名分支" }))} disabled={!projectWorktrees.length} />
          <GitScopeMeta project={selectedProject} worktreePath={selectedCwd} status={status} />
          <Button variant="outline" size="sm" className="shrink-0" onClick={handleRefresh} disabled={!scope || refreshing || targetConnection !== "connected"}><Icon name="refresh" /><span>{refreshing ? "刷新中" : "刷新"}</span></Button>
        </div>
      )}
      {refreshError || statusError ? <div className="flex items-center gap-2 border-b border-border-ghost px-3 py-1.5 text-meta text-destructive md:px-4"><span className="min-w-0 flex-1 truncate">{refreshError || statusError}</span><Button variant="ghost" size="xs" onClick={() => void refresh()}>重试</Button></div> : null}
      {isMobile ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
          <MobileGitPaneTabs activePane={mobilePane} hasSelectedFile={Boolean(selectedFile)} canShowHistory={Boolean(scope) && targetConnection === "connected"} onChange={handleMobilePaneChange} />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2">
            {mobilePane === "changes" ? <GitFilePane files={files} selectedFilePath={selectedFilePath} collapsedDirectories={collapsedDirectories} onSelectFile={handleFileSelect} onToggleDirectory={(path) => toggleDirectory(path, setCollapsedDirectories)} emptyReason={emptyReason} loading={refreshing || Boolean(status?.loading)} clean={Boolean(status?.clean)} error={refreshError || statusError} /> : mobilePane === "detail" ? <GitDiffDetail file={selectedFile} loading={patchLoadingPath === selectedFilePath} error={patchError} /> : <GitHistoryPane graph={graph} onRetry={() => { requestedGraphKeysRef.current.delete(scopeKey ?? ""); void loadGraphRef.current?.(true); }} onSelectCommit={(hash) => void handleSelectGitCommit(hash)} />}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(240px,300px)_minmax(0,1fr)] overflow-hidden">
          <aside
            ref={gitSidebarRef}
            className="grid min-h-0 min-w-0 grid-rows-[32px_32px] overflow-hidden border-r border-border-ghost bg-surface"
            style={{ gridTemplateRows: resolveGitSidebarRows(changesOpen, historyOpen, historyRatio) }}
            aria-label="Git 变更与提交历史"
          >
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden" aria-label="变更">
              <GitSidebarSectionHeader label="变更" open={changesOpen} count={files.length} onToggle={() => setChangesOpen((current) => !current)} />
              {changesOpen ? (
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
                  <GitFilePane files={files} selectedFilePath={selectedFilePath} collapsedDirectories={collapsedDirectories} onSelectFile={handleFileSelect} onToggleDirectory={(path) => toggleDirectory(path, setCollapsedDirectories)} emptyReason={emptyReason} loading={refreshing || Boolean(status?.loading)} clean={Boolean(status?.clean)} error={refreshError || statusError} />
                </div>
              ) : null}
            </section>
            {changesOpen && historyOpen ? (
              <GitSidebarResizeHandle
                ratio={historyRatio}
                containerRef={gitSidebarRef}
                onRatioChange={setHistoryRatio}
              />
            ) : null}
            <section id="dashboard-git-history" className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border-ghost" aria-label="图表">
              <GitSidebarSectionHeader label="图表" open={historyOpen} onToggle={() => setHistoryOpen((current) => !current)} disabled={!scope || targetConnection !== "connected"} />
              {historyOpen ? (
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  <GitHistoryPane graph={graph} onRetry={() => { requestedGraphKeysRef.current.delete(scopeKey ?? ""); void loadGraphRef.current?.(true); }} onSelectCommit={(hash) => void handleSelectGitCommit(hash)} />
                </div>
              ) : null}
            </section>
          </aside>
          <div className="min-h-0 min-w-0 overflow-auto bg-surface-sunken">
            <GitDiffDetail file={selectedFile} loading={patchLoadingPath === selectedFilePath} error={patchError} />
          </div>
        </div>
      )}
    </section>
  );
}

function GitScopeSelect({ label, value, options, onValueChange, disabled = false, compact = false, inline = false }: { label: string; value: string; options: Array<{ value: string; label: string }>; onValueChange: (value: string) => void; disabled?: boolean; compact?: boolean; inline?: boolean }) {
  return (
    <label className={`min-w-0 ${inline ? "flex min-w-[220px] items-center gap-2 md:min-w-[250px]" : `grid gap-1 ${compact ? "" : "min-w-[150px] md:min-w-[180px]"}`}`}>
      <span className={`font-mono text-2xs uppercase tracking-wide text-muted-foreground ${inline ? "shrink-0" : ""}`}>{label}</span>
      <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={`h-8 min-w-0 text-meta ${inline ? "flex-1" : "w-full"}`}>
          <SelectValue placeholder={`选择${label}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function GitScopeMeta({ project, worktreePath, status, compact = false }: { project?: ProjectSummary; worktreePath: string; status?: GitStatusState; compact?: boolean }) {
  if (compact) {
    return <div className="min-w-0 flex-1 px-1"><div className="flex min-w-0 items-center gap-2 font-medium text-meta"><Icon name="branch" size={14} className="shrink-0 text-muted-foreground" /><span className="truncate">{project?.name || "Git"}</span><span className="truncate font-mono text-meta text-muted-foreground">{status?.branch || project?.gitCurrentBranch || "未检测分支"}</span></div><div className="mt-0.5 flex min-w-0 items-center gap-3 truncate font-mono text-2xs text-muted-foreground" title={worktreePath}><span className="truncate">{worktreePath || "选择 Worktree"}</span>{status ? <GitStatusSummary status={status} /> : null}</div></div>;
  }
  return (
    <div className="ml-auto min-w-0 max-w-[min(42rem,100%)] shrink px-1">
      <div className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2">
        <Icon name="branch" size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 font-medium text-section">
            <span className="min-w-0 truncate">{project?.name || "Git"}</span>
            <span className="min-w-0 truncate font-mono text-meta text-muted-foreground">{status?.branch || project?.gitCurrentBranch || "未检测分支"}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-3 truncate font-mono text-2xs text-muted-foreground" title={worktreePath}>
            <span className="min-w-0 truncate">{worktreePath || "选择 Worktree"}</span>
            {status ? <GitStatusSummary status={status} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileGitPaneTabs({ activePane, hasSelectedFile, canShowHistory, onChange }: { activePane: DashboardGitMobilePane; hasSelectedFile: boolean; canShowHistory: boolean; onChange: (pane: DashboardGitMobilePane) => void }) {
  const tabs: Array<{ key: DashboardGitMobilePane; label: string; disabled?: boolean }> = [
    { key: "changes", label: "变更" },
    { key: "detail", label: "详情", disabled: !hasSelectedFile },
    { key: "history", label: "历史", disabled: !canShowHistory },
  ];
  return <div className="grid grid-cols-3 gap-0.5 rounded-md border border-border-ghost bg-surface-sunken p-0.5" role="tablist" aria-label="Git 内容视图">{tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activePane === tab.key} disabled={tab.disabled} onClick={() => onChange(tab.key)} className={`min-w-0 rounded px-2 py-1.5 text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activePane === tab.key ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:bg-surface/70 hover:text-foreground"} ${tab.disabled ? "cursor-not-allowed opacity-45" : ""}`}>{tab.label}</button>)}</div>;
}

function GitStatusSummary({ status }: { status: GitStatusState }) {
  return <span className="inline-flex shrink-0 items-center gap-1 tabular"><StatusDot tone={status.clean ? "idle" : "warning"} size={5} /><span>{status.clean ? "工作区干净" : `${status.files.length} 个变更`}</span>{status.ahead ? <span className="text-success">↑{status.ahead}</span> : null}{status.behind ? <span className="text-warning">↓{status.behind}</span> : null}</span>;
}

function GitSidebarSectionHeader({ label, open, count, onToggle, disabled = false }: { label: string; open: boolean; count?: number; onToggle: () => void; disabled?: boolean }) {
  return <button type="button" className="flex h-8 w-full shrink-0 items-center gap-1.5 px-2 text-left text-meta font-medium text-foreground transition-colors hover:bg-surface-emphasis/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50" onClick={onToggle} disabled={disabled} aria-expanded={open}><Icon name={open ? "chevronDown" : "chevronRight"} size={12} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{label}</span>{typeof count === "number" ? <span className="rounded-full bg-surface-emphasis px-1.5 font-mono text-2xs tabular-nums text-muted-foreground">{count}</span> : null}</button>;
}

function GitSidebarResizeHandle({ ratio, containerRef, onRatioChange }: { ratio: number; containerRef: { current: HTMLElement | null }; onRatioChange: (ratio: number) => void }) {
  const [isResizing, setIsResizing] = useState(false);
  const dragState = useRef<{ startY: number; startRatio: number; pointerId: number } | null>(null);

  useEffect(() => {
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const drag = dragState.current;
      const container = containerRef.current;
      if (!drag || !container || event.pointerId !== drag.pointerId) return;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const containerHeight = container.getBoundingClientRect().height;
      if (containerHeight <= 0) return;
      onRatioChange(clampGitHistoryRatio(drag.startRatio - (event.clientY - drag.startY) / containerHeight));
    };
    const stopResizing = (event: globalThis.PointerEvent) => {
      if (dragState.current?.pointerId !== event.pointerId) return;
      dragState.current = null;
      setIsResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [containerRef, onRatioChange]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { startY: event.clientY, startRatio: ratio, pointerId: event.pointerId };
    setIsResizing(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.05;
    let nextRatio: number | undefined;
    if (event.key === "ArrowUp") nextRatio = ratio + step;
    else if (event.key === "ArrowDown") nextRatio = ratio - step;
    else if (event.key === "Home") nextRatio = GIT_HISTORY_RATIO_MIN;
    else if (event.key === "End") nextRatio = GIT_HISTORY_RATIO_MAX;
    if (nextRatio === undefined) return;
    event.preventDefault();
    onRatioChange(clampGitHistoryRatio(nextRatio));
  };

  return (
    <div
      data-slot="dashboard-git-sidebar-resize-handle"
      role="separator"
      aria-label="调整变更和图表高度"
      aria-orientation="horizontal"
      aria-valuemin={GIT_HISTORY_RATIO_MIN * 100}
      aria-valuemax={GIT_HISTORY_RATIO_MAX * 100}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      className={`group relative z-10 flex h-2 shrink-0 touch-none cursor-row-resize select-none items-center justify-center border-y border-border-ghost bg-surface ${isResizing ? "bg-primary/10" : "hover:bg-surface-emphasis/70"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <span className={`h-px w-8 bg-border-ghost transition-colors ${isResizing ? "bg-primary" : "group-hover:bg-primary/60"}`} aria-hidden="true" />
    </div>
  );
}

function GitHistoryPane({ graph, onRetry, onSelectCommit }: { graph?: GitGraphState; onRetry: () => void; onSelectCommit: (hash: string) => void }) {
  if (graph?.error) return <div className="grid min-h-32 place-items-center gap-2 p-4 text-center text-meta text-muted-foreground"><span>提交历史加载失败：{graph.error}</span><Button variant="outline" size="sm" onClick={onRetry}>重试</Button></div>;
  return <GitGraphPanel gitGraph={graph} onSelectCommit={onSelectCommit} showHeader={false} />;
}

function GitFilePane({ files, selectedFilePath, collapsedDirectories, onSelectFile, onToggleDirectory, emptyReason, loading, clean, error }: { files: FileDiffSummary[]; selectedFilePath: string | null; collapsedDirectories: ReadonlySet<string>; onSelectFile: (path: string) => void; onToggleDirectory: (path: string) => void; emptyReason?: string; loading?: boolean; clean?: boolean; error?: string }) {
  if (emptyReason) return <div className="grid min-h-32 place-items-center p-4 text-center text-meta text-muted-foreground">{emptyReason}</div>;
  if (error) return <div className="grid min-h-32 place-items-center p-4 text-center text-meta text-muted-foreground">Git 不可用：{error}</div>;
  if (!files.length && !clean) return <div className="grid min-h-32 place-items-center p-4 text-center text-meta text-muted-foreground">{loading ? "正在读取 Git 状态..." : "暂无 Git 状态"}</div>;
  if (!files.length) return <div className="grid min-h-32 place-items-center p-4 text-center text-meta text-muted-foreground">工作区干净</div>;
  return <GitDiffFileList files={files} selectedPath={selectedFilePath} collapsedDirectories={collapsedDirectories} onSelectFile={onSelectFile} onToggleDirectory={onToggleDirectory} />;
}

function toggleDirectory(path: string, setCollapsedDirectories: (updater: (current: ReadonlySet<string>) => Set<string>) => void) {
  setCollapsedDirectories((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; });
}
