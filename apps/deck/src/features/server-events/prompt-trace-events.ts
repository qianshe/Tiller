import type { PromptTraceEvent } from "@tiller/shared";
import { useDeckStore } from "../../store";
import type { SessionUpdateParams } from "./session-update-contracts";

export function applyPromptTraceEvent(event: PromptTraceEvent) {
  useDeckStore.getState().appendPromptTraceEvent(event);
  return true;
}

export function traceDeckPromptSubmit(input: {
  traceId: string;
  sessionId: string;
  text: string;
  imageCount: number;
}): void {
  applyPromptTraceEvent(createDeckPromptSubmitTraceEvent(input));
}

export function createDeckPromptSubmitTraceEvent(input: {
  traceId: string;
  sessionId: string;
  text: string;
  imageCount: number;
}): PromptTraceEvent {
  return {
    traceId: input.traceId,
    sessionId: input.sessionId,
    phase: "deck.prompt.submit",
    timestamp: new Date().toISOString(),
    source: "deck",
    meta: {
      chars: input.text.length,
      images: input.imageCount,
    },
  };
}

export function createDeckSessionUpdateTraceEvent(
  params: SessionUpdateParams,
  phase: "deck.session_update.received" | "deck.session_update.applied",
): PromptTraceEvent {
  return {
    traceId: resolveSessionUpdateTraceId(params),
    sessionId: params.sessionId,
    phase,
    timestamp: new Date().toISOString(),
    source: "deck",
    meta: { kind: params.update.kind },
  };
}

function resolveSessionUpdateTraceId(params: SessionUpdateParams): string {
  const { update } = params;
  switch (update.kind) {
    case "user_message":
    case "agent_message":
      return update.message.id;
    case "tool_call":
      return update.toolCall.id;
    case "command_output":
      return update.commandId;
    case "session_updated":
      return update.session.id;
    default:
      return params.sessionId;
  }
}
