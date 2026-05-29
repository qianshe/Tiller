import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeLocalCommandMessageText } from "@tiller/shared";
import type { AgentMessage, AgentToolCall, AgentToolCallKind } from "@tiller/shared";
import type { AcpAuthoritativeHistory } from "../types";

export async function loadClaudeCodeHistory(
  runtimeSessionId: string,
  cwd: string,
): Promise<AcpAuthoritativeHistory | null> {
  const historyPath = resolveClaudeCodeHistoryPath(runtimeSessionId, cwd);
  if (!existsSync(historyPath)) {
    return null;
  }
  return parseClaudeCodeJsonlHistory(await readFile(historyPath, "utf8"));
}

export function parseClaudeCodeJsonlHistory(raw: string): AcpAuthoritativeHistory {
  const messages: AgentMessage[] = [];
  const toolCalls = new Map<string, AgentToolCall>();

  for (const line of raw.split(/\r?\n/u)) {
    const entry = parseJsonLine(line);
    if (!entry) {
      continue;
    }
    const timestamp = stringFrom(entry.timestamp);
    const role = normalizeMessageRole(entry.message?.role ?? entry.type);
    const content = entry.message?.content;
    const messageId = stringFrom(entry.uuid) ?? `claude:${messages.length + toolCalls.size}`;
    if (!timestamp || !role) {
      continue;
    }

    const text = collectClaudeText(content);
    if (text) {
      messages.push({ id: messageId, role, text, timestamp });
    }

    for (const [index, part] of asArray(content).entries()) {
      if (part?.type === "thinking") {
        if (text) {
          continue;
        }
        const thinking = stringFrom(part.thinking);
        if (!thinking) {
          continue;
        }
        const id = `${messageId}:thinking:${index}`;
        toolCalls.set(id, {
          id,
          commandId: id,
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: thinking,
          timestamp,
          updatedAt: timestamp,
        });
        continue;
      }

      if (part?.type === "tool_use") {
        const id = stringFrom(part.id);
        if (!id) {
          continue;
        }
        const title = stringFrom(part.name) ?? "Tool";
        toolCalls.set(id, {
          id,
          commandId: id,
          kind: inferClaudeToolKind(title),
          title,
          status: "running",
          ...(stringifyToolPayload(part.input) ? { input: stringifyToolPayload(part.input) } : {}),
          timestamp,
          updatedAt: timestamp,
        });
        continue;
      }

      if (part?.type === "tool_result") {
        const id = stringFrom(part.tool_use_id);
        if (!id) {
          continue;
        }
        const existing = toolCalls.get(id);
        const output = stringifyToolResult(part.content);
        if (existing) {
          toolCalls.set(id, {
            ...existing,
            status: part.is_error === true ? "failed" : "completed",
            ...(output ? { output } : {}),
            updatedAt: timestamp,
          });
        } else {
          toolCalls.set(id, {
            id,
            commandId: id,
            kind: "tool",
            title: id,
            status: part.is_error === true ? "failed" : "completed",
            ...(output ? { output } : {}),
            timestamp,
            updatedAt: timestamp,
          });
        }
      }
    }
  }

  return {
    messages: sortByTimestamp(messages),
    toolCalls: sortByTimestamp([...toolCalls.values()]),
  };
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

function collectClaudeText(content: unknown) {
  const raw =
    typeof content === "string"
      ? content
      : asArray(content)
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
  const normalized = normalizeLocalCommandMessageText(raw);
  return shouldHideClaudeLocalCommandOutput(normalized) ? "" : normalized;
}

function shouldHideClaudeLocalCommandOutput(text: string) {
  return /^Set model to\b/iu.test(text);
}

function normalizeMessageRole(role: unknown): AgentMessage["role"] | null {
  return role === "user" || role === "assistant" || role === "system" ? role : null;
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

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    return text || stringifyToolPayload(value);
  }
  return stringifyToolPayload(value);
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function sortByTimestamp<T extends { timestamp: string; id: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
}
