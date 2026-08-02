import type { MutableRefObject } from "react";
import type {
  AcpModelOption,
  ProjectFileSummary,
  SessionConfigOption,
  SessionReasoningEffort,
  WorktreeSummary,
} from "@tiller/shared";
import type { AgentModelOptionsEntry } from "../agents/facade";
import {
  clearHelmUpdateIntent,
  isHelmVersionAtLeast,
  type DeckRpcClient,
  type DispatchToHelm,
  readHelmUpdateIntent,
  writeHelmUpdateIntent,
} from "../helm-connection/facade";
import { useDeckStore } from "../../store";
import {
  createGitStatusState,
  type GitGraphState,
  type GitStatusState,
} from "../../store/facade";

type StoreUpdater<T> = T | ((current: T) => T);
type StoreSetter<T> = (updater: StoreUpdater<T>) => void;
type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};

function pickGitSnapshot(payload: Record<string, unknown>): GitStatusState {
  return createGitStatusState(
    typeof payload.projectId === "string" ? payload.projectId : "",
    typeof payload.cwd === "string" ? payload.cwd : "",
    {
      branch: typeof payload.branch === "string" ? payload.branch : "",
      detached: Boolean(payload.detached),
      upstreamBranch: typeof payload.upstreamBranch === "string" ? payload.upstreamBranch : undefined,
      ahead: Number(payload.ahead ?? 0),
      behind: Number(payload.behind ?? 0),
      pushTarget: typeof payload.pushTarget === "string" ? payload.pushTarget : undefined,
      trackingStale: Boolean(payload.trackingStale),
      remoteRefreshError: typeof payload.remoteRefreshError === "string" ? payload.remoteRefreshError : undefined,
      clean: Boolean(payload.clean),
      files: Array.isArray(payload.files) ? payload.files as GitStatusState["files"] : [],
      lastUpdated: new Date().toISOString(),
      message: typeof payload.message === "string" ? payload.message : "",
      error: typeof payload.remoteRefreshError === "string"
        ? payload.remoteRefreshError
        : undefined,
    },
  );
}

/**
 * Merges on-demand patch bodies into the matching status files. The status
 * snapshot itself only carries stats; a later snapshot naturally drops these
 * merged patches, which is exactly the cache invalidation we want.
 */
export function applyGitFileDiffResult(
  current: Record<string, GitStatusState>,
  payload: Record<string, unknown>,
  cwd: string,
): Record<string, GitStatusState> {
  const entry = current[cwd];
  if (!entry || payload.ok !== true || !Array.isArray(payload.files)) {
    return current;
  }
  const diffs = new Map(
    (payload.files as Array<{ path?: string; patch?: string }>)
      .filter((file): file is { path: string; patch?: string } => typeof file.path === "string")
      .map((file) => [normalizeDiffFilePath(file.path), file] as const),
  );
  if (!diffs.size) {
    return current;
  }
  return {
    ...current,
    [cwd]: {
      ...entry,
      files: entry.files.map((file) => {
        const diff = diffs.get(normalizeDiffFilePath(file.path));
        return diff?.patch ? { ...file, patch: diff.patch } : file;
      }),
    },
  };
}

function normalizeDiffFilePath(path: string) {
  return path.replace(/\\/g, "/");
}

export function applyGitGraphResult(
  current: Record<string, GitGraphState>,
  payload: Record<string, unknown>,
  cwd: string,
): Record<string, GitGraphState> {
  const previous = current[cwd];
  const ok = payload.ok === true;
  const unchanged = ok && payload.unchanged === true;
  const signature = typeof payload.signature === "string" ? payload.signature : undefined;
  return {
    ...current,
    [cwd]: {
      projectId: typeof payload.projectId === "string"
        ? payload.projectId
        : previous?.projectId ?? "",
      cwd,
      head: ok && !unchanged
        ? (typeof payload.head === "string" ? payload.head : undefined)
        : previous?.head ?? (typeof payload.head === "string" ? payload.head : undefined),
      // An unchanged answer carries no commits on purpose — keep the cache.
      commits: ok && !unchanged
        ? (Array.isArray(payload.commits) ? payload.commits as GitGraphState["commits"] : [])
        : previous?.commits ?? [],
      signature: ok ? (signature ?? previous?.signature) : previous?.signature,
      commitDetails: previous?.commitDetails,
      loading: false,
      lastUpdated: new Date().toISOString(),
      message: typeof payload.message === "string" ? payload.message : undefined,
      error: ok
        ? undefined
        : typeof payload.message === "string" ? payload.message : undefined,
    },
  };
}

