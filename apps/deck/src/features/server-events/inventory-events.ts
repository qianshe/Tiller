import type { MutableRefObject } from "react";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import type {
  AcpModelOption,
  ProjectFileSummary,
  SessionConfigOption,
  SessionReasoningEffort,
  WorkspaceSummary,
} from "@tiller/shared";
import type { AgentModelOptionsEntry } from "../agents/facade";
import { useDeckStore } from "../../store";

type StoreUpdater<T> = T | ((current: T) => T);
type StoreSetter<T> = (updater: StoreUpdater<T>) => void;
type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};

type InventoryServerEventContext = {
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
  socketRef: MutableRefObject<WebSocket | null>;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  dispatch: (socket: WebSocket, payload: ClientToHelm) => void;
  nextRequestId: (counter: MutableRefObject<number>) => string;
  requestCounter: MutableRefObject<number>;
};

export function handleInventoryServerEvent(
  payload: HelmToClient,
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: InventoryServerEventContext,
) {
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
    socketRef,
    helmSocketRefs,
    dispatch,
    nextRequestId,
    requestCounter,
  } = context;
  const store = useDeckStore.getState();

  switch (payload.type) {
    case "helm.list.result":
      store.setHelms(payload.helms);
      return true;
    case "project.list.result":
      store.applyHelmInventory(sourceHelmKey, { projects: payload.projects });
      if (sourceIsCurrentHelm) {
        store.setProjects(payload.projects);
      }
      return true;
    case "project.files.result": {
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
    case "workspace.list.result":
      store.applyHelmInventory(sourceHelmKey, { workspaces: payload.workspaces });
      if (sourceIsCurrentHelm) {
        store.setWorkspaces(payload.workspaces);
      }
      return true;
    case "workspace.git.result":
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
          payload.workspaces.forEach((workspace) =>
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
    case "agent.list.result":
      store.applyHelmInventory(sourceHelmKey, { agents: payload.agents });
      if (sourceIsCurrentHelm) {
        store.setAgents(payload.agents);
      }
      return true;
    case "agent.test.result":
      setAgentTestResult(payload.message);
      return true;
    case "agent.model.options.result": {
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
            ...payload.modelOptions.map((option) => option.id),
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
    case "project.save.result":
      setConfigSaveMessage(payload.message);
      setFleetProjectSaveMessage(payload.message);
      if (sourceIsCurrentHelm) {
        setSelectedProjectId(payload.projectId);
      }
      return true;
    case "agent.save.result": {
      setConfigSaveMessage(payload.message);
      const refreshSocket = sourceIsCurrentHelm
        ? socketRef.current
        : (helmSocketRefs.current.get(sourceHelmKey) ?? null);
      if (refreshSocket?.readyState === WebSocket.OPEN) {
        dispatch(refreshSocket, {
          type: "agent.list",
          requestId: nextRequestId(requestCounter),
        });
        dispatch(refreshSocket, {
          type: "project.list",
          requestId: nextRequestId(requestCounter),
        });
      }
      return true;
    }
    default:
      return false;
  }
}
