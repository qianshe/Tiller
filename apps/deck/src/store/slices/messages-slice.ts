import type {
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  LegacyEvidenceAvailability,
  LegacyEvidencePage,
  LegacyEvidenceSource,
  SessionTimelineEntry,
} from "@tiller/shared";
import type { StateCreator } from "zustand";

export type MessageHistoryState = Record<
  string,
  {
    nextCursor?: string;
    hasMore: boolean;
    loading: boolean;
  }
>;

type Updater<T> = T | ((current: T) => T);

export type SessionTimelineDeliveryState = {
  latestDeliverySequence: number;
  reloadRequired: boolean;
};

export type SessionLegacyEvidenceState = {
  availability?: LegacyEvidenceAvailability;
  pages: Partial<Record<LegacyEvidenceSource, LegacyEvidencePage>>;
  loading: Partial<Record<LegacyEvidenceSource, boolean>>;
};

export type MessagesSlice = {
  messages: Record<string, AgentMessage[]>;
  sessionTimeline: Record<string, SessionTimelineEntry[]>;
  sessionTimelineDeliveryState: Record<string, SessionTimelineDeliveryState | undefined>;
  sessionLegacyEvidence: Record<string, SessionLegacyEvidenceState | undefined>;
  messageHistoryState: MessageHistoryState;
  outputs: Record<string, CommandChunk[]>;
  toolCalls: Record<string, AgentToolCall[]>;
  sessionPlans: Record<string, AgentPlan>;
  dismissedCompletedSessionPlanKeys: Record<string, string>;
  diffs: Record<string, FileDiffSummary[]>;
  historicalDiffIncompleteBySession: Record<string, boolean>;
  setMessages: (updater: Updater<Record<string, AgentMessage[]>>) => void;
  setSessionTimeline: (updater: Updater<Record<string, SessionTimelineEntry[]>>) => void;
  setSessionTimelineDeliveryState: (
    updater: Updater<Record<string, SessionTimelineDeliveryState | undefined>>,
  ) => void;
  setSessionLegacyEvidence: (
    updater: Updater<Record<string, SessionLegacyEvidenceState | undefined>>,
  ) => void;
  setMessageHistoryState: (updater: Updater<MessageHistoryState>) => void;
  setOutputs: (updater: Updater<Record<string, CommandChunk[]>>) => void;
  setToolCalls: (updater: Updater<Record<string, AgentToolCall[]>>) => void;
  setSessionPlans: (updater: Updater<Record<string, AgentPlan>>) => void;
  setDismissedCompletedSessionPlanKeys: (
    updater: Updater<Record<string, string>>,
  ) => void;
  setDiffs: (updater: Updater<Record<string, FileDiffSummary[]>>) => void;
  setHistoricalDiffIncompleteBySession: (
    updater: Updater<Record<string, boolean>>,
  ) => void;
};

export const createMessagesSlice: StateCreator<MessagesSlice> = (set) => ({
  messages: {},
  sessionTimeline: {},
  sessionTimelineDeliveryState: {},
  sessionLegacyEvidence: {},
  messageHistoryState: {},
  outputs: {},
  toolCalls: {},
  sessionPlans: {},
  dismissedCompletedSessionPlanKeys: {},
  diffs: {},
  historicalDiffIncompleteBySession: {},
  setMessages: (updater) =>
    set((state) => ({
      messages: typeof updater === "function" ? updater(state.messages) : updater,
    })),
  setSessionTimeline: (updater) =>
    set((state) => ({
      sessionTimeline:
        typeof updater === "function" ? updater(state.sessionTimeline) : updater,
    })),
  setSessionTimelineDeliveryState: (updater) =>
    set((state) => ({
      sessionTimelineDeliveryState:
        typeof updater === "function"
          ? updater(state.sessionTimelineDeliveryState)
          : updater,
    })),
  setSessionLegacyEvidence: (updater) =>
    set((state) => ({
      sessionLegacyEvidence:
        typeof updater === "function"
          ? updater(state.sessionLegacyEvidence)
          : updater,
    })),
  setMessageHistoryState: (updater) =>
    set((state) => ({
      messageHistoryState:
        typeof updater === "function" ? updater(state.messageHistoryState) : updater,
    })),
  setOutputs: (updater) =>
    set((state) => ({
      outputs: typeof updater === "function" ? updater(state.outputs) : updater,
    })),
  setToolCalls: (updater) =>
    set((state) => ({
      toolCalls:
        typeof updater === "function" ? updater(state.toolCalls) : updater,
    })),
  setSessionPlans: (updater) =>
    set((state) => ({
      sessionPlans:
        typeof updater === "function" ? updater(state.sessionPlans) : updater,
    })),
  setDismissedCompletedSessionPlanKeys: (updater) =>
    set((state) => ({
      dismissedCompletedSessionPlanKeys:
        typeof updater === "function"
          ? updater(state.dismissedCompletedSessionPlanKeys)
          : updater,
    })),
  setDiffs: (updater) =>
    set((state) => ({
      diffs: typeof updater === "function" ? updater(state.diffs) : updater,
    })),
  setHistoricalDiffIncompleteBySession: (updater) =>
    set((state) => ({
      historicalDiffIncompleteBySession:
        typeof updater === "function"
          ? updater(state.historicalDiffIncompleteBySession)
          : updater,
    })),
});
