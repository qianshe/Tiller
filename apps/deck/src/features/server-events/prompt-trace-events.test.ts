import assert from "node:assert/strict";
import test from "node:test";
import type { PromptTraceEvent } from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyPromptTraceEvent, createDeckSessionUpdateTraceEvent } from "./prompt-trace-events.js";

test("applyPromptTraceEvent appends prompt trace events to the deck store", () => {
  useDeckStore.getState().clearPromptTraceEvents();
  const event: PromptTraceEvent = {
    traceId: "trace-1",
    sessionId: "session-1",
    phase: "deck.session_update.received",
    timestamp: "2026-05-24T00:00:00.000Z",
    source: "deck",
  };

  const handled = applyPromptTraceEvent(event);

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().promptTraceEvents.length, 1);
  assert.equal(useDeckStore.getState().promptTraceEvents[0]?.phase, "deck.session_update.received");
});

test("createDeckSessionUpdateTraceEvent derives message trace ids", () => {
  const event = createDeckSessionUpdateTraceEvent(
    {
      sessionId: "session-1",
      update: {
        kind: "agent_message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "hello",
          timestamp: "2026-05-24T00:00:00.000Z",
        },
        streaming: true,
      },
    },
    "deck.session_update.received",
  );

  assert.equal(event.traceId, "message-1");
  assert.equal(event.meta?.kind, "agent_message");
});
