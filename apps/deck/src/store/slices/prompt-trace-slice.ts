import type { PromptTraceEvent } from "@tiller/shared";
import type { StateCreator } from "zustand";

const MAX_PROMPT_TRACE_EVENTS = 200;

export type PromptTraceSlice = {
  promptTraceEvents: PromptTraceEvent[];
  appendPromptTraceEvent: (event: PromptTraceEvent) => void;
  clearPromptTraceEvents: () => void;
};

export const createPromptTraceSlice: StateCreator<PromptTraceSlice> = (set) => ({
  promptTraceEvents: [],
  appendPromptTraceEvent: (event) =>
    set((state) => ({
      promptTraceEvents: [...state.promptTraceEvents, event].slice(-MAX_PROMPT_TRACE_EVENTS),
    })),
  clearPromptTraceEvents: () => set({ promptTraceEvents: [] }),
});
