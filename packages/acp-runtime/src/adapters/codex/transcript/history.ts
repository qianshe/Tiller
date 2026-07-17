import { existsSync, readFileSync } from "node:fs";
import type { AgentMessage } from "@tiller/shared";
import { createCachedTranscriptParser } from "../../transcript-cache";
import {
  resolveCodexTranscriptPath,
  type CodexTranscriptToolCallOptions,
} from "./tool-calls";

export type CodexTranscriptHistoryOptions = CodexTranscriptToolCallOptions;
export type CodexTranscriptCompactionSummaryOptions = CodexTranscriptHistoryOptions & {
  completedAt?: string;
};

type TimedCodexCompactionSummary = {
  summaryText: string;
  timestamp?: number;
};

const readCachedCodexTranscriptCompactions = createCachedTranscriptParser<
  CodexTranscriptCompactionSummaryOptions,
  TimedCodexCompactionSummary[]
>({
  cacheKey: (options) => [
    options.codexConfigDir ?? "",
    options.runtimeSessionId,
  ].join("\0"),
  resolvePath: resolveCodexTranscriptPath,
  parse: extractCodexCompactionsFromTranscriptText,
});

export function readCodexTranscriptMessagesFromDisk(
  options: CodexTranscriptHistoryOptions,
): AgentMessage[] {
  const path = resolveCodexTranscriptPath(options);
  if (!path || !existsSync(path)) {
    return [];
  }
  return extractCodexVisibleMessagesFromTranscriptText(readFileSync(path, "utf8"));
}

export function readCodexTranscriptCompactionSummaryFromDisk(
  options: CodexTranscriptCompactionSummaryOptions,
): string | undefined {
  return selectCodexCompactionSummary(
    readCachedCodexTranscriptCompactions(options) ?? [],
    options.completedAt,
  );
}

export function extractCodexCompactionSummaryFromTranscriptText(
  raw: string,
  options: Pick<CodexTranscriptCompactionSummaryOptions, "completedAt"> = {},
): string | undefined {
  return selectCodexCompactionSummary(
    extractCodexCompactionsFromTranscriptText(raw),
    options.completedAt,
  );
}

function extractCodexCompactionsFromTranscriptText(
  raw: string,
): TimedCodexCompactionSummary[] {
  const summaries: TimedCodexCompactionSummary[] = [];

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record || firstString(record.type) !== "compacted") {
      continue;
    }
    const payload = asRecord(record.payload);
    const summary = stripCodexCompactionWrapper(firstString(payload?.message));
    if (summary) {
      const timestamp = Date.parse(firstString(record.timestamp));
      summaries.push({
        summaryText: summary,
        timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
      });
    }
  }

  return summaries;
}

function selectCodexCompactionSummary(
  summaries: TimedCodexCompactionSummary[],
  completedAt: string | undefined,
): string | undefined {
  const parsedCompletedAt = completedAt
    ? Date.parse(completedAt)
    : Number.POSITIVE_INFINITY;
  const boundedCompletedAt = Number.isFinite(parsedCompletedAt)
    ? parsedCompletedAt
    : Number.POSITIVE_INFINITY;
  let latestSummary: string | undefined;
  for (const summary of summaries) {
    if (summary.timestamp !== undefined && summary.timestamp > boundedCompletedAt) {
      continue;
    }
    latestSummary = summary.summaryText;
  }
  return latestSummary;
}

export function extractCodexVisibleMessagesFromTranscriptText(raw: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let visibleSequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record || firstString(record.type) !== "response_item") {
      continue;
    }
    const payload = asRecord(record.payload);
    if (!payload || firstString(payload.type) !== "message") {
      continue;
    }
    const role = firstString(payload.role);
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractVisibleText(payload.content);
    if (!text) {
      continue;
    }
    visibleSequence += 1;
    messages.push({
      id: `codex-transcript-message-${visibleSequence}`,
      role,
      text,
      timestamp: firstString(record.timestamp) || new Date(0).toISOString(),
      sequence: visibleSequence,
    });
  }

  return messages;
}

function extractVisibleText(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const record = asRecord(part);
      const type = firstString(record?.type);
      if (type !== "input_text" && type !== "output_text" && type !== "text") {
        return "";
      }
      return firstString(record?.text).trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripCodexCompactionWrapper(text: string): string | undefined {
  const summary = text.replace(
    /^Another language model started to solve this problem[\s\S]*?assist with your own analysis:\s*/u,
    "",
  ).trim();
  return summary || undefined;
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
