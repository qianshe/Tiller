import type {
  AcpAgentProvider,
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";
import type { StateCreator } from "zustand";


export type AgentConnectionInventoryItem = {
  providerId: string;
  workspaceId: string;
  workspacePath: string;
  launchCwd: string;
  runtimeConnectionId: string;
  initialized: boolean;
  status: "opening" | "ready" | "closed" | "error";
  lastError?: string;
  activeSessionCount: number;
  pendingSessionCount: number;
  sessions: Array<{
    tillerSessionId: string;
    runtimeSessionId: string;
    refCount: number;
    status: string;
    model?: string;
  }>;
};

export type AgentModelOptionsEntry = {
  loading?: boolean;
  warmed?: boolean;
  message?: string;
  /** projectId used when probing, echoed back for cache-key reconstruction. */
  projectId?: string | null;
  runtimeSessionId?: string;
  modelOptions: AcpModelOption[];
  configOptions: SessionConfigOption[];
  state: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
};

export type AgentsUpdater =
  | AcpAgentProvider[]
  | ((current: AcpAgentProvider[]) => AcpAgentProvider[]);

export type AgentModelOptionsUpdater =
  | Record<string, AgentModelOptionsEntry>
  | ((
      current: Record<string, AgentModelOptionsEntry>,
    ) => Record<string, AgentModelOptionsEntry>);

export type AgentConnectionInventoryUpdater =
  | AgentConnectionInventoryItem[]
  | ((current: AgentConnectionInventoryItem[]) => AgentConnectionInventoryItem[]);

export type AgentsSlice = {
  agents: AcpAgentProvider[];
  agentModelOptions: Record<string, AgentModelOptionsEntry>;
  agentConnectionInventory: AgentConnectionInventoryItem[];
  setAgents: (updater: AgentsUpdater) => void;
  setAgentModelOptions: (updater: AgentModelOptionsUpdater) => void;
  setAgentConnectionInventory: (updater: AgentConnectionInventoryUpdater) => void;
};

export const createAgentsSlice: StateCreator<AgentsSlice> = (set) => ({
  agents: [],
  agentModelOptions: {},
  agentConnectionInventory: [],
  setAgents: (updater) =>
    set((state) => ({
      agents: typeof updater === "function" ? updater(state.agents) : updater,
    })),
  setAgentModelOptions: (updater) =>
    set((state) => ({
      agentModelOptions:
        typeof updater === "function" ? updater(state.agentModelOptions) : updater,
    })),
  setAgentConnectionInventory: (updater) =>
    set((state) => ({
      agentConnectionInventory:
        typeof updater === "function" ? updater(state.agentConnectionInventory) : updater,
    })),
});
