import type {
  AcpModelOption,
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  RuntimeSessionSummary,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
} from "@tiller/shared";
import type {
  SessionAgentMessageUpdate as DomainSessionAgentMessageUpdate,
  SessionCommandOutputUpdate as DomainSessionCommandOutputUpdate,
  SessionCommandsAvailableUpdate as DomainSessionCommandsAvailableUpdate,
  SessionConfigOptionsUpdate as DomainSessionConfigOptionsUpdate,
  SessionDiffUpdate as DomainSessionDiffUpdate,
  SessionModelOptionsUpdate as DomainSessionModelOptionsUpdate,
  SessionPlanUpdate as DomainSessionPlanUpdate,
  SessionPromptQueueUpdate as DomainSessionPromptQueueUpdate,
  SessionRealtimeUpdate as DomainSessionRealtimeUpdate,
  SessionStatusUpdate,
  SessionToolCallUpdate as DomainSessionToolCallUpdate,
  SessionUpdatedUpdate as DomainSessionUpdatedUpdate,
  SessionUserMessageUpdate as DomainSessionUserMessageUpdate,
} from "@tiller/domain-contracts";

export type HelmSessionConfigState = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: string;
};

export type { SessionStatusUpdate };

export type SessionUserMessageUpdate = DomainSessionUserMessageUpdate<AgentMessage>;

export type SessionAgentMessageUpdate = DomainSessionAgentMessageUpdate<AgentMessage>;

export type SessionToolCallUpdate = DomainSessionToolCallUpdate<AgentToolCall>;

export type SessionPlanUpdate = DomainSessionPlanUpdate<AgentPlan>;

export type SessionCommandOutputUpdate = DomainSessionCommandOutputUpdate<CommandChunk>;

export type SessionDiffUpdate = DomainSessionDiffUpdate<FileDiffSummary>;

export type SessionConfigOptionsUpdate = DomainSessionConfigOptionsUpdate<
  HelmSessionConfigState,
  SessionConfigOption
>;

export type SessionModelOptionsUpdate = DomainSessionModelOptionsUpdate<AcpModelOption>;

export type SessionCommandsAvailableUpdate = DomainSessionCommandsAvailableUpdate<AvailableCommand>;

export type SessionUpdatedUpdate = DomainSessionUpdatedUpdate<RuntimeSessionSummary>;

export type SessionPromptQueueUpdate = DomainSessionPromptQueueUpdate<SessionPromptQueueSnapshot>;

export type SessionRealtimeUpdate = DomainSessionRealtimeUpdate<
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  HelmSessionConfigState,
  SessionConfigOption,
  AcpModelOption,
  AvailableCommand,
  RuntimeSessionSummary,
  SessionPromptQueueSnapshot,
  AgentPlan
>;
