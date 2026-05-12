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
      text: `${current.text}${message.text}`,
      timestamp: message.timestamp,
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

  return { append, peek, finalize };
}
