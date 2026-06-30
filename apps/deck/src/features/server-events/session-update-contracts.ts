import type {
  AcpModelOption,
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  RuntimeSessionSummary,
  SessionLiveStateSnapshot,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionTimelineEntry,
  SessionTimelineTranscriptEventEntry,
} from "@tiller/shared";
import type { SessionRealtimeUpdate as DomainSessionRealtimeUpdate } from "@tiller/domain-contracts";

export type DeckSessionConfigState = Partial<
  Pick<RuntimeSessionSummary, "agentMode" | "model" | "reasoningEffort">
>;

export type DeckSessionRealtimeUpdate =
  | DomainSessionRealtimeUpdate<
      AgentMessage,
      AgentToolCall,
      CommandChunk,
      FileDiffSummary,
      DeckSessionConfigState,
      SessionConfigOption,
      AcpModelOption,
      AvailableCommand,
      RuntimeSessionSummary,
      SessionPromptQueueSnapshot,
      AgentPlan,
      SessionTimelineTranscriptEventEntry,
      SessionTimelineEntry,
      SessionLiveStateSnapshot
    >
  | { kind: "restore_replay_cached" };

export type SessionUpdateParams = {
  sessionId: string;
  update: DeckSessionRealtimeUpdate;
};
