import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AcpRuntimeProviderConfig, AgentToolCall } from "@tiller/shared";
import { collectHistoryImageAttachments } from "../history-content";
import {
  buildAuthoritativeHistoryFromEvents,
  collectTextPartValues,
  normalizeHistoryMessageRole,
  stringFrom,
  stringifyHistoryPayload,
  timestampFromMillis,
  type HistoryEvent,
} from "../history-events";
import type { ProviderHistoryReader } from "../history-reader";
import type { AcpAuthoritativeHistory } from "../types";
import { inferOpenCodeToolKind } from "./tool-calls";
import { extractOpenCodePlanFromToolCall } from "./plan-events";

const execFileAsync = promisify(execFile);
const OPENCODE_EXPORT_TIMEOUT_MS = 20_000;
const OPENCODE_EXPORT_MAX_BUFFER = 16 * 1024 * 1024;

export type OpenCodeHistorySource =
  | { kind: "export"; raw: string }
  | { kind: "sqlite"; messageRows: OpenCodeSqliteMessageRow[]; partRows: OpenCodeSqlitePartRow[] };

export const openCodeHistoryReader: ProviderHistoryReader<OpenCodeHistorySource> = {
  read: ({ provider, runtimeSessionId, cwd }) =>
    readOpenCodeHistorySource(provider, runtimeSessionId, cwd),
  toEvents: (source) =>
    source.kind === "export"
      ? parseOpenCodeExportEvents(source.raw)
      : parseOpenCodeSqliteEvents(source.messageRows, source.partRows),
  build: buildOpenCodeAuthoritativeHistoryFromEvents,
  options: { coalesceThinking: true },
};

export async function loadOpenCodeExportHistory(
  agent: AcpRuntimeProviderConfig,
  runtimeSessionId: string,
  cwd: string,
): Promise<AcpAuthoritativeHistory | null> {
  const source = await readOpenCodeHistorySource(agent, runtimeSessionId, cwd);
  if (!source) {
    return null;
  }
  return buildOpenCodeAuthoritativeHistoryFromEvents(openCodeHistoryReader.toEvents(source, {
    provider: agent,
    runtimeSessionId,
    cwd,
  }));
}

async function readOpenCodeHistorySource(
  agent: AcpRuntimeProviderConfig,
  runtimeSessionId: string,
  cwd: string,
): Promise<OpenCodeHistorySource | null> {
  if (!isOpenCodeCommand(agent.command)) {
    return null;
  }

  try {
    const stdout = await runOpenCodeExport(agent, runtimeSessionId, cwd);
    return { kind: "export", raw: stdout };
  } catch (error) {
    const sqliteSource = loadOpenCodeSqliteHistorySource(runtimeSessionId);
    if (sqliteSource) {
      return sqliteSource;
    }
    throw error;
  }
}

async function runOpenCodeExport(agent: AcpRuntimeProviderConfig, runtimeSessionId: string, cwd: string) {
  const options = {
    cwd,
    env: { ...process.env, ...agent.env },
    timeout: agent.initializeTimeoutMs ?? OPENCODE_EXPORT_TIMEOUT_MS,
    maxBuffer: OPENCODE_EXPORT_MAX_BUFFER,
    windowsHide: true,
  };
  try {
    const { stdout } = await execFileAsync(agent.command, ["export", runtimeSessionId], options);
    return stdout;
  } catch (error) {
    if (process.platform !== "win32" || !isNoEntryError(error)) {
      throw error;
    }
    const command = `& ${quotePowerShellArg(agent.command)} ${quotePowerShellArg("export")} ${quotePowerShellArg(runtimeSessionId)}`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      options,
    );
    return stdout;
  }
}

function isNoEntryError(error: unknown) {
  return Boolean(
    error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT",
  );
}

function quotePowerShellArg(value: string) {
  return `'${value.replace(/'/gu, "''")}'`;
}

function loadOpenCodeSqliteHistorySource(runtimeSessionId: string): OpenCodeHistorySource | null {
  const dbPath = process.env.OPENCODE_DB_PATH || join(homedir(), ".local", "share", "opencode", "opencode.db");
  if (!existsSync(dbPath)) {
    return null;
  }

  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const session = db.prepare("SELECT id FROM session WHERE id = ?").get(runtimeSessionId);
    if (!session) {
      return null;
    }
    const messages = db
      .prepare("SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC")
      .all(runtimeSessionId) as OpenCodeSqliteMessageRow[];
    const parts = db
      .prepare("SELECT id, message_id, time_created, time_updated, data FROM part WHERE session_id = ? ORDER BY time_created ASC")
      .all(runtimeSessionId) as OpenCodeSqlitePartRow[];
    return { kind: "sqlite", messageRows: messages, partRows: parts };
  } finally {
    db.close();
  }
}

