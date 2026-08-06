import { mergeStreamingText, type AgentMessage } from "@tiller/shared";

export type LiveMessageBuffer = ReturnType<typeof createLiveMessageBuffer>;

type PendingStreamMode = Exclude<AgentMessage["streamMode"], undefined>;

export function createLiveMessageBuffer() {
  const messages = new Map<string, {
    fullMessage: AgentMessage;
    pendingText: string;
    pendingStreamMode: PendingStreamMode;
  }>();

  function append(sessionId: string, message: AgentMessage): AgentMessage {
    const current = messages.get(sessionId);
    if (!current || current.fullMessage.id !== message.id) {
      messages.set(sessionId, {
        fullMessage: message,
        pendingText: message.text,
        pendingStreamMode: message.streamMode === "snapshot" ? "snapshot" : "delta",
      });
      return message;
    }

    const mergedText = mergeLiveMessageText(
      current.fullMessage.text,
      message.text,
      message.streamMode,
    );
    const pending = resolvePendingUpdate({
      current,
      incomingText: message.text,
      mergedText,
      streamMode: message.streamMode,
    });
    const next = {
      ...message,
      streamMode: message.streamMode,
      text: mergedText,
      timestamp: message.timestamp,
      sequence: current.fullMessage.sequence ?? message.sequence,
    };
    messages.set(sessionId, {
      fullMessage: next,
      pendingText: pending.text,
      pendingStreamMode: pending.streamMode,
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
      streamMode: current.pendingStreamMode,
    };
    messages.set(sessionId, {
      fullMessage: current.fullMessage,
      pendingText: "",
      pendingStreamMode: current.pendingStreamMode,
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

  function resolvePendingUpdate(input: {
    current: {
      fullMessage: AgentMessage;
      pendingText: string;
      pendingStreamMode: PendingStreamMode;
    };
    incomingText: string;
    mergedText: string;
    streamMode: AgentMessage["streamMode"];
  }): { text: string; streamMode: PendingStreamMode } {
    const currentText = input.current.fullMessage.text;
    if (input.mergedText === currentText) {
      return {
        text: input.current.pendingText,
        streamMode: input.current.pendingStreamMode,
      };
    }

    const appendedText = input.mergedText.startsWith(currentText)
      ? input.mergedText.slice(currentText.length)
      : input.incomingText.startsWith(currentText)
        ? input.incomingText.slice(currentText.length)
        : null;
    if (appendedText !== null) {
      return {
        text: input.current.pendingText + appendedText,
        streamMode: input.current.pendingText
          ? input.current.pendingStreamMode
          : "delta",
      };
    }

    return {
      text: input.mergedText,
      streamMode: input.streamMode === "delta" ? "delta" : "snapshot",
    };
  }

  return { append, peek, flushPending, pendingLength, finalize, remove, sessionIds };
}
