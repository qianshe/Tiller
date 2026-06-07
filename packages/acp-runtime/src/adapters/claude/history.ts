import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeLocalCommandMessageText } from "@tiller/shared";
import type { AgentToolCallKind } from "@tiller/shared";
import { collectHistoryImageAttachments } from "../history-content";
import {
  buildAuthoritativeHistoryFromEvents,
  normalizeHistoryMessageRole,
  stringFrom,
  stringifyHistoryPayload,
  type HistoryEvent,
} from "../history-events";
import type { ProviderHistoryReader } from "../history-reader";
import type { AcpAuthoritativeHistory } from "../types";
import { extractClaudePlanFromToolCalls } from "./plan-events";

export const claudeCodeHistoryReader: ProviderHistoryReader<string> = {
  read: ({ runtimeSessionId, cwd }) => readClaudeCodeHistorySource(runtimeSessionId, cwd),
  toEvents: (raw) => parseClaudeCodeJsonlEvents(raw),
  build: buildClaudeAuthoritativeHistoryFromEvents,
};

export async function loadClaudeCodeHistory(
  runtimeSessionId: string,
  cwd: string,
): Promise<AcpAuthoritativeHistory | null> {
  const raw = await readClaudeCodeHistorySource(runtimeSessionId, cwd);
  if (!raw) {
    return null;
  }
  return parseClaudeCodeJsonlHistory(raw);
}

export function parseClaudeCodeJsonlHistory(raw: string): AcpAuthoritativeHistory {
  return buildClaudeAuthoritativeHistoryFromEvents(parseClaudeCodeJsonlEvents(raw));
}

export function buildClaudeAuthoritativeHistoryFromEvents(
  events: HistoryEvent[],
): AcpAuthoritativeHistory {
  const history = buildAuthoritativeHistoryFromEvents(events);
  const plan = extractClaudePlanFromToolCalls(history.toolCalls);
  return plan ? { ...history, plan } : history;
}

function parseClaudeCodeJsonlEvents(raw: string): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  for (const line of raw.split(/\r?\n/u)) {
    const entry = parseJsonLine(line);
    if (!entry) {
      continue;
    }
    const timestamp = stringFrom(entry.timestamp);
    const role = normalizeHistoryMessageRole(entry.message?.role ?? entry.type);
    const content = entry.message?.content;
    const messageId = stringFrom(entry.uuid) ?? `claude:${events.length}`;
    if (!timestamp || !role) {
      continue;
    }

    if (Array.isArray(content)) {
      appendClaudeContentEvents({
        content,
        events,
        messageId,
        role,
        timestamp,
      });
      continue;
    }

    const text = collectClaudeText(content);
    if (text) {
      events.push({
        kind: "message",
        id: messageId,
        role,
        text,
        timestamp,
      });
    }
  }

  return events;
}

async function readClaudeCodeHistorySource(runtimeSessionId: string, cwd: string) {
  const historyPath = resolveClaudeCodeHistoryPath(runtimeSessionId, cwd);
  if (!existsSync(historyPath)) {
    return null;
  }
  return readFile(historyPath, "utf8");
}

function resolveClaudeCodeHistoryPath(runtimeSessionId: string, cwd: string) {
  return join(resolveClaudeConfigDir(), "projects", encodeClaudeProjectPath(cwd), `${runtimeSessionId}.jsonl`);
}

function resolveClaudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function encodeClaudeProjectPath(cwd: string) {
  return cwd.replace(/[\\/:]/gu, "-").replace(/^-+|-+$/gu, "");
}

function parseJsonLine(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function appendClaudeContentEvents({
  content,
  events,
  messageId,
  role,
  timestamp,
}: {
  content: any[];
  events: HistoryEvent[];
  messageId: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
}) {
  let textPartIndex = 0;
  let pendingUserImages = role === "user" ? collectHistoryImageAttachments(content, messageId) : [];
  for (const [index, part] of content.entries()) {
    if (part?.type === "text") {
      const text = normalizeClaudeText(part.text);
      if (text) {
        const attachments = pendingUserImages;
        pendingUserImages = [];
        events.push({
          kind: "message",
          id: resolveClaudeTextMessageId(messageId, textPartIndex),
          role,
          text,
          timestamp,
          ...(attachments.length ? { attachments } : {}),
        });
        textPartIndex += 1;
      }
      continue;
    }

    if (part?.type === "thinking") {
      const thinking = stringFrom(part.thinking);
      if (!thinking) {
        continue;
      }
      const id = `${messageId}:thinking:${index}`;
      events.push({
        kind: "thinking",
        id,
        text: thinking,
        timestamp,
      });
      continue;
    }

    if (part?.type === "tool_use") {
      const id = stringFrom(part.id);
      if (!id) {
        continue;
      }
      const title = stringFrom(part.name) ?? "Tool";
      events.push({
        kind: "tool_call",
        id,
        toolKind: inferClaudeToolKind(title),
        title,
        status: "running",
        ...(stringifyHistoryPayload(part.input) ? { input: stringifyHistoryPayload(part.input) } : {}),
        timestamp,
      });
      continue;
    }

    if (part?.type === "tool_result") {
      const id = stringFrom(part.tool_use_id);
      if (!id) {
        continue;
      }
      const output = stringifyToolResult(part.content);
      events.push({
        kind: "tool_result",
        id,
        status: part.is_error === true ? "failed" : "completed",
        ...(output ? { output } : {}),
        timestamp,
      });
    }
  }

  if (role === "user" && pendingUserImages.length) {
    events.push({
      kind: "message",
      id: messageId,
      role,
      timestamp,
      attachments: pendingUserImages,
    });
  }
}

function resolveClaudeTextMessageId(messageId: string, textPartIndex: number) {
  return textPartIndex === 0 ? messageId : `${messageId}#p${textPartIndex}`;
}

function collectClaudeText(content: unknown) {
  const raw =
    typeof content === "string"
      ? content
      : asArray(content)
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
  return normalizeClaudeText(raw);
}

function normalizeClaudeText(raw: unknown) {
  const normalized = normalizeLocalCommandMessageText(typeof raw === "string" ? raw : "");
  return shouldHideClaudeLocalCommandOutput(normalized) ? "" : normalized;
}

function shouldHideClaudeLocalCommandOutput(text: string) {
  return /^Set model to\b/iu.test(text);
}

function inferClaudeToolKind(toolName: string): AgentToolCallKind {
  const normalized = toolName.toLowerCase();
  if (normalized.startsWith("mcp__") || normalized.startsWith("mcp_")) {
    return "mcp";
  }
  if (normalized === "bash") {
    return "shell";
  }
  if (normalized === "read" || normalized === "notebookread") {
    return "read";
  }
  if (["edit", "multiedit", "write", "notebookedit"].includes(normalized)) {
    return "write";
  }
  if (normalized === "grep" || normalized === "glob" || normalized === "ls") {
    return "search";
  }
  if (normalized === "todowrite" || normalized === "taskupdate" || normalized === "taskcreate") {
    return "todo";
  }
  if (normalized === "agent" || normalized === "task") {
    return "subagent";
  }
  if (normalized === "skill") {
    return "skill";
  }
  if (normalized === "webfetch" || normalized === "websearch") {
    return "fetch";
  }
  return "tool";
}

function stringifyToolResult(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((part) => (typeof part === "string" ? part : stringFrom(part?.text)))
      .filter(Boolean)
      .join("");
    return text || stringifyHistoryPayload(value);
  }
  return stringifyHistoryPayload(value);
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

