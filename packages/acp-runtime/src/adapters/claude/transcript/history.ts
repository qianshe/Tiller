import { existsSync, readFileSync } from "node:fs";
import type { AgentMessage } from "@tiller/shared";
import type { AcpCompactionSummary } from "../../types";
import { createCachedTranscriptParser } from "../../transcript-cache";
import {
  resolveClaudeTranscriptPath,
  type ClaudeTranscriptPlanOptions,
} from "./plan";

export type ClaudeTranscriptHistoryOptions = ClaudeTranscriptPlanOptions;
export type ClaudeTranscriptCompactionSummaryOptions =
  ClaudeTranscriptHistoryOptions & {
    completedAt?: string;
  };

export type ClaudeTranscriptCompaction = AcpCompactionSummary & {
  timestamp: string;
};

type TimedClaudeCompactionSummary = AcpCompactionSummary & {
  timestamp?: number;
};

const MAX_COMPACTION_SUMMARY_MATCH_GAP_MS = 5 * 60 * 1000;

const readCachedClaudeTranscriptCompactions = createCachedTranscriptParser<
  ClaudeTranscriptCompactionSummaryOptions,
  TimedClaudeCompactionSummary[]
>({
  cacheKey: (options) => resolveClaudeTranscriptPath(options),
  resolvePath: resolveClaudeTranscriptPath,
  parse: extractClaudeCompactionsFromTranscriptText,
});

export function readClaudeTranscriptMessagesFromDisk(
  options: ClaudeTranscriptHistoryOptions,
): AgentMessage[] {
  const path = resolveClaudeTranscriptPath(options);
  if (!existsSync(path)) {
    return [];
  }
  return extractClaudeVisibleMessagesFromTranscriptText(
    readFileSync(path, "utf8"),
  );
}

export function readClaudeTranscriptCompactionSummaryFromDisk(
  options: ClaudeTranscriptCompactionSummaryOptions,
): string | undefined {
  return readClaudeTranscriptCompactionFromDisk(options)?.summaryText;
}

export function readClaudeTranscriptCompactionFromDisk(
  options: ClaudeTranscriptCompactionSummaryOptions,
): AcpCompactionSummary | undefined {
  return selectClaudeCompaction(
    readCachedClaudeTranscriptCompactions(options) ?? [],
    options.completedAt,
    MAX_COMPACTION_SUMMARY_MATCH_GAP_MS,
  );
}

export function readClaudeTranscriptCompactionsFromDisk(
  options: ClaudeTranscriptHistoryOptions,
): ClaudeTranscriptCompaction[] {
  return (readCachedClaudeTranscriptCompactions(options) ?? []).flatMap(
    ({ timestamp, ...summary }) =>
      timestamp === undefined
        ? []
        : [{ ...summary, timestamp: new Date(timestamp).toISOString() }],
  );
}

export function extractClaudeCompactionSummaryFromTranscriptText(
  raw: string,
  options: Pick<ClaudeTranscriptCompactionSummaryOptions, "completedAt"> = {},
): string | undefined {
  return extractClaudeCompactionFromTranscriptText(raw, options)?.summaryText;
}

export function extractClaudeCompactionFromTranscriptText(
  raw: string,
  options: Pick<ClaudeTranscriptCompactionSummaryOptions, "completedAt"> = {},
): AcpCompactionSummary | undefined {
  return selectClaudeCompaction(
    extractClaudeCompactionsFromTranscriptText(raw),
    options.completedAt,
  );
}

function extractClaudeCompactionsFromTranscriptText(
  raw: string,
): TimedClaudeCompactionSummary[] {
  const summaries: TimedClaudeCompactionSummary[] = [];

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record || record.isCompactSummary !== true) {
      continue;
    }
    const message = recordFrom(record.message);
    if (firstString(message.role) !== "user") {
      continue;
    }
    const summary = extractCompactSummaryText(message.content);
    if (summary) {
      const timestamp = Date.parse(firstString(record.timestamp));
      summaries.push({
        summaryText: summary,
        summaryMessageId: firstString(record.uuid) || undefined,
        timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
      });
    }
  }

  return summaries;
}

function selectClaudeCompaction(
  summaries: TimedClaudeCompactionSummary[],
  completedAt: string | undefined,
  maxGapMs?: number,
): AcpCompactionSummary | undefined {
  const parsedCompletedAt = completedAt
    ? Date.parse(completedAt)
    : Number.POSITIVE_INFINITY;
  const boundedCompletedAt = Number.isFinite(parsedCompletedAt)
    ? parsedCompletedAt
    : Number.POSITIVE_INFINITY;
  let latestSummary: AcpCompactionSummary | undefined;
  for (const { timestamp, ...summary } of summaries) {
    if (timestamp !== undefined && timestamp > boundedCompletedAt) {
      continue;
    }
    if (
      maxGapMs !== undefined &&
      (!Number.isFinite(parsedCompletedAt) ||
        timestamp === undefined ||
        boundedCompletedAt - timestamp > maxGapMs)
    ) {
      continue;
    }
    latestSummary = summary;
  }
  return latestSummary;
}

export function extractClaudeVisibleMessagesFromTranscriptText(
  raw: string,
): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let visibleSequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record) {
      continue;
    }
    const message = recordFrom(record.message);
    const role = firstString(message.role);
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractVisibleText(message.content, role);
    if (!text) {
      continue;
    }
    visibleSequence += 1;
    messages.push({
      id:
        firstString(record.uuid) ||
        `claude-transcript-message-${visibleSequence}`,
      role,
      text,
      timestamp: firstString(record.timestamp) || new Date(0).toISOString(),
      sequence: visibleSequence,
    });
  }

  return messages;
}

function extractVisibleText(content: unknown, role: "user" | "assistant") {
  if (typeof content === "string") {
    return isHiddenStringContent(content, role) ? "" : content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const record = recordFrom(part);
      return firstString(record.type) === "text"
        ? firstString(record.text).trim()
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isHiddenStringContent(content: string, role: "user" | "assistant") {
  const trimmed = content.trim();
  if (!trimmed) {
    return true;
  }
  if (role === "assistant") {
    return false;
  }
  return (
    trimmed.startsWith("<command-") ||
    trimmed.startsWith("<local-command-") ||
    trimmed.startsWith("Your tool call was malformed and could not be parsed.")
  );
}

function extractCompactSummaryText(content: unknown) {
  const text = extractVisibleText(content, "user");
  if (!text) {
    return undefined;
  }
  const lines = text.split(/\r?\n/u);
  const summaryStart = lines.findIndex((line) => line.trim() === "Summary:");
  if (summaryStart === -1) {
    return text;
  }
  const summaryEnd = lines.findIndex(
    (line, index) =>
      index > summaryStart &&
      line
        .trim()
        .startsWith("If you need specific details from before compaction"),
  );
  return (
    lines
      .slice(summaryStart + 1, summaryEnd === -1 ? undefined : summaryEnd)
      .join("\n")
      .trim() || undefined
  );
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return recordFrom(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}
