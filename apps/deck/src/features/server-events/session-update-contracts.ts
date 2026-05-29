import type {
  AcpModelOption,
  AgentMessage,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  RuntimeSessionSummary,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
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
      SessionPromptQueueSnapshot
    >
  | { kind: "restore_replay_cached" };

export type SessionUpdateParams = {
  sessionId: string;
  update: DeckSessionRealtimeUpdate;
};
