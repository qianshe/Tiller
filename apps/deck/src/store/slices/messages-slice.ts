import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
} from "@tiller/shared";
import type { StateCreator } from "zustand";

export type MessageHistoryState = Record<
  string,
  { nextCursor?: string; hasMore: boolean; loading: boolean }
>;

type Updater<T> = T | ((current: T) => T);

export type MessagesSlice = {
  messages: Record<string, AgentMessage[]>;
  messageHistoryState: MessageHistoryState;
  outputs: Record<string, CommandChunk[]>;
  toolCalls: Record<string, AgentToolCall[]>;
  diffs: Record<string, FileDiffSummary[]>;
  setMessages: (updater: Updater<Record<string, AgentMessage[]>>) => void;
  setMessageHistoryState: (updater: Updater<MessageHistoryState>) => void;
  setOutputs: (updater: Updater<Record<string, CommandChunk[]>>) => void;
  setToolCalls: (updater: Updater<Record<string, AgentToolCall[]>>) => void;
  setDiffs: (updater: Updater<Record<string, FileDiffSummary[]>>) => void;
};

export const createMessagesSlice: StateCreator<MessagesSlice> = (set) => ({
  messages: {},
  messageHistoryState: {},
  outputs: {},
  toolCalls: {},
  diffs: {},
  setMessages: (updater) =>
    set((state) => ({
      messages: typeof updater === "function" ? updater(state.messages) : updater,
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
  setDiffs: (updater) =>
    set((state) => ({
      diffs: typeof updater === "function" ? updater(state.diffs) : updater,
    })),
});
