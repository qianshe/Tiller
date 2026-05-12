import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@tiller/shared";
import type { AcpAuthoritativeHistory } from "../types";

const CLAUDE_HISTORY_MAX_FILE_BYTES = 16 * 1024 * 1024;

export async function loadClaudeJsonlHistory(
  runtimeSessionId: string,
): Promise<AcpAuthoritativeHistory | null> {
  const sessionId = runtimeSessionId.trim();
  if (!sessionId) {
    return null;
  }

  const historyFile = await findClaudeHistoryFile(sessionId);
  if (!historyFile) {
    return null;
  }

  return parseClaudeJsonlHistory(await readFile(historyFile, "utf8"));
}

export function parseClaudeJsonlHistory(raw: string): AcpAuthoritativeHistory {
  const messages: AgentMessage[] = [];
  let lineNumber = 0;

  for (const entry of parseJsonl(raw)) {
    lineNumber += 1;
    const message = normalizeClaudeMessageEntry(entry, lineNumber);
    if (message) {
      messages.push(message);
    }
  }

  return { messages: sortByTimestamp(messages), toolCalls: [] };
}

async function findClaudeHistoryFile(runtimeSessionId: string) {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  for (const file of await listJsonlFiles(join(claudeHome, "projects"))) {
    if (file.endsWith(`${runtimeSessionId}.jsonl`) || (await fileContainsSessionId(file, runtimeSessionId))) {
      return file;
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
    if (info.size > CLAUDE_HISTORY_MAX_FILE_BYTES) {
      return false;
    }
    const raw = await readFile(file, "utf8");
    return raw.includes(runtimeSessionId);
  } catch {
    return false;
  }
}

function normalizeClaudeMessageEntry(entry: any, lineNumber: number): AgentMessage | null {
  const role = normalizeRole(entry?.message?.role ?? entry?.type);
  const timestamp = timestampFrom(entry?.timestamp ?? entry?.message?.timestamp);
  const text = collectContentText(entry?.message?.content);
  const id = stringFrom(entry?.uuid ?? entry?.id ?? entry?.message?.id) ?? fallbackId(entry?.sessionId, lineNumber);
  if (!role || !timestamp || !text) {
    return null;
  }
  return { id, role, text, timestamp };
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
      return part?.type === "text" && typeof part.text === "string" ? part.text : "";
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

function fallbackId(sessionId: unknown, lineNumber: number) {
  const prefix = stringFrom(sessionId) ?? "claude";
  return `${prefix}-line-${lineNumber}`;
}

function sortByTimestamp<T extends { timestamp: string; id: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
}
