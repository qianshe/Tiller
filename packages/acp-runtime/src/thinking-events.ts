import { isToolOrTerminalUpdateType } from "./session-update";

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

// 内部递归版本（参数与导出函数不同，不构成遮蔽）
function extractThinkingBlock(content: any): string | null {
  if (!content) {
    return null;
  }
  if (Array.isArray(content)) {
    return content.map((item) => extractThinkingBlock(item)).filter(Boolean).join("") || null;
  }
  if (content.type === "thinking" && typeof content.thinking === "string") {
    return content.thinking;
  }
  if (content.type === "reasoning" && typeof content.text === "string") {
    return content.text;
  }
  return null;
}

function isThoughtUpdateType(updateType: string | undefined) {
  return updateType === "agent_thought_chunk" ||
    updateType === "agent_thought" ||
    updateType === "agent_thought_complete";
}

function resolveThinkingMessageId(sessionId: string, update: any) {
  return (
    stringFrom(update.messageId ?? update.message_id ?? update.message?.id ?? update.id) ??
    `${sessionId}-thinking`
  );
}

function normalizeThinkingText(value: string) {
  const normalized = value
    .replace(/[​-‍⁠﻿]/gu, "")
    .trim();
  const marker = normalized.toLowerCase();
  return marker !== "" && marker !== "{}" && marker !== "[]" && marker !== "null"
    ? normalized
    : null;
}

export type ThinkingContent = {
  id: string;
  text: string;
  status: "running" | "completed";
  streamMode: "delta" | "snapshot";
  timestamp: string;
  updatedAt: string;
  streaming: boolean;
};

export function extractThinkingContent(
  sessionId: string,
  updateType: string | undefined,
  update: any,
): ThinkingContent | null {
  if (isToolOrTerminalUpdateType(updateType)) {
    return null;
  }
  const acpThoughtText = isThoughtUpdateType(updateType)
    ? extractTextContent(update.content) ??
      extractTextContent(update.delta) ??
      extractTextContent(update.message)
    : undefined;
  const thinking = isThoughtUpdateType(updateType)
    ? acpThoughtText
    : extractThinkingBlock(update.content) ??
      extractThinkingBlock(update.delta) ??
      extractThinkingBlock(update.message);
  const normalizedThinking = thinking ? normalizeThinkingText(thinking) : null;
  if (!normalizedThinking) {
    return null;
  }
  const now = timestamp();
  const messageId = resolveThinkingMessageId(sessionId, update);
  const isCompleted = /complete|done|finished|end/iu.test(updateType ?? "");
  return {
    id: messageId,
    text: normalizedThinking,
    status: isCompleted ? "completed" : "running",
    streamMode: updateType === "agent_thought" || isCompleted ? "snapshot" : "delta",
    timestamp: stringFrom(update.timestamp) ?? now,
    updatedAt: stringFrom(update.updatedAt ?? update.updated_at ?? update.timestamp) ?? now,
    streaming: !isCompleted,
  };
}
