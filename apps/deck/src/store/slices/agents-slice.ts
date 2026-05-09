import type {
  AcpAgentProvider,
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";
import type { StateCreator } from "zustand";

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

export type AgentsSlice = {
  agents: AcpAgentProvider[];
  agentModelOptions: Record<string, AgentModelOptionsEntry>;
  setAgents: (updater: AgentsUpdater) => void;
  setAgentModelOptions: (updater: AgentModelOptionsUpdater) => void;
};

export const createAgentsSlice: StateCreator<AgentsSlice> = (set) => ({
  agents: [],
  agentModelOptions: {},
  setAgents: (updater) =>
    set((state) => ({
      agents: typeof updater === "function" ? updater(state.agents) : updater,
    })),
  setAgentModelOptions: (updater) =>
    set((state) => ({
      agentModelOptions:
        typeof updater === "function" ? updater(state.agentModelOptions) : updater,
    })),
});
