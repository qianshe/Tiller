import assert from "node:assert/strict";
import test from "node:test";
import type { PromptTraceEvent } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createPromptTraceSlice, type PromptTraceSlice } from "./prompt-trace-slice.js";

function createTestStore() {
  return createStore<PromptTraceSlice>()((...args) => ({
    ...createPromptTraceSlice(...args),
  }));
}

function traceEvent(index: number): PromptTraceEvent {
  return {
    traceId: `trace-${index}`,
    sessionId: "session-1",
    phase: "deck.session_update.received",
    timestamp: `2026-05-24T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
    source: "deck",
  };
}

test("prompt trace slice keeps only latest 200 events", () => {
  const store = createTestStore();

  for (let index = 0; index < 205; index += 1) {
    store.getState().appendPromptTraceEvent(traceEvent(index));
  }

  assert.equal(store.getState().promptTraceEvents.length, 200);
  assert.equal(store.getState().promptTraceEvents[0]?.traceId, "trace-5");
  assert.equal(store.getState().promptTraceEvents.at(-1)?.traceId, "trace-204");
});

test("prompt trace slice clears events", () => {
  const store = createTestStore();

  store.getState().appendPromptTraceEvent(traceEvent(1));
  store.getState().clearPromptTraceEvents();

  assert.deepEqual(store.getState().promptTraceEvents, []);
});
