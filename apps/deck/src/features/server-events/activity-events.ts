import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
} from "@tiller/shared";
import { mergeAgentMessages } from "../logbook";
import { toast } from "../toast";
import {
  useDeckStore,
  type DeckNotificationDetails,
  type DeckNotificationInput,
} from "../../store";
import { stripRedundantAttachmentData } from "./helpers";
import type { SessionUpdateParams } from "./session-update-contracts";

export type ActivityServerEventContext = {
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>;
  mergeSessionToolCalls: (sessionId: string, incoming: AgentToolCall[]) => void;
  appendSystemMessage: (sessionId: string, text: string) => void;
  addNotification?: (input: DeckNotificationInput) => void;
  scheduleSubagentSettlement?: (callback: () => void) => void;
};

const SUBAGENT_RUNNING_MIN_VISIBLE_MS = 400;

type ErrorRaisedParams = {
  sessionId?: string;
  message: string;
  code?: string;
  data?: unknown;
  details?: DeckNotificationDetails;
};

type NotificationRaisedParams = {
  kind: "error" | "warning" | "info";
  source: string;
  sessionId?: string;
  code?: string;
  message: string;
  occurredAt?: string;
  details?: DeckNotificationDetails;
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
      const sessionToolCalls = toolCallsRef.current[sessionId] ?? [];
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
      const isSettledSubagent =
        toolCall.kind === "subagent"
        && (
          toolCall.status === "completed"
          || toolCall.status === "failed"
          || toolCall.status === "cancelled"
        );
      if (isSettledSubagent) {
        const runningSnapshot = {
          ...toolCall,
          status: "running" as const,
          output: undefined,
        };
        mergeSessionToolCalls(sessionId, [runningSnapshot]);
        const scheduleSettlement =
          context.scheduleSubagentSettlement ?? scheduleVisibleSubagentSettlement;
        scheduleSettlement(() => {
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

function scheduleVisibleSubagentSettlement(callback: () => void): void {
  globalThis.setTimeout(callback, SUBAGENT_RUNNING_MIN_VISIBLE_MS);
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
  return applyNotificationRaised({
    ...params,
    kind: "error",
    source: "rpc",
  }, context);
}

export function applyNotificationRaised(
  params: NotificationRaisedParams,
  context: ActivityServerEventContext,
) {
  const { appendSystemMessage, addNotification } = context;
  const store = useDeckStore.getState();
  const sessionMessage = params.code
    ? `[${params.code}] ${params.message}`
    : params.message;
  addNotification?.({
    kind: params.kind,
    message: params.message,
    source: params.source,
    code: params.code,
    sessionId: params.sessionId,
    details: params.details,
    createdAt: params.occurredAt,
  });
  const toastOptions = params.kind === "error"
    ? { duration: 8_000 }
    : params.kind === "warning"
      ? { duration: 6_000 }
      : undefined;
  if (params.kind === "error") {
    toast.error(sessionMessage, toastOptions);
  } else if (params.kind === "warning") {
    toast.warning(sessionMessage, toastOptions);
  } else {
    toast.info(sessionMessage, toastOptions);
  }
  if (params.kind === "error") {
    store.setPairingFeedback(params.message);
  }
  if (params.kind === "error" && /not paired|not authenticated/iu.test(params.message)) {
    store.setPairingState("input");
  }
  if (params.sessionId && params.kind === "error") {
    appendSystemMessage(params.sessionId, sessionMessage);
    store.setSessions((current) =>
      current.map((session) =>
        session.id === params.sessionId
          ? {
              ...session,
              status: "error",
              updatedAt: new Date().toISOString(),
              lastMessagePreview: sessionMessage.slice(0, 160),
            }
          : session,
      ),
    );
  }
  return true;
}
