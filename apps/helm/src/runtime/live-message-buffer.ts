import type { AgentMessage } from "@tiller/shared";

export type LiveMessageBuffer = ReturnType<typeof createLiveMessageBuffer>;

export function createLiveMessageBuffer() {
  const messages = new Map<string, AgentMessage>();

  function append(sessionId: string, message: AgentMessage): AgentMessage {
    const current = messages.get(sessionId);
    if (!current || current.id !== message.id) {
      messages.set(sessionId, message);
      return message;
    }

    const next = {
      ...message,
      text: mergeLiveMessageText(current.text, message.text),
      timestamp: message.timestamp,
      sequence: current.sequence ?? message.sequence,
    };
    messages.set(sessionId, next);
    return next;
  }

  function peek(sessionId: string): AgentMessage | null {
    return messages.get(sessionId) ?? null;
  }

  function finalize(sessionId: string): AgentMessage | null {
    const message = peek(sessionId);
    messages.delete(sessionId);
    return message;
  }

  function mergeLiveMessageText(currentText: string, incomingText: string) {
    if (currentText === incomingText || currentText.endsWith(incomingText)) {
      return currentText;
    }
    if (incomingText.startsWith(currentText)) {
      return incomingText;
    }
    return `${currentText}${incomingText}`;
  }

  return { append, peek, finalize };
}
