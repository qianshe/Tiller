import type { MutableRefObject } from "react";
import type { AgentToolCall } from "@tiller/shared";
import { commandChunkToToolCall, mergeAgentMessages } from "../logbook";
import { useDeckStore } from "../../store";

export type ActivityServerEventContext = {
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>;
  mergeSessionToolCalls: (sessionId: string, incoming: AgentToolCall[]) => void;
  appendSystemMessage: (sessionId: string, text: string) => void;
};

type SessionUpdateParams = {
  sessionId: string;
  update: { kind: string } & Record<string, unknown>;
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
      const message = update.message as Parameters<typeof mergeAgentMessages>[1];
      const toolBoundaryTimes = (toolCallsRef.current[sessionId] ?? [])
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
      store.setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: message.timestamp,
                messageCount: session.messageCount + 1,
                lastMessagePreview: message.text.slice(0, 160),
              }
            : session,
        ),
      );
      return true;
    }
    case "permission_request":
      store.setPermissionRequests((current) => ({
        ...current,
        [sessionId]: update.permissionRequest as never,
      }));
      return true;
    case "permission_resolved":
      store.setPermissionRequests((current) => ({
        ...current,
        [sessionId]: null,
      }));
      return true;
    case "command_output": {
      const chunk = update.chunk as Parameters<typeof commandChunkToToolCall>[0];
      store.setOutputs((current) => ({
        ...current,
        [sessionId]: [
          ...(current[sessionId] ?? []),
          chunk,
        ],
      }));
      mergeSessionToolCalls(sessionId, [commandChunkToToolCall(chunk)]);
      return true;
    }
    case "tool_call":
      mergeSessionToolCalls(sessionId, [update.toolCall as AgentToolCall]);
      return true;
    case "diff_update":
      store.setDiffs((current) => ({
        ...current,
        [sessionId]: update.files as never,
      }));
      return true;
    default:
      return false;
  }
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