export type OpenCodeSqliteMessageRow = {
  id: string;
  time_created: number;
  data: string;
};

export type OpenCodeSqlitePartRow = {
  id: string;
  message_id: string;
  time_created: number;
  time_updated?: number;
  data: string;
};

export function parseOpenCodeSqliteHistory(
  messageRows: OpenCodeSqliteMessageRow[],
  partRows: OpenCodeSqlitePartRow[],
): AcpAuthoritativeHistory {
  return buildOpenCodeAuthoritativeHistoryFromEvents(
    parseOpenCodeSqliteEvents(messageRows, partRows),
  );
}

function parseOpenCodeSqliteEvents(
  messageRows: OpenCodeSqliteMessageRow[],
  partRows: OpenCodeSqlitePartRow[],
): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const partsByMessageId = groupPartsByMessageId(partRows);

  for (const row of messageRows) {
    const messageData = parseJson(row.data);
    const parts = partsByMessageId.get(row.id) ?? [];
    const role = normalizeHistoryMessageRole(messageData?.role);
    const timestamp = timestampFromMillis(messageData?.time?.created ?? row.time_created);
    if (!role || !timestamp) {
      continue;
    }

    if (role === "assistant") {
      appendOpenCodeAssistantEvents({
        events,
        message: { id: row.id, parts },
        messageId: row.id,
        messageTimestamp: timestamp,
        parts,
      });
      continue;
    }

    appendOpenCodeMessage({
      events,
      id: row.id,
      parts,
      role,
      timestamp,
    });
  }

  return events;
}

function groupPartsByMessageId(partRows: OpenCodeSqlitePartRow[]) {
  const grouped = new Map<string, any[]>();
  for (const row of partRows) {
    const part = parseJson(row.data);
    if (!part) {
      continue;
    }
    const parts = grouped.get(row.message_id) ?? [];
    parts.push({
      id: row.id,
      time: { created: row.time_created, updated: row.time_updated },
      ...part,
    });
    grouped.set(row.message_id, parts);
  }
  return grouped;
}

function parseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseOpenCodeExportHistory(raw: string): AcpAuthoritativeHistory {
  return buildOpenCodeAuthoritativeHistoryFromEvents(parseOpenCodeExportEvents(raw));
}

export function buildOpenCodeAuthoritativeHistoryFromEvents(
  events: HistoryEvent[],
): AcpAuthoritativeHistory {
  const history = buildAuthoritativeHistoryFromEvents(events, openCodeHistoryReader.options);
  const plan = history.toolCalls
    .map((toolCall) => extractOpenCodePlanFromToolCall(toolCall))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .at(-1);
  return plan ? { ...history, plan } : history;
}

function parseOpenCodeExportEvents(raw: string): HistoryEvent[] {
  const parsed = JSON.parse(raw);
  const events: HistoryEvent[] = [];

  for (const message of Array.isArray(parsed?.messages) ? parsed.messages : []) {
    const messageId = stringFrom(message?.id ?? message?.info?.id);
    const role = normalizeHistoryMessageRole(message?.info?.role ?? message?.role);
    const timestamp = timestampFromMillis(message?.info?.time?.created ?? message?.time?.created);
    if (!messageId || !role || !timestamp) {
      continue;
    }

    if (role === "assistant") {
      appendOpenCodeAssistantEvents({
        events,
        message,
        messageId,
        messageTimestamp: timestamp,
        parts: Array.isArray(message?.parts) ? message.parts : [],
      });
      continue;
    }

    appendOpenCodeMessage({
      events,
      id: messageId,
      parts: message?.parts,
      role,
      timestamp,
    });
  }

  return events;
}

