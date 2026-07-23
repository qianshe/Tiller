import type {
  AgentMessage,
  AgentToolCall,
  RuntimeSessionSummary,
  SessionLiveStateSnapshot,
  SessionTimelineEntry,
  SessionSubagentDetailDelta,
} from "@tiller/shared";
import {
  isCanonicalConversationUpdateKind as isDomainCanonicalConversationUpdateKind,
  isCompatibilityConversationUpdateKind as isDomainCompatibilityConversationUpdateKind,
  type SessionRealtimeUpdate as DomainSessionRealtimeUpdate,
} from "@tiller/domain-contracts";

export type DeckSessionRealtimeUpdate =
  | DomainSessionRealtimeUpdate<
      AgentMessage,
      AgentToolCall,
      RuntimeSessionSummary,
      SessionTimelineEntry,
      SessionLiveStateSnapshot,
      SessionSubagentDetailDelta
    >;

export type SessionUpdateParams = {
  sessionId: string;
  update: DeckSessionRealtimeUpdate;
};

export const isCanonicalConversationUpdateKind = isDomainCanonicalConversationUpdateKind;

export const isCompatibilityConversationUpdateKind =
  isDomainCompatibilityConversationUpdateKind;
