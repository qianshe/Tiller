import type { MutableRefObject } from "react";
import type {
  AcpModelOption,
  ProjectFileSummary,
  SessionConfigOption,
  SessionReasoningEffort,
  WorkspaceSummary,
} from "@tiller/shared";
import type { AgentModelOptionsEntry } from "../agents/facade";
import type { DeckRpcClient, DispatchToHelm } from "../helm-connection/facade";
import { useDeckStore } from "../../store";

type StoreUpdater<T> = T | ((current: T) => T);
type StoreSetter<T> = (updater: StoreUpdater<T>) => void;
type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};

export type InventoryServerEventContext = {
  projectFilesKey: (projectId: string, workspaceId?: string) => string;
  setProjectFilesByScope: StoreSetter<Record<string, ProjectFilesEntry>>;
  setSelectedWorkspaceId: (workspaceId: string | null) => void;
  setWorktreePickerOpen: (open: boolean) => void;
  setAgentTestResult: (message: string) => void;
  agentModelOptionsKey: (providerId: string, workspaceId: string, projectId?: string | null) => string;
  writeAgentModelOptionsCache: (
    entries: Record<string, AgentModelOptionsEntry>,
  ) => void;
  selectedAgentId: string | null;
  selectedWorkspaceId: string | null;
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
    setSelectedWorkspaceId,
    setWorktreePickerOpen,
    setAgentTestResult,
    agentModelOptionsKey,
    writeAgentModelOptionsCache,
    selectedAgentId,
    selectedWorkspaceId,
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
    case "project/list":
      store.applyHelmInventory(sourceHelmKey, { projects: payload.projects });
      if (sourceIsCurrentHelm) {
        store.setProjects(payload.projects);
      }
      return true;
    case "project/list_files": {
      const key = projectFilesKey(payload.projectId, payload.workspaceId);
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
    case "workspace/list":
      store.applyHelmInventory(sourceHelmKey, { workspaces: payload.workspaces });
      if (sourceIsCurrentHelm) {
        store.setWorkspaces(payload.workspaces);
      }
      return true;
    case "workspace/git/list_branches":
    case "workspace/git/create_branch":
      store.setWorktreeGitByProject((current) => ({
        ...current,
        [payload.projectId]: {
          branches: payload.branches,
          currentBranch: payload.currentBranch,
          message: payload.message,
          loading: false,
        },
      }));
      if (sourceIsCurrentHelm && payload.workspaces.length) {
        store.setWorkspaces((current) => {
          const nextById = new Map(
            current.map((workspace) => [workspace.id, workspace]),
          );
          payload.workspaces.forEach((workspace: WorkspaceSummary) =>
            nextById.set(workspace.id, workspace),
          );
          return Array.from(nextById.values());
        });
      }
      if (payload.selectedWorkspaceId) {
        setSelectedWorkspaceId(payload.selectedWorkspaceId);
        setWorktreePickerOpen(false);
      }
      return true;
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
    case "agent/connect":
    case "agent/reconnect":
      if (sourceIsCurrentHelm) {
        store.setAgentConnectionInventory(payload.connections ?? []);
        if (payload.providerId && payload.workspaceId) {
          const baseKey = agentModelOptionsKey(payload.providerId, payload.workspaceId);
          const currentEntries = store.agentModelOptions;
          const loadingEntry = Object.entries(currentEntries).find(
            ([k, entry]) => k.startsWith(baseKey) && entry.loading,
          );
          const loadingProjectId = loadingEntry?.[1]?.projectId;
          const key = agentModelOptionsKey(payload.providerId, payload.workspaceId, loadingProjectId);
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
      const workspaceScope = payload.workspacePath;
      const baseKey = agentModelOptionsKey(payload.providerId, workspaceScope);
      const currentEntries = store.agentModelOptions;
      const matchingEntries = Object.entries(currentEntries).filter(([key]) =>
        key.startsWith(baseKey),
      );
      const loadingEntry = matchingEntries.find(([, entry]) => entry.loading);
      const existingEntry = loadingEntry ?? matchingEntries.find(([, entry]) => entry.projectId);
      const existingProjectId = existingEntry?.[1]?.projectId;
      const key = agentModelOptionsKey(payload.providerId, workspaceScope, existingProjectId);
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
      const selectedWorkspacePath =
        store.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.path ??
        selectedWorkspaceId;
      if (
        sourceIsCurrentHelm &&
        payload.providerId === selectedAgentId &&
        payload.workspacePath === selectedWorkspacePath
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
    case "project/save":
      setConfigSaveMessage(payload.message);
      setFleetProjectSaveMessage(payload.message);
      if (sourceIsCurrentHelm) {
        setSelectedProjectId(payload.projectId);
      }
      refreshInventory(["project/list", "workspace/list"]);
      return true;
    case "project/delete": {
      setConfigSaveMessage(payload.message);
      setFleetProjectSaveMessage(payload.message);
      if (sourceIsCurrentHelm) {
        setSelectedProjectId(null);
      }
      refreshInventory(["project/list", "workspace/list"]);
      return true;
    }
    case "agent/save":
    case "agent/delete": {
      setConfigSaveMessage(payload.message);
      refreshInventory(["agent/list", "project/list"]);
      return true;
    }
    case "helm/save":
    case "workspace/save":
      setConfigSaveMessage(payload.message);
      return true;
    default:
      return false;
  }
}
