import type { MutableRefObject } from "react";
import type { AgentToolCall, AgentMessage, SessionSummary } from "@tiller/shared";
import { dropActiveThinkingToolCalls, mergeAgentMessages } from "../logbook";
import { useDeckStore } from "../../store";
import { stripRedundantAttachmentData } from "./helpers";
import type { SessionUpdateParams } from "./session-update-contracts";

export type ActivityServerEventContext = {
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>;
  mergeSessionToolCalls: (sessionId: string, incoming: AgentToolCall[]) => void;
  appendSystemMessage: (sessionId: string, text: string) => void;
};

type ErrorRaisedParams = {
  sessionId?: string;
  message: string;
  code?: string;
  data?: unknown;
};

export function applyActivityUpdate(
  params: SessionUpdateParams,
  context: ActivityServerEventContext,
) {
  const { sessionId, update } = params;
  const { toolCallsRef, mergeSessionToolCalls } = context;
  const store = useDeckStore.getState();

  switch (update.kind) {
    case "agent_message": {
      const message = stripRedundantAttachmentData(
        withStreamingState(update.message, update.streaming),
      );
      const sessionToolCalls = clearActiveThinkingToolCalls(
        sessionId,
        toolCallsRef,
        store,
      );
      const toolBoundaryTimes = sessionToolCalls
        .map((call) => Date.parse(call.timestamp))
        .filter(Number.isFinite);
      store.setMessages((current) => ({
        ...current,
        [sessionId]: mergeAgentMessages(
          current[sessionId] ?? [],
          message,
          toolBoundaryTimes,
        ),
      }));
      if (shouldApplyMessageToSessionSummary(message)) {
        store.setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? applyMessageToSessionSummary(session, message)
              : session,
          ),
        );
      }
      return true;
    }
    case "tool_call": {
      const toolCall = update.toolCall;
      const isAlreadySettled = toolCall.status === "completed" || toolCall.status === "failed";
      if (isAlreadySettled) {
        const runningSnapshot = { ...toolCall, status: "running" as const };
        mergeSessionToolCalls(sessionId, [runningSnapshot]);
        requestAnimationFrame(() => {
          mergeSessionToolCalls(sessionId, [toolCall]);
        });
      } else {
        mergeSessionToolCalls(sessionId, [toolCall]);
      }
      return true;
    }
    default:
      return false;
  }
}

type DeckStore = ReturnType<typeof useDeckStore.getState>;

function clearActiveThinkingToolCalls(
  sessionId: string,
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>,
  store: DeckStore,
) {
  const currentSessionToolCalls = toolCallsRef.current[sessionId] ?? [];
  const nextSessionToolCalls = dropActiveThinkingToolCalls(currentSessionToolCalls);
  if (nextSessionToolCalls.length === currentSessionToolCalls.length) {
    return currentSessionToolCalls;
  }

  store.setToolCalls((current) => {
    const next = {
      ...current,
      [sessionId]: nextSessionToolCalls,
    };
    toolCallsRef.current = next;
    return next;
  });
  return nextSessionToolCalls;
}

function withStreamingState(
  message: AgentMessage,
  streaming: unknown,
): AgentMessage {
  return typeof streaming === "boolean" ? { ...message, streaming } : message;
}

function shouldApplyMessageToSessionSummary(message: AgentMessage): boolean {
  return message.role === "user" || message.streaming === false;
}

function applyMessageToSessionSummary(
  session: SessionSummary,
  message: AgentMessage,
): SessionSummary {
  if (message.role !== "user") {
    return {
      ...session,
      updatedAt: message.timestamp,
    };
  }

  return {
    ...session,
    updatedAt: message.timestamp,
    messageCount: session.messageCount + 1,
    lastMessagePreview: message.text.slice(0, 160),
  };
}

export function applyErrorRaised(
  params: ErrorRaisedParams,
  context: ActivityServerEventContext,
) {
  const { appendSystemMessage } = context;
  const store = useDeckStore.getState();
  store.setPairingFeedback(params.message);
  if (/not paired|not authenticated/iu.test(params.message)) {
    store.setPairingState("input");
  }
  if (params.sessionId) {
    appendSystemMessage(params.sessionId, params.message);
    store.setSessions((current) =>
      current.map((session) =>
        session.id === params.sessionId
          ? {
              ...session,
              status: "error",
              updatedAt: new Date().toISOString(),
              lastMessagePreview: params.message.slice(0, 160),
            }
          : session,
      ),
    );
  }
  return true;
}
