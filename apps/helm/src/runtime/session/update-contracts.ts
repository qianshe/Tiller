import type {
  AgentMessage,
  AgentToolCall,
  RuntimeSessionSummary,
  SessionLiveStateSnapshot,
  SessionTimelineBatch,
  SessionTimelineEntry,
} from "@tiller/shared";
import {
  isCanonicalConversationUpdateKind as isDomainCanonicalConversationUpdateKind,
  isCompatibilityConversationUpdateKind as isDomainCompatibilityConversationUpdateKind,
  type SessionAgentMessageUpdate as DomainSessionAgentMessageUpdate,
  type SessionLiveStateUpdate as DomainSessionLiveStateUpdate,
  type SessionRealtimeUpdate as DomainSessionRealtimeUpdate,
  type SessionTimelineBatchUpdate as DomainSessionTimelineBatchUpdate,
  type SessionToolCallUpdate as DomainSessionToolCallUpdate,
  type SessionUpdatedUpdate as DomainSessionUpdatedUpdate,
} from "@tiller/domain-contracts";

export const isCanonicalConversationUpdateKind = isDomainCanonicalConversationUpdateKind;

export const isCompatibilityConversationUpdateKind =
  isDomainCompatibilityConversationUpdateKind;

export type SessionAgentMessageUpdate = DomainSessionAgentMessageUpdate<AgentMessage>;

export type SessionToolCallUpdate = DomainSessionToolCallUpdate<AgentToolCall>;

export type SessionUpdatedUpdate = DomainSessionUpdatedUpdate<RuntimeSessionSummary>;

export type SessionTimelineBatchUpdate = DomainSessionTimelineBatchUpdate<SessionTimelineEntry>;

export type SessionLiveStateUpdate = DomainSessionLiveStateUpdate<SessionLiveStateSnapshot>;

export type SessionRealtimeUpdate = DomainSessionRealtimeUpdate<
  AgentMessage,
  AgentToolCall,
  RuntimeSessionSummary,
  SessionTimelineEntry,
  SessionLiveStateSnapshot
>;
