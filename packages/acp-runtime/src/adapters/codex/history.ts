import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@tiller/shared";
import type { AcpAuthoritativeHistory } from "../types";

const CODEX_HISTORY_MAX_FILE_BYTES = 16 * 1024 * 1024;

export async function loadCodexJsonlHistory(
  _runtimeSessionId: string,
): Promise<AcpAuthoritativeHistory | null> {
  const runtimeSessionId = _runtimeSessionId.trim();
  if (!runtimeSessionId) {
    return null;
  }

  const historyFile = await findCodexHistoryFile(runtimeSessionId);
  if (!historyFile) {
    return null;
  }

  return parseCodexJsonlHistory(await readFile(historyFile, "utf8"));
}

export function parseCodexJsonlHistory(raw: string): AcpAuthoritativeHistory {
  const messages: AgentMessage[] = [];
  let sessionId: string | undefined;
  let lineNumber = 0;

  for (const entry of parseJsonl(raw)) {
    lineNumber += 1;
    if (entry?.type === "session_meta") {
      sessionId = stringFrom(entry?.payload?.id) ?? sessionId;
      continue;
    }

    const message = normalizeCodexMessageEntry(entry, sessionId, lineNumber);
    if (message) {
      messages.push(message);
    }
  }

  return { messages: sortByTimestamp(messages), toolCalls: [] };
}

async function findCodexHistoryFile(runtimeSessionId: string) {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const roots = [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];
  for (const root of roots) {
    for (const file of await listJsonlFiles(root)) {
      if (await fileContainsSessionId(file, runtimeSessionId)) {
        return file;
      }
    }
  }
  return null;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonlFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

async function fileContainsSessionId(file: string, runtimeSessionId: string) {
  try {
    const info = await stat(file);
    if (info.size > CODEX_HISTORY_MAX_FILE_BYTES) {
      return false;
    }
    const raw = await readFile(file, "utf8");
    return raw.includes(runtimeSessionId);
  } catch {
    return false;
  }
}

function normalizeCodexMessageEntry(
  entry: any,
  sessionId: string | undefined,
  lineNumber: number,
): AgentMessage | null {
  if (entry?.type === "response_item" && entry?.payload?.type === "message") {
    return messageFromParts({
      id: stringFrom(entry.payload.id) ?? fallbackId(sessionId, lineNumber),
      role: normalizeRole(entry.payload.role),
      timestamp: timestampFrom(entry.timestamp ?? entry.payload.timestamp),
      text: collectContentText(entry.payload.content),
    });
  }

  if (entry?.type === "user" && entry?.message?.role === "user") {
    return messageFromParts({
      id: stringFrom(entry.id ?? entry.message.id) ?? fallbackId(sessionId, lineNumber),
      role: "user",
      timestamp: timestampFrom(entry.timestamp ?? entry.message.timestamp),
      text: collectContentText(entry.message.content),
    });
  }

  return null;
}

function messageFromParts(parts: {
  id: string;
  role: AgentMessage["role"] | null;
  timestamp: string | undefined;
  text: string;
}): AgentMessage | null {
  if (!parts.role || !parts.timestamp || !parts.text) {
    return null;
  }
  return { id: parts.id, role: parts.role, text: parts.text, timestamp: parts.timestamp };
}

function collectContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (
        part?.type === "input_text" ||
        part?.type === "output_text" ||
        part?.type === "text"
      ) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .join("");
}

function parseJsonl(raw: string): any[] {
  const entries: any[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Ignore corrupt trailing/debug lines from provider-owned history files.
    }
  }
  return entries;
}

function normalizeRole(role: unknown): AgentMessage["role"] | null {
  return role === "user" || role === "assistant" ? role : null;
}

function timestampFrom(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function fallbackId(sessionId: string | undefined, lineNumber: number) {
  return sessionId ? `${sessionId}-line-${lineNumber}` : `codex-line-${lineNumber}`;
}

function sortByTimestamp<T extends { timestamp: string; id: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
}
