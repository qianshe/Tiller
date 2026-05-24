import type {
  AcpModelOption,
  AgentMessage,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionSummary,
} from "@tiller/shared";
import type { SessionRealtimeUpdate as DomainSessionRealtimeUpdate } from "@tiller/domain-contracts";

export type DeckSessionConfigState = Partial<
  Pick<SessionSummary, "agentMode" | "model" | "reasoningEffort">
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
      SessionSummary,
      SessionPromptQueueSnapshot
    >
  | { kind: "restore_replay_cached" };

export type SessionUpdateParams = {
  sessionId: string;
  update: DeckSessionRealtimeUpdate;
};
