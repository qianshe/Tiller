import type { AgentToolCall } from "@tiller/shared";

function timestamp() {
  return new Date().toISOString();
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractTextContent(content: any): string | null {
  if (!content) {
    return null;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => extractTextContent(item)).filter(Boolean).join("") || null;
  }

  if (content.type === "text" && typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.content === "string") {
    return content.content;
  }

  return extractTextContent(content.content) ?? null;
}

function extractThinkingContent(content: any): string | null {
  if (!content) {
    return null;
  }
  if (Array.isArray(content)) {
    return content.map((item) => extractThinkingContent(item)).filter(Boolean).join("") || null;
  }
  if (content.type === "thinking" && typeof content.thinking === "string") {
    return content.thinking;
  }
  if (content.type === "reasoning" && typeof content.text === "string") {
    return content.text;
  }
  if (typeof content.thinking === "string") {
    return content.thinking;
  }
  return extractThinkingContent(content.content);
}

function resolveThinkingMessageId(sessionId: string, update: any) {
  return (
    stringFrom(update.messageId ?? update.message_id ?? update.message?.id ?? update.id) ??
    `${sessionId}-thinking`
  );
}

export function extractThinkingToolCall(
  sessionId: string,
  updateType: string | undefined,
  update: any,
): AgentToolCall | null {
  const acpThoughtText = updateType === "agent_thought_chunk"
    ? extractTextContent(update.content) ??
      extractTextContent(update.delta) ??
      extractTextContent(update.message)
    : undefined;
  const thinking =
    acpThoughtText ??
    extractThinkingContent(update.content) ??
    extractThinkingContent(update.delta) ??
    extractThinkingContent(update.message) ??
    stringFrom(update.thinking ?? update.reasoning);
  if (!thinking?.trim()) {
    return null;
  }
  const now = timestamp();
  const messageId = resolveThinkingMessageId(sessionId, update);
  return {
    id: `${messageId}:thinking`,
    commandId: `${messageId}:thinking`,
    kind: "think",
    title: "Thinking",
    status: /complete|done|finished|end/iu.test(updateType ?? "") ? "completed" : "running",
    output: thinking,
    timestamp: stringFrom(update.timestamp) ?? now,
    updatedAt: stringFrom(update.updatedAt ?? update.updated_at ?? update.timestamp) ?? now,
  };
}
