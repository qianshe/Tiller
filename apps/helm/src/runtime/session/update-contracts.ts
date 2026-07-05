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
  SessionLiveStateSnapshot,
  SessionPromptQueueSnapshot,
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionTimelineTranscriptEventEntry,
} from "@tiller/shared";
import {
  isCanonicalConversationUpdateKind as isDomainCanonicalConversationUpdateKind,
  isCompatibilityConversationUpdateKind as isDomainCompatibilityConversationUpdateKind,
  type SessionAgentMessageUpdate as DomainSessionAgentMessageUpdate,
  type SessionCommandOutputUpdate as DomainSessionCommandOutputUpdate,
  type SessionCommandsAvailableUpdate as DomainSessionCommandsAvailableUpdate,
  type SessionConfigOptionsUpdate as DomainSessionConfigOptionsUpdate,
  type SessionDiffUpdate as DomainSessionDiffUpdate,
  type SessionLiveStateUpdate as DomainSessionLiveStateUpdate,
  type SessionModelOptionsUpdate as DomainSessionModelOptionsUpdate,
  type SessionPlanUpdate as DomainSessionPlanUpdate,
  type SessionPromptQueueUpdate as DomainSessionPromptQueueUpdate,
  type SessionRealtimeUpdate as DomainSessionRealtimeUpdate,
  type SessionStatusUpdate,
  type SessionTimelineBatchUpdate as DomainSessionTimelineBatchUpdate,
  type SessionTranscriptEventUpdate as DomainSessionTranscriptEventUpdate,
  type SessionToolCallUpdate as DomainSessionToolCallUpdate,
  type SessionUpdatedUpdate as DomainSessionUpdatedUpdate,
  type SessionUserMessageUpdate as DomainSessionUserMessageUpdate,
} from "@tiller/domain-contracts";

export type HelmSessionConfigState = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: string;
};

export type { SessionStatusUpdate };

export const isCanonicalConversationUpdateKind = isDomainCanonicalConversationUpdateKind;

export const isCompatibilityConversationUpdateKind =
  isDomainCompatibilityConversationUpdateKind;

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

export type SessionTranscriptEventUpdate = DomainSessionTranscriptEventUpdate<
  SessionTimelineTranscriptEventEntry
>;

export type SessionTimelineBatchUpdate = DomainSessionTimelineBatchUpdate<SessionTimelineEntry>;

export type SessionLiveStateUpdate = DomainSessionLiveStateUpdate<SessionLiveStateSnapshot>;

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
  AgentPlan,
  SessionTimelineTranscriptEventEntry,
  SessionTimelineEntry,
  SessionLiveStateSnapshot
>;