type GitBusyFlag = "loading" | "committing" | "discarding" | "pushing" | "pulling";

export function applyGitOperationResult(
  current: Record<string, GitStatusState>,
  payload: Record<string, unknown>,
  cwd: string,
  busyFlag: GitBusyFlag,
) {
  const previous = current[cwd];
  const snapshot = pickGitSnapshot(payload);
  if (payload.ok === true) {
    return {
      ...current,
      [cwd]: {
        ...snapshot,
        loading: false,
        [busyFlag]: false,
      },
    };
  }

  return {
    ...current,
    [cwd]: {
      ...(previous ?? snapshot),
      projectId: typeof payload.projectId === "string"
        ? payload.projectId
        : previous?.projectId ?? snapshot.projectId,
      cwd,
      message: typeof payload.message === "string"
        ? payload.message
        : previous?.message ?? "",
      error: typeof payload.message === "string"
        ? payload.message
        : previous?.error,
      loading: false,
      [busyFlag]: false,
    },
  };
}

function collectProjectWorktrees(projects: Array<{ worktrees?: WorktreeSummary[] }>) {
  const byPath = new Map<string, WorktreeSummary>();
  for (const project of projects) {
    for (const worktree of project.worktrees ?? []) {
      byPath.set(normalizeWorktreePath(worktree.path), worktree);
    }
  }
  return Array.from(byPath.values());
}

function replaceProjectWorktrees<TProject extends { id: string; worktrees?: WorktreeSummary[] }>(
  projects: TProject[],
  projectId: string,
  worktrees: WorktreeSummary[],
) {
  return projects.map((project) =>
    project.id === projectId ? { ...project, worktrees } : project,
  );
}

function mergeProjectWorktrees(
  current: WorktreeSummary[],
  projects: Array<{ id: string; path?: string; worktrees?: WorktreeSummary[] }>,
  projectId: string,
  worktrees: WorktreeSummary[],
) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return dedupeWorktrees(worktrees);
  }
  return dedupeWorktrees([
    ...current.filter((worktree) => !isProjectWorktree(project, worktree)),
    ...worktrees,
  ]);
}

function dedupeWorktrees(worktrees: WorktreeSummary[]) {
  const byPath = new Map<string, WorktreeSummary>();
  for (const worktree of worktrees) {
    byPath.set(normalizeWorktreePath(worktree.path), worktree);
  }
  return Array.from(byPath.values());
}

