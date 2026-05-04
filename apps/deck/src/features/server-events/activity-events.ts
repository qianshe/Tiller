import { commandChunkToToolCall, mergeAgentMessages } from "../../features/logbook/timeline";
import { useDeckStore } from "../../store";

export function handleActivityServerEvent(
  payload: { type: string; [key: string]: any },
  context: any,
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
        .map((call: any) => Date.parse(call.timestamp))
        .filter(Number.isFinite);
      store.setMessages((current: any) => ({
        ...current,
        [payload.sessionId]: mergeAgentMessages(
          current[payload.sessionId] ?? [],
          payload.message,
          toolBoundaryTimes,
        ),
      }));
      store.setSessions((current: any[]) =>
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
      store.setPermissionRequests((current: any) => ({
        ...current,
        [payload.sessionId]: payload.permissionRequest,
      }));
      return true;
    case "permission.resolved":
      store.setPermissionRequests((current: any) => ({
        ...current,
        [payload.sessionId]: null,
      }));
      return true;
    case "command.output":
      store.setOutputs((current: any) => ({
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
      store.setDiffs((current: any) => ({
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
        store.setSessions((current: any[]) =>
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
