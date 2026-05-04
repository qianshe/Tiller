import type { MutableRefObject } from "react";
import type { HelmToClient } from "@tiller/sync-protocol";
import type { AgentToolCall } from "@tiller/shared";
import { commandChunkToToolCall, mergeAgentMessages } from "../../features/logbook/timeline";
import { useDeckStore } from "../../store";

type ActivityServerEventContext = {
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>;
  mergeSessionToolCalls: (sessionId: string, incoming: AgentToolCall[]) => void;
  appendSystemMessage: (sessionId: string, text: string) => void;
};

export function handleActivityServerEvent(
  payload: HelmToClient,
  context: ActivityServerEventContext,
) {
  const {
    toolCallsRef,
    mergeSessionToolCalls,
    appendSystemMessage,
  } = context;
  const store = useDeckStore.getState();

  switch (payload.type) {
    case "agent.message": {
      const toolBoundaryTimes = (toolCallsRef.current[payload.sessionId] ?? [])
        .map((call) => Date.parse(call.timestamp))
        .filter(Number.isFinite);
      store.setMessages((current) => ({
        ...current,
        [payload.sessionId]: mergeAgentMessages(
          current[payload.sessionId] ?? [],
          payload.message,
          toolBoundaryTimes,
        ),
      }));
      store.setSessions((current) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                updatedAt: payload.message.timestamp,
                messageCount: session.messageCount + 1,
                lastMessagePreview: payload.message.text.slice(0, 160),
              }
            : session,
        ),
      );
      return true;
    }
    case "permission.request":
      store.setPermissionRequests((current) => ({
        ...current,
        [payload.sessionId]: payload.permissionRequest,
      }));
      return true;
    case "permission.resolved":
      store.setPermissionRequests((current) => ({
        ...current,
        [payload.sessionId]: null,
      }));
      return true;
    case "command.output":
      store.setOutputs((current) => ({
        ...current,
        [payload.sessionId]: [
          ...(current[payload.sessionId] ?? []),
          payload.chunk,
        ],
      }));
      mergeSessionToolCalls(payload.sessionId, [
        commandChunkToToolCall(payload.chunk),
      ]);
      return true;
    case "tool.call":
      mergeSessionToolCalls(payload.sessionId, [payload.toolCall]);
      return true;
    case "diff.update":
      store.setDiffs((current) => ({
        ...current,
        [payload.sessionId]: payload.files,
      }));
      return true;
    case "error":
      store.setPairingFeedback(payload.message);
      if (/not paired|not authenticated/iu.test(payload.message)) {
        store.setPairingState("input");
      }
      if (payload.sessionId) {
        appendSystemMessage(payload.sessionId, payload.message);
        store.setSessions((current) =>
          current.map((session) =>
            session.id === payload.sessionId
              ? {
                  ...session,
                  status: "error",
                  updatedAt: new Date().toISOString(),
                  lastMessagePreview: payload.message.slice(0, 160),
                }
              : session,
          ),
        );
      }
      return true;
    default:
      return false;
  }
}
