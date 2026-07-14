import type {
  AgentMessage,
  AgentToolCall,
  RuntimeSessionSummary,
  SessionLiveStateSnapshot,
  SessionTimelineEntry,
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
      SessionLiveStateSnapshot
    >;

export type SessionUpdateParams = {
  sessionId: string;
  update: DeckSessionRealtimeUpdate;
};

export const isCanonicalConversationUpdateKind = isDomainCanonicalConversationUpdateKind;

export const isCompatibilityConversationUpdateKind =
  isDomainCompatibilityConversationUpdateKind;
