import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

export const codexHistoryReader: ProviderHistoryReader<string> = {
  read: ({ runtimeSessionId }) => readCodexHistorySource(runtimeSessionId),
  toEvents: (raw) => parseCodexJsonlEvents(raw),
};

export async function loadCodexHistory(
  runtimeSessionId: string,
): Promise<AcpAuthoritativeHistory | null> {
  const raw = await readCodexHistorySource(runtimeSessionId);
  if (!raw) {
    return null;
  }
  return parseCodexJsonlHistory(raw);
}

export function parseCodexJsonlHistory(raw: string): AcpAuthoritativeHistory {
  return buildAuthoritativeHistoryFromEvents(parseCodexJsonlEvents(raw));
}

function parseCodexJsonlEvents(raw: string): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  for (const [lineIndex, line] of raw.split(/\r?\n/u).entries()) {
    const entry = parseJsonLine(line);
    if (!entry || entry.type !== "response_item") {
      continue;
    }
    const payload = entry.payload;
    const timestamp = stringFrom(entry.timestamp);
    if (!timestamp) {
      continue;
    }

    if (payload?.type === "message") {
      const role = normalizeHistoryMessageRole(payload.role);
      if (!role) {
        continue;
      }
      const id = stringFrom(payload.id ?? payload.message_id) ?? `codex:message:${lineIndex}`;
      appendCodexMessage({
        events,
        id,
        payload,
        role,
        timestamp,
      });
      continue;
    }

    if (payload?.type === "reasoning") {
      const thinking = collectCodexText(payload.content) || collectCodexText(payload.summary);
      if (!thinking) {
        continue;
      }
      const id = stringFrom(payload.id) ?? `codex:thinking:${lineIndex}`;
      events.push({
        kind: "thinking",
        id,
        text: thinking,
        timestamp,
      });
      continue;
    }

    if (payload?.type === "function_call") {
      const id = stringFrom(payload.call_id ?? payload.callId ?? payload.id);
      if (!id) {
        continue;
      }
      const title = codexToolTitle(payload);
      events.push({
        kind: "tool_call",
        id,
        toolKind: inferCodexToolKind(title),
        title,
        status: "running",
        ...(stringFrom(payload.arguments) ? { input: stringFrom(payload.arguments) } : {}),
        timestamp,
      });
      continue;
    }

    if (payload?.type === "function_call_output") {
      const id = stringFrom(payload.call_id ?? payload.callId ?? payload.id);
      if (!id) {
        continue;
      }
      const output = stringifyCodexOutput(payload.output);
      events.push({
        kind: "tool_result",
        id,
        status: "completed",
        ...(output ? { output } : {}),
        timestamp,
      });
    }
  }

  return events;
}

async function readCodexHistorySource(runtimeSessionId: string) {
  const historyPath = resolveCodexHistoryPath(runtimeSessionId);
  if (!historyPath) {
    return null;
  }
  return readFile(historyPath, "utf8");
}

function resolveCodexHistoryPath(runtimeSessionId: string) {
  const fileName = runtimeSessionId.endsWith(".jsonl")
    ? runtimeSessionId
    : `${runtimeSessionId}.jsonl`;
  const configDir = resolveCodexConfigDir();
  for (const historyDir of [join(configDir, "sessions"), join(configDir, "archived_sessions")]) {
    if (!existsSync(historyDir)) {
      continue;
    }
    const historyPath = findFileNamed(historyDir, fileName);
    if (historyPath) {
      return historyPath;
    }
  }
  return null;
}

function resolveCodexConfigDir() {
  return process.env.CODEX_HOME
    || (process.env.USERPROFILE
      ? join(process.env.USERPROFILE, ".codex")
      : process.env.HOME
        ? join(process.env.HOME, ".codex")
        : join(homedir(), ".codex"));
}

function findFileNamed(root: string, fileName: string) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) {
        return path;
      }
    }
  }
  return null;
}

function appendCodexMessage({
  events,
  id,
  payload,
  role,
  timestamp,
}: {
  events: HistoryEvent[];
  id: string;
  payload: any;
  role: "user" | "assistant" | "system";
  timestamp: string;
}) {
  const text = collectCodexText(payload.content);
  const attachments = role === "user" ? collectHistoryImageAttachments(payload.content, id) : [];
  if (!text && !attachments.length) {
    return;
  }
  events.push({
    kind: "message",
    id,
    role,
    ...(text ? { text } : {}),
    timestamp,
    ...(attachments.length ? { attachments } : {}),
  });
}

function collectCodexText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => typeof part === "string" ? part : stringFrom(part?.text))
    .filter(Boolean)
    .join("");
}

function codexToolTitle(payload: any) {
  const name = stringFrom(payload.name) ?? "tool";
  const namespace = stringFrom(payload.namespace);
  return namespace ? `${namespace}.${name}` : name;
}

function inferCodexToolKind(title: string): AgentToolCallKind {
  const normalized = title.toLowerCase();
  if (isCodexSubagentTool(normalized)) {
    return "subagent";
  }
  if (normalized.includes("shell") || normalized.includes("powershell")) {
    return "shell";
  }
  if (normalized.includes("read") || normalized.includes("open")) {
    return "read";
  }
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "write";
  }
  if (normalized.includes("search") || normalized.includes("find") || normalized.includes("rg")) {
    return "search";
  }
  if (normalized.includes("mcp")) {
    return "mcp";
  }
  return "tool";
}

function isCodexSubagentTool(normalized: string) {
  return /(?:^|[.\s_-])(?:agent|subagents?|delegate[_-]?task|spawn[_-]?agents?(?:[_-]?on[_-]?csv)?)(?:$|[.\s_-])/u.test(normalized);
}

function stringifyCodexOutput(value: unknown) {
  return stringifyHistoryPayload(value);
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