function appendOpenCodeMessage({
  events,
  id,
  parts,
  role,
  timestamp,
}: {
  events: HistoryEvent[];
  id: string;
  parts: unknown;
  role: "user" | "assistant" | "system";
  timestamp: string;
}) {
  const text = collectMessageText(parts, role);
  const attachments = role === "user" ? collectHistoryImageAttachments(parts, id) : [];
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

function appendOpenCodeAssistantEvents({
  events,
  message,
  messageId,
  messageTimestamp,
  parts,
}: {
  events: HistoryEvent[];
  message: any;
  messageId: string;
  messageTimestamp: string;
  parts: any[];
}) {
  let textPartIndex = 0;
  for (const part of parts) {
    if (part?.type === "text") {
      const text = stringFrom(part.text);
      if (text) {
        events.push({
          kind: "message",
          id: resolveOpenCodeTextMessageId(messageId, textPartIndex),
          role: "assistant",
          text,
          timestamp:
            timestampFromMillis(part?.time?.created ?? part?.time?.start) ?? messageTimestamp,
        });
        textPartIndex += 1;
      }
      continue;
    }

    if (part?.type === "reasoning") {
      const thinking = collectReasoningEvent(part, message);
      if (thinking) {
        events.push(thinking);
      }
      continue;
    }

    if (part?.type === "tool") {
      const toolCall = collectOpenCodeToolCallEvent(part);
      if (toolCall) {
        events.push(toolCall);
      }
    }
  }
}

function resolveOpenCodeTextMessageId(messageId: string, textPartIndex: number) {
  return textPartIndex === 0 ? messageId : `${messageId}#p${textPartIndex}`;
}

function collectOpenCodeToolCallEvent(part: any): HistoryEvent | null {
  const id = stringFrom(part.callID ?? part.callId ?? part.id);
  const state = part.state ?? {};
  const start = timestampFromMillis(
    state?.time?.start ?? part?.time?.start ?? state?.time?.created ?? part?.time?.created,
  );
  const end =
    timestampFromMillis(
      state?.time?.end ?? part?.time?.end ?? state?.time?.updated ?? part?.time?.updated,
    ) ?? start;
  if (!id || !start || !end) {
    return null;
  }
  const toolName = stringFrom(part.tool) ?? "tool";
  const title = stringFrom(state.title) || toolName || id;
  const input = stringifyToolPayload(state.input);
  const output = stringFrom(state.output);
  return {
    kind: "tool_call",
    id,
    toolKind: inferOpenCodeToolKind(toolName, title, state.input),
    title,
    status: normalizeToolStatus(state.status),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    timestamp: start,
    updatedAt: end,
  };
}

function collectReasoningEvent(
  part: any,
  message: any,
): HistoryEvent | null {
  const id = reasoningToolCallId(part, message);
  const output = stringFrom(part.text ?? part.reasoning ?? part.thinking);
  const timestamp = timestampFromMillis(part?.time?.start ?? part?.time?.created);
  const updatedAt = timestampFromMillis(part?.time?.end ?? part?.time?.updated) ?? timestamp;
  if (!id || !output || !timestamp || !updatedAt) {
    return null;
  }
  return {
    kind: "thinking",
    id,
    text: output,
    timestamp,
    updatedAt,
  };
}

function reasoningToolCallId(part: any, message: any) {
  const messageId = stringFrom(message?.id ?? message?.info?.id);
  if (messageId && stringFrom(part.sessionID ?? part.sessionId)) {
    return `${messageId}:thinking`;
  }
  return stringFrom(part.id) ?? `${messageId ?? "opencode"}:reasoning`;
}

function collectMessageText(parts: unknown, role: "user" | "assistant" | "system" | null) {
  const textParts = collectTextPartValues(parts);
  if (role === "user") {
    return normalizeOpenCodeUserTextParts(textParts);
  }
  return textParts.join("");
}

function normalizeOpenCodeUserTextParts(textParts: string[]) {
  if (textParts.length < 2) {
    return textParts.join("");
  }

  const candidates = textParts
    .map((text, index) => ({ index, text, normalized: normalizeForContainment(text) }))
    .filter((part) => part.normalized.length > 0)
    .sort((left, right) => left.normalized.length - right.normalized.length);

  const containedOriginal = candidates.find((candidate) =>
    candidates.some(
      (other) =>
        other.index !== candidate.index &&
        other.normalized.length > candidate.normalized.length &&
        other.normalized.includes(candidate.normalized),
    ),
  );

  return unwrapOpenCodeEnhancedPrompt(containedOriginal?.text ?? textParts.join(""));
}

function unwrapOpenCodeEnhancedPrompt(value: string) {
  const normalized = value.replace(/\r\n/gu, "\n").trim();
  if (!/^\[[a-z-]+-mode\]/iu.test(normalized)) {
    return value;
  }
  const sections = normalized.split(/\n---\n/u);
  const tail = sections.at(-1)?.trim();
  return tail || value;
}

function normalizeForContainment(value: string) {
  return value.replace(/\r\n/gu, "\n").trim();
}

function normalizeToolStatus(status: unknown): AgentToolCall["status"] {
  const raw = String(status ?? "completed").toLowerCase();
  if (raw === "error" || raw === "failed") {
    return "failed";
  }
  if (raw === "cancelled" || raw === "canceled") {
    return "cancelled";
  }
  if (raw === "pending") {
    return "pending";
  }
  if (raw === "running") {
    return "running";
  }
  return "completed";
}

function stringifyToolPayload(value: unknown) {
  return stringifyHistoryPayload(value);
}

function isOpenCodeCommand(command: string) {
  return /^opencode(?:\.exe)?$/iu.test(command);
}

