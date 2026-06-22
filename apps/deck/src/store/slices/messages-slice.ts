import type {
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionTranscriptStatus,
  SessionTimelineEntry,
} from "@tiller/shared";
import type { StateCreator } from "zustand";

export type MessageHistoryState = Record<
  string,
  {
    nextCursor?: string;
    hasMore: boolean;
    timelineNextCursor?: string;
    timelineHasMore?: boolean;
    loading: boolean;
  }
>;

type Updater<T> = T | ((current: T) => T);

export type MessagesSlice = {
  messages: Record<string, AgentMessage[]>;
  sessionTimeline: Record<string, SessionTimelineEntry[]>;
  transcriptStatusBySession: Record<string, SessionTranscriptStatus | undefined>;
  messageHistoryState: MessageHistoryState;
  outputs: Record<string, CommandChunk[]>;
  toolCalls: Record<string, AgentToolCall[]>;
  sessionPlans: Record<string, AgentPlan>;
  dismissedCompletedSessionPlanKeys: Record<string, string>;
  diffs: Record<string, FileDiffSummary[]>;
  setMessages: (updater: Updater<Record<string, AgentMessage[]>>) => void;
  setSessionTimeline: (updater: Updater<Record<string, SessionTimelineEntry[]>>) => void;
  setTranscriptStatusBySession: (
    updater: Updater<Record<string, SessionTranscriptStatus | undefined>>,
  ) => void;
  setMessageHistoryState: (updater: Updater<MessageHistoryState>) => void;
  setOutputs: (updater: Updater<Record<string, CommandChunk[]>>) => void;
  setToolCalls: (updater: Updater<Record<string, AgentToolCall[]>>) => void;
  setSessionPlans: (updater: Updater<Record<string, AgentPlan>>) => void;
  setDismissedCompletedSessionPlanKeys: (
    updater: Updater<Record<string, string>>,
  ) => void;
  setDiffs: (updater: Updater<Record<string, FileDiffSummary[]>>) => void;
};

export const createMessagesSlice: StateCreator<MessagesSlice> = (set) => ({
  messages: {},
  sessionTimeline: {},
  transcriptStatusBySession: {},
  messageHistoryState: {},
  outputs: {},
  toolCalls: {},
  sessionPlans: {},
  dismissedCompletedSessionPlanKeys: {},
  diffs: {},
  setMessages: (updater) =>
    set((state) => ({
      messages: typeof updater === "function" ? updater(state.messages) : updater,
    })),
  setSessionTimeline: (updater) =>
    set((state) => ({
      sessionTimeline:
        typeof updater === "function" ? updater(state.sessionTimeline) : updater,
    })),
  setTranscriptStatusBySession: (updater) =>
    set((state) => ({
      transcriptStatusBySession:
        typeof updater === "function"
          ? updater(state.transcriptStatusBySession)
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
});
