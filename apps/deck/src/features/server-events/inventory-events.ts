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
  agentModelOptionsKey: (providerId: string, workspaceId: string) => string;
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
    case "agent/test":
      setAgentTestResult(payload.message);
      return true;
    case "agent/get_model_options": {
      const key = agentModelOptionsKey(payload.providerId, payload.workspaceId);
      const nextEntry = {
        loading: false,
        message: payload.message,
        modelOptions: payload.modelOptions,
        configOptions: payload.configOptions,
        state: payload.state,
      };
      store.setAgentModelOptions((current) => {
        const next = { ...current, [key]: nextEntry };
        writeAgentModelOptionsCache(next);
        return next;
      });
      if (
        sourceIsCurrentHelm &&
        payload.providerId === selectedAgentId &&
        payload.workspaceId === selectedWorkspaceId
      ) {
        const realOptions = resolveModelOptions(
          payload.currentModelId ?? payload.state.model,
          payload.configOptions,
          payload.modelOptions,
        );
        const allOptions = Array.from(
          new Set([
            ...realOptions,
            ...payload.modelOptions.map((option: AcpModelOption) => option.id),
          ]),
        );
        const nextModel = resolvePreferredModel(
          payload.currentModelId ?? payload.state.model,
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
        if (payload.state.agentMode) {
          setSelectedAgentMode(payload.state.agentMode);
        }
        if (payload.state.reasoningEffort) {
          setSelectedReasoningEffort(payload.state.reasoningEffort);
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
      return true;
    case "agent/save": {
      setConfigSaveMessage(payload.message);
      const refreshClient = sourceIsCurrentHelm
        ? rpcClientRef.current
        : (helmRpcClientRefs.current.get(sourceHelmKey) ?? null);
      if (refreshClient?.socket.readyState === WebSocket.OPEN) {
        void dispatch(refreshClient, "agent/list", {});
        void dispatch(refreshClient, "project/list", {});
      }
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
