import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@tiller/shared";

export function createSessionMessageStore(rootDir: string) {
  return {
    append(sessionId: string, message: AgentMessage) {
      const current = listSessionMessages(rootDir, sessionId);
      const next = mergeSessionMessage(current, message);
      persistSessionMessages(rootDir, sessionId, next);
      return next;
    },
    list(sessionId: string) {
      return listSessionMessages(rootDir, sessionId);
    },
    remove(sessionId: string) {
      try {
        unlinkSync(getSessionMessageFilePath(rootDir, sessionId));
      } catch {
        // ignore missing file
      }
    },
  };
}

function listSessionMessages(rootDir: string, sessionId: string) {
  try {
    const raw = readFileSync(getSessionMessageFilePath(rootDir, sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortAgentMessages(parsed.filter(isAgentMessage)) : [];
  } catch {
    return [];
  }
}

function mergeSessionMessage(messages: AgentMessage[], message: AgentMessage) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return sortAgentMessages([...messages, message]);
  }

  return sortAgentMessages(messages.map((item, itemIndex) => itemIndex === index
    ? {
        ...item,
        ...message,
        text: item.text === message.text || item.text.endsWith(message.text) ? item.text : `${item.text}${message.text}`,
        timestamp: item.timestamp,
      }
    : item));
}

function sortAgentMessages(messages: AgentMessage[]) {
  return [...messages].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function persistSessionMessages(rootDir: string, sessionId: string, messages: AgentMessage[]) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(getSessionMessageFilePath(rootDir, sessionId), JSON.stringify(messages, null, 2), "utf8");
}

function getSessionMessageFilePath(rootDir: string, sessionId: string) {
  return join(rootDir, `${sessionId}.json`);
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.text === "string" &&
    typeof candidate.timestamp === "string"
  );
}
