import { mergeStreamingText, type AgentMessage } from "@tiller/shared";

export type LiveMessageBuffer = ReturnType<typeof createLiveMessageBuffer>;

export function createLiveMessageBuffer() {
  const messages = new Map<string, {
    fullMessage: AgentMessage;
    pendingText: string;
  }>();

  function append(sessionId: string, message: AgentMessage): AgentMessage {
    const current = messages.get(sessionId);
    if (!current || current.fullMessage.id !== message.id) {
      messages.set(sessionId, {
        fullMessage: message,
        pendingText: message.text,
      });
      return message;
    }

    const mergedText = mergeLiveMessageText(
      current.fullMessage.text,
      message.text,
      message.streamMode,
    );
    const pendingText = resolvePendingDelta(
      current.fullMessage.text,
      mergedText,
      message.text,
    );
    const next = {
      ...message,
      text: mergedText,
      timestamp: message.timestamp,
      sequence: current.fullMessage.sequence ?? message.sequence,
    };
    messages.set(sessionId, {
      fullMessage: next,
      pendingText: mergedText.startsWith(current.fullMessage.text)
        ? current.pendingText + pendingText
        : pendingText,
    });
    return next;
  }

  function peek(sessionId: string): AgentMessage | null {
    return messages.get(sessionId)?.fullMessage ?? null;
  }

  function flushPending(sessionId: string): AgentMessage | null {
    const current = messages.get(sessionId);
    if (!current || !current.pendingText) {
      return null;
    }
    const next = {
      ...current.fullMessage,
      text: current.pendingText,
    };
    messages.set(sessionId, {
      fullMessage: current.fullMessage,
      pendingText: "",
    });
    return next;
  }

  function pendingLength(sessionId: string) {
    return messages.get(sessionId)?.pendingText.length ?? 0;
  }

  function finalize(sessionId: string): AgentMessage | null {
    const message = peek(sessionId);
    messages.delete(sessionId);
    return message;
  }

  function remove(sessionId: string): void {
    messages.delete(sessionId);
  }

  function sessionIds(): string[] {
    return [...messages.keys()];
  }

  function mergeLiveMessageText(
    currentText: string,
    incomingText: string,
    streamMode: AgentMessage["streamMode"],
  ) {
    return mergeStreamingText(currentText, incomingText, streamMode ?? "auto") ?? currentText;
  }

  function resolvePendingDelta(
    currentText: string,
    mergedText: string,
    incomingText: string,
  ) {
    if (mergedText === currentText) {
      return "";
    }
    if (mergedText.startsWith(currentText)) {
      return mergedText.slice(currentText.length);
    }
    if (incomingText.startsWith(currentText)) {
      return incomingText.slice(currentText.length);
    }
    return mergedText;
  }

  return { append, peek, flushPending, pendingLength, finalize, remove, sessionIds };
}