function isProjectWorktree(
  project: { path?: string; worktrees?: WorktreeSummary[] },
  worktree: WorktreeSummary,
) {
  const worktreePath = normalizeWorktreePath(worktree.path);
  const projectPath = normalizeWorktreePath(project.path ?? "");
  const configuredPaths = new Set(
    (project.worktrees ?? []).map((item) => normalizeWorktreePath(item.path)),
  );
  return Boolean(
    configuredPaths.has(worktreePath) ||
      (projectPath && worktreePath === projectPath) ||
      (projectPath && worktreePath.startsWith(`${projectPath}/.worktrees/`)) ||
      (projectPath && worktreePath.startsWith(`${projectPath}/.tiller/worktrees/`)),
  );
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function applyConfigStateToOptions(
  options: SessionConfigOption[],
  state: AgentModelOptionsEntry["state"],
) {
  return options.map((option) => {
    const category = option.category?.toLowerCase() ?? option.id.toLowerCase();
    let currentValue: SessionConfigOption["currentValue"] | undefined;
    if (category === "model") {
      currentValue = state.model;
    } else if (category === "mode") {
      currentValue = state.agentMode;
    } else if (
      category === "reasoning" ||
      category === "reasoning_effort" ||
      category === "thought_level"
    ) {
      currentValue = state.reasoningEffort;
    }
    return currentValue === undefined ? option : { ...option, currentValue };
  });
}

function readConfigStateFromOptions(options: SessionConfigOption[]) {
  return options.reduce<AgentModelOptionsEntry["state"]>((state, option) => {
    const category = option.category?.toLowerCase() ?? option.id.toLowerCase();
    const currentValue = option.currentValue ?? option.selectedValue ?? option.value;
    if (category === "model" && typeof currentValue === "string") {
      state.model = currentValue;
    } else if (category === "mode" && typeof currentValue === "string") {
      state.agentMode = currentValue;
    } else if (
      (category === "reasoning" ||
        category === "reasoning_effort" ||
        category === "thought_level") &&
      typeof currentValue === "string"
    ) {
      state.reasoningEffort = currentValue as SessionReasoningEffort;
    }
    return state;
  }, {});
}

function hasReasoningConfigOption(options: SessionConfigOption[]) {
  return options.some((option) => {
    const category = option.category?.toLowerCase() ?? option.id.toLowerCase();
    return category === "reasoning" ||
      category === "reasoning_effort" ||
      category === "thought_level";
  });
}

function omitReasoningState(state: AgentModelOptionsEntry["state"]) {
  const { reasoningEffort: _reasoningEffort, ...withoutReasoning } = state;
  return withoutReasoning;
}

export type InventoryServerEventContext = {
  projectFilesKey: (projectId: string, worktreeId?: string) => string;
  setProjectFilesByScope: StoreSetter<Record<string, ProjectFilesEntry>>;
  setSelectedCwd: (worktreeId: string | null) => void;
  setWorktreePickerOpen: (open: boolean) => void;
  setAgentTestResult: (message: string) => void;
  agentModelOptionsKey: (providerId: string, worktreeId: string, projectId?: string | null) => string;
  writeAgentModelOptionsCache: (
    entries: Record<string, AgentModelOptionsEntry>,
  ) => void;
  selectedAgentId: string | null;
  selectedCwd: string | null;
  resolveModelOptions: (
    currentModel?: string,
    configOptions?: SessionConfigOption[],
    nativeOptions?: AcpModelOption[],
  ) => string[];
  resolvePreferredModel: (
    currentModel: string | undefined,
    modelOptions: string[],
  ) => string | undefined;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  setSelectedAgentMode: (mode: string) => void;
  setSelectedReasoningEffort: (effort: SessionReasoningEffort) => void;
  setConfigSaveMessage: (message: string) => void;
  setFleetProjectSaveMessage: (message: string) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  helmRpcClientRefs: MutableRefObject<Map<string, DeckRpcClient>>;
  dispatch: DispatchToHelm;
};

export function applyInventoryResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: InventoryServerEventContext,
) {
  const payload = result as Record<string, any>;
  const {
    projectFilesKey,
    setProjectFilesByScope,
    setSelectedCwd,
    setWorktreePickerOpen,
    setAgentTestResult,
    agentModelOptionsKey,
    writeAgentModelOptionsCache,
    selectedAgentId,
    selectedCwd,
    resolveModelOptions,
    resolvePreferredModel,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    setConfigSaveMessage,
    setFleetProjectSaveMessage,
    setSelectedProjectId,
    rpcClientRef,
    helmRpcClientRefs,
    dispatch,
  } = context;
  const store = useDeckStore.getState();
  const refreshInventory = (methods: string[]) => {
    const refreshClient = sourceIsCurrentHelm
      ? rpcClientRef.current
      : (helmRpcClientRefs.current.get(sourceHelmKey) ?? null);
    if (refreshClient?.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    methods.forEach((refreshMethod) => {
      void dispatch(refreshClient, refreshMethod, {});
    });
  };

  switch (method) {
    case "helm/list":
      store.setHelms(payload.helms);
      return true;
    case "project/list": {
      const projectWorktrees = collectProjectWorktrees(payload.projects ?? []);
      store.applyHelmInventory(sourceHelmKey, {
        projects: payload.projects,
        worktrees: projectWorktrees,
      });
      if (sourceIsCurrentHelm) {
        store.setProjects(payload.projects);
        store.setWorktrees(projectWorktrees);
      }
      return true;
    }
    case "project/list_files": {
      const key = projectFilesKey(payload.projectId, payload.cwd);
      setProjectFilesByScope((current) => ({
        ...current,
        [key]: {
          loading: false,
          files: payload.files,
          message: payload.message,
        },
      }));
      return true;
    }
    case "project/list_worktrees": {
      const nextProjectWorktrees = payload.worktrees ?? [];
      const currentState = useDeckStore.getState();
      const currentHelmProjects = currentState.projects;
      const nextCurrentHelmProjects = replaceProjectWorktrees(
        currentHelmProjects,
        payload.projectId,
        nextProjectWorktrees,
      );
      const inventory = currentState.helmInventories[sourceHelmKey];
      const inventoryProjects = sourceIsCurrentHelm
        ? nextCurrentHelmProjects
        : replaceProjectWorktrees(
            inventory?.projects ?? [],
            payload.projectId,
            nextProjectWorktrees,
          );
      const inventoryWorktrees = mergeProjectWorktrees(
        inventory?.worktrees ?? currentState.worktrees,
        inventoryProjects,
        payload.projectId,
        nextProjectWorktrees,
      );
      store.applyHelmInventory(sourceHelmKey, {
        projects: inventoryProjects,
        worktrees: inventoryWorktrees,
      });
      if (sourceIsCurrentHelm) {
        store.setProjects(nextCurrentHelmProjects);
        store.setWorktrees((current) =>
          mergeProjectWorktrees(
            current,
            nextCurrentHelmProjects,
            payload.projectId,
            nextProjectWorktrees,
          ),
        );
      }
      return true;
    }
    case "project/git/list_branches":
    case "project/git/create_worktree":
      store.setWorktreeGitByProject((current) => {
        const previous = current[payload.projectId];
        return {
          ...current,
          [payload.projectId]: {
            branches: payload.ok ? payload.branches : (previous?.branches ?? payload.branches),
            currentBranch: payload.ok ? payload.currentBranch : previous?.currentBranch,
            message: payload.message,
            error: payload.ok ? undefined : payload.message,
            loading: false,
          },
        };
      });
      if (sourceIsCurrentHelm && payload.worktrees.length) {
        const nextCurrentHelmProjects = replaceProjectWorktrees(
          useDeckStore.getState().projects,
          payload.projectId,
          payload.worktrees,
        );
        store.setProjects(nextCurrentHelmProjects);
        store.setWorktrees((current) =>
          mergeProjectWorktrees(
            current,
            nextCurrentHelmProjects,
            payload.projectId,
            payload.worktrees,
          ),
        );
      }
      if (payload.selectedCwd) {
        setSelectedCwd(payload.selectedCwd);
        setWorktreePickerOpen(false);
      }
      return true;
    case "project/git/status": {
      if (payload.cwd) {
        store.setGitStatusByWorktree((current) =>
          applyGitOperationResult(current, payload, payload.cwd, "loading"),
        );
      }
      return true;
    }
    case "project/git/graph":
      if (payload.cwd) {
        store.setGitGraphByWorktree((current) =>
          applyGitGraphResult(current, payload, payload.cwd),
        );
      }
      return true;
    case "project/git/file_diff":
      if (payload.cwd) {
        store.setGitStatusByWorktree((current) =>
          applyGitFileDiffResult(current, payload, payload.cwd),
        );
      }
      return true;
    case "project/git/commit_detail":
      if (payload.cwd) {
        store.setGitGraphByWorktree((current) => {
          const graph: GitGraphState = current[payload.cwd] ?? {
            projectId: payload.projectId,
            cwd: payload.cwd,
            commits: [],
          };
          const previousDetail = graph.commitDetails?.[payload.commitHash];
          return {
            ...current,
            [payload.cwd]: {
              ...graph,
              commitDetails: {
                ...graph.commitDetails,
                [payload.commitHash]: {
                  commitHash: payload.commitHash,
                  files: payload.ok ? payload.files : (previousDetail?.files ?? []),
                  loading: false,
                  message: payload.message,
                  error: payload.ok ? undefined : payload.message,
                },
              },
            },
          };
        });
      }
      return true;
    case "project/git/commit": {
      if (payload.cwd) {
        store.setGitStatusByWorktree((current) =>
          applyGitOperationResult(current, payload, payload.cwd, "committing"),
        );
      }
      return true;
    }
    case "project/git/discard": {
      if (payload.cwd) {
        store.setGitStatusByWorktree((current) =>
          applyGitOperationResult(current, payload, payload.cwd, "discarding"),
        );
      }
      return true;
    }
    case "project/git/push": {
      if (payload.cwd) {
        store.setGitStatusByWorktree((current) =>
          applyGitOperationResult(current, payload, payload.cwd, "pushing"),
        );
      }
      return true;
    }
    case "project/git/pull": {
      if (payload.cwd) {
        store.setGitStatusByWorktree((current) =>
          applyGitOperationResult(current, payload, payload.cwd, "pulling"),
        );
      }
      return true;
    }
    case "agent/list":
      store.applyHelmInventory(sourceHelmKey, { agents: payload.agents });
      if (sourceIsCurrentHelm) {
        store.setAgents(payload.agents);
      }
      return true;
    case "agent/connections":
      if (sourceIsCurrentHelm) {
        store.setAgentConnectionInventory(payload.connections ?? []);
      }
      return true;
    case "logging/get":
    case "logging/save":
      if (payload.logging) {
        store.applyHelmInventory(sourceHelmKey, { logging: payload.logging });
      }
      return true;
    case "daemon/update/check":
      {
        const previous = store.helmInventories[sourceHelmKey]?.update;
        const pendingTarget = readHelmUpdateIntent(sourceHelmKey)?.targetVersion;
        const targetVersion = previous?.status === "restarting"
          ? previous.targetVersion ?? pendingTarget
          : pendingTarget;
        const targetConfirmed = Boolean(
          targetVersion &&
          typeof payload.currentVersion === "string" &&
          isHelmVersionAtLeast(payload.currentVersion, targetVersion),
        );
        const status = targetVersion
          ? "restarting"
          : payload.checkStatus === "unsupported"
            ? "unsupported"
            : payload.checkStatus === "failed"
              ? "failed"
              : payload.updateAvailable
                ? "available"
                : "up-to-date";
        store.applyHelmInventory(sourceHelmKey, {
          update: {
            ...previous,
            status,
            currentVersion: payload.currentVersion,
            latestVersion: payload.latestVersion,
            updateAvailable: Boolean(payload.updateAvailable),
            canUpdate: Boolean(payload.canUpdate),
            checkStatus: payload.checkStatus,
            cannotUpdateReason: payload.cannotUpdateReason,
            manualCommand: payload.manualCommand,
            checkedAt: payload.checkedAt,
            ...(targetVersion ? { targetVersion } : {}),
            ...(targetConfirmed ? { message: "已连接新 Helm，正在确认版本。" } : {}),
          },
        });
        if (targetVersion && !targetConfirmed) {
          writeHelmUpdateIntent(sourceHelmKey, targetVersion);
        } else if (targetConfirmed) {
          clearHelmUpdateIntent(sourceHelmKey);
        }
      }
      return true;
    case "daemon/update/start":
      {
        const previous = store.helmInventories[sourceHelmKey]?.update;
        const restarting = payload.status === "restarting";
        const targetVersion = restarting
          ? payload.latestVersion ?? readHelmUpdateIntent(sourceHelmKey)?.targetVersion
          : undefined;
        store.applyHelmInventory(sourceHelmKey, {
          update: {
            ...previous,
            status: restarting ? "restarting" : "up-to-date",
            currentVersion: payload.currentVersion,
            latestVersion: payload.latestVersion,
            targetVersion,
            updateAvailable: false,
            canUpdate: true,
            checkStatus: "checked",
            manualCommand: previous?.manualCommand ?? "npm install -g @qianshe/tiller@latest",
            message: payload.message,
          },
        });
        if (targetVersion) {
          writeHelmUpdateIntent(sourceHelmKey, targetVersion);
        } else {
          clearHelmUpdateIntent(sourceHelmKey);
        }
      }
      return true;
    case "agent/connect":
    case "agent/reconnect":
      if (sourceIsCurrentHelm) {
        store.setAgentConnectionInventory(payload.connections ?? []);
        if (payload.providerId && payload.cwd) {
          const baseKey = agentModelOptionsKey(payload.providerId, payload.cwd);
          const currentEntries = store.agentModelOptions;
          const loadingEntry = Object.entries(currentEntries).find(
            ([k, entry]) => k.startsWith(baseKey) && entry.loading,
          );
          const loadingProjectId = loadingEntry?.[1]?.projectId;
          const key = agentModelOptionsKey(payload.providerId, payload.cwd, loadingProjectId);
          const previous = currentEntries[key] ?? loadingEntry?.[1];
          store.setAgentModelOptions((current) => ({
            ...current,
            [key]: {
              loading: false,
              warmed: Boolean(payload.ok),
              projectId: loadingProjectId,
              modelOptions: previous?.modelOptions ?? [],
              configOptions: previous?.configOptions ?? [],
              state: previous?.state ?? {},
              message: payload.message ?? (payload.ok ? "ACP 已连接" : "ACP 连接失败"),
            },
          }));
        }
      }
      return true;
    case "agent/test":
      setAgentTestResult(payload.message);
      return true;
    case "session/draft": {
      // Reconstruct the cache key including projectId. Prefer the loading entry,
      // because draft creation is tied to the currently selected agent scope.
      const worktreeScope = payload.cwd;
      const baseKey = agentModelOptionsKey(payload.providerId, worktreeScope);
      const currentEntries = store.agentModelOptions;
      const matchingEntries = Object.entries(currentEntries).filter(([key]) =>
        key.startsWith(baseKey),
      );
      const loadingEntry = matchingEntries.find(([, entry]) => entry.loading);
      const existingEntry = loadingEntry ?? matchingEntries.find(([, entry]) => entry.projectId);
      const existingProjectId = existingEntry?.[1]?.projectId;
      const key = agentModelOptionsKey(payload.providerId, worktreeScope, existingProjectId);
      const previous = currentEntries[key] ?? existingEntry?.[1];
      const payloadModelOptions = Array.isArray(payload.modelOptions) ? payload.modelOptions : [];
      const payloadConfigOptions = Array.isArray(payload.configOptions) ? payload.configOptions : [];
      const nextModelOptions = payloadModelOptions.length
        ? payloadModelOptions
        : (previous?.modelOptions ?? []);
      const nextConfigOptions = payloadConfigOptions.length
        ? payloadConfigOptions
        : (previous?.configOptions ?? []);
      const nextState = {
        ...(previous?.state ?? {}),
        ...(payload.state ?? {}),
      };
      const nextEntry = {
        loading: false,
        warmed: Boolean(payload.ok) || Boolean(previous?.warmed),
        projectId: existingProjectId ?? payload.projectId,
        draftId: payload.draftId ?? previous?.draftId,
        deckClientId: payload.deckClientId ?? previous?.deckClientId,
        scopeKey: payload.scopeKey ?? previous?.scopeKey,
        logicalScopeKey: payload.logicalScopeKey ?? previous?.logicalScopeKey,
        runtimeSessionId: payload.runtimeSessionId ?? previous?.runtimeSessionId,
        message: payload.message ?? previous?.message,
        modelOptions: nextModelOptions,
        configOptions: nextConfigOptions,
        state: nextState,
      };
      store.setAgentModelOptions((current) => {
        const next = { ...current, [key]: nextEntry };
        // If the loading sentinel lived under a different key variant, clean it up.
        if (existingEntry && existingEntry[0] !== key) {
          delete next[existingEntry[0]];
        }
        writeAgentModelOptionsCache(next);
        return next;
      });
      if (payload.providerId && Array.isArray(payload.availableCommands)) {
        store.setAgentAvailableCommands((current) => ({
          ...current,
          [payload.providerId]: payload.availableCommands,
        }));
      }
      const selectedWorktreePath = selectedCwd;
      if (
        sourceIsCurrentHelm &&
        payload.providerId === selectedAgentId &&
        payload.cwd === selectedWorktreePath
      ) {
        const realOptions = resolveModelOptions(
          payload.currentModelId ?? nextState.model,
          nextConfigOptions,
          nextModelOptions,
        );
        const allOptions = Array.from(
          new Set([
            ...realOptions,
            ...nextModelOptions.map((option: AcpModelOption) => option.id),
          ]),
        );
        const nextModel = resolvePreferredModel(
          payload.currentModelId ?? nextState.model,
          allOptions,
        );
        if (
          nextModel &&
          (!selectedModel ||
            selectedModel === "provider-default" ||
            !allOptions.includes(selectedModel))
        ) {
          setSelectedModel(nextModel);
        }
        if (nextState.agentMode) {
          setSelectedAgentMode(nextState.agentMode);
        }
        if (nextState.reasoningEffort) {
          setSelectedReasoningEffort(nextState.reasoningEffort);
        }
      }
      return true;
    }
    case "session/configure": {
      if (!payload.draftId) {
        return false;
      }
      let nextState = payload.state;
      store.setAgentModelOptions((current) => {
        const entry = Object.entries(current).find(
          ([, value]) => value.draftId === payload.draftId,
        );
        if (!entry) {
          return current;
        }
        const [key, previous] = entry;
        const payloadState = payload.state ?? {};
        const hasPayloadOptions = Array.isArray(payload.options);
        const rawConfigOptions = hasPayloadOptions
          ? payload.options as SessionConfigOption[]
          : previous.configOptions;
        nextState = {
          ...previous.state,
          ...(hasPayloadOptions ? readConfigStateFromOptions(rawConfigOptions) : {}),
          ...payloadState,
        };
        if (hasPayloadOptions && !hasReasoningConfigOption(rawConfigOptions)) {
          nextState = omitReasoningState(nextState);
        }
        const nextConfigOptions = hasPayloadOptions
          ? rawConfigOptions
          : applyConfigStateToOptions(previous.configOptions, nextState);
        const next = {
          ...current,
          [key]: {
            ...previous,
            configOptions: nextConfigOptions,
            state: nextState,
          },
        };
        writeAgentModelOptionsCache(next);
        return next;
      });
      if (sourceIsCurrentHelm && nextState && typeof nextState === "object") {
        if (nextState.model) {
          setSelectedModel(nextState.model);
        }
        if (nextState.agentMode) {
          setSelectedAgentMode(nextState.agentMode);
        }
        if (nextState.reasoningEffort) {
          setSelectedReasoningEffort(nextState.reasoningEffort);
        }
      }
      return true;
    }
    case "project/save":
      setConfigSaveMessage(payload.message);
      setFleetProjectSaveMessage(payload.message);
      if (sourceIsCurrentHelm) {
        setSelectedProjectId(payload.projectId);
      }
      refreshInventory(["project/list"]);
      return true;
    case "project/delete": {
      setConfigSaveMessage(payload.message);
      setFleetProjectSaveMessage(payload.message);
      if (sourceIsCurrentHelm) {
        setSelectedProjectId(null);
      }
      refreshInventory(["project/list"]);
      return true;
    }
    case "agent/save":
    case "agent/delete": {
      setConfigSaveMessage(payload.message);
      refreshInventory(["agent/list", "project/list"]);
      return true;
    }
    case "helm/save":
      setConfigSaveMessage(payload.message);
      return true;
    default:
      return false;
  }
}
