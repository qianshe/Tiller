import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

import { coalesceDisplayMessages } from "./message-history";
import { resolveDisplayToolTitle, resolveMergedToolTitle } from "./tool-title";

export function sortAgentMessagesByTimeline(items: AgentMessage[]) {
  return items
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const timestampDelta =
        Date.parse(left.message.timestamp) -
        Date.parse(right.message.timestamp);
      return timestampDelta === 0 ? left.index - right.index : timestampDelta;
    })
    .map((entry) => entry.message);
}

export type ConversationTimelineItem =
  | { kind: "message"; timestamp: string; message: AgentMessage }
  | ConversationToolCallItem;

export type ConversationToolCallItem = {
  kind: "tool";
  id: string;
  commandId: string;
  timestamp: string;
  title: string;
  status: AgentToolCall["status"];
  toolKind: AgentToolCall["kind"];
  text: string;
  input: string;
  streams: Array<CommandChunk["stream"]>;
};

export function buildConversationTimeline(
  messages: AgentMessage[],
  commandChunks: CommandChunk[],
  toolCalls: AgentToolCall[],
): ConversationTimelineItem[] {
  const sourceToolCalls = toolCalls.length
    ? toolCalls
    : commandChunks.map(commandChunkToToolCall);
  const toolItems = groupToolCalls(sourceToolCalls);
  const messageItems: ConversationTimelineItem[] = coalesceDisplayMessages(
    messages,
    toolItems.map((item) => item.timestamp),
  ).map((message) => ({
    kind: "message",
    timestamp: message.timestamp,
    message,
  }));
  return [...messageItems, ...toolItems].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
}

export function resolvePendingToolActivity(calls: AgentToolCall[]) {
  const pending = calls
    .filter(
      (call) =>
        call.status === "pending" ||
        call.status === "running" ||
        call.status === "waiting_for_permission",
    )
    .sort(
      (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
    )
    .at(-1);
  if (!pending) {
    return null;
  }

  return {
    title: resolveDisplayToolTitle(pending, pending.commandId ?? pending.id),
    status: pending.status,
  };
}

export function groupToolCalls(
  calls: AgentToolCall[],
): ConversationToolCallItem[] {
  const groups = new Map<string, ConversationToolCallItem>();
  for (const call of calls) {
    const key = call.commandId ?? call.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        kind: "tool",
        id: call.id,
        commandId: key,
        title: resolveDisplayToolTitle(call, key),
        status: call.status,
        toolKind: call.kind,
        timestamp: call.timestamp,
        text: call.output ?? "",
        input: call.input ?? "",
        streams: call.stream ? [call.stream] : [],
      });
      continue;
    }

    current.text = `${current.text}${call.output ?? ""}`;
    current.input = current.input || call.input || "";
    if (Date.parse(call.timestamp) < Date.parse(current.timestamp)) {
      current.timestamp = call.timestamp;
    }
    current.status = call.status;
    current.toolKind = call.kind === "unknown" ? current.toolKind : call.kind;
    current.title = resolveMergedToolTitle(
      current.title,
      resolveDisplayToolTitle(call, key),
      call.id,
    );
    if (call.stream && !current.streams.includes(call.stream)) {
      current.streams.push(call.stream);
    }
  }
  return Array.from(groups.values());
}

export function commandChunkToToolCall(chunk: CommandChunk): AgentToolCall {
  return {
    id: `tool-${chunk.commandId}`,
    kind: "shell",
    title: chunk.commandId,
    status: chunk.stream === "stderr" ? "failed" : "running",
    commandId: chunk.commandId,
    output: chunk.text,
    stream: chunk.stream,
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
  };
}

export function mergeToolCallHistory(
  current: AgentToolCall[],
  incoming: AgentToolCall[],
) {
  const merged = [...current];
  for (const next of incoming) {
    const index = merged.findIndex((item) => item.id === next.id);
    if (index === -1) {
      merged.push(next);
      continue;
    }

    const existing = merged[index];
    if (!existing) {
      merged.push(next);
      continue;
    }
    merged[index] = {
      ...existing,
      ...next,
      kind: resolveToolCallKind(existing.kind, next.kind),
      title: resolveMergedToolTitle(existing.title, next.title, next.id),
      output: `${existing.output ?? ""}${next.output ?? ""}`,
      input: next.input ?? existing.input,
      timestamp:
        Date.parse(next.timestamp) < Date.parse(existing.timestamp)
          ? next.timestamp
          : existing.timestamp,
      updatedAt: next.updatedAt,
      status: next.status,
    };
  }
  return merged.sort(
    (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
  );
}

function resolveToolCallKind(
  currentKind: AgentToolCall["kind"],
  incomingKind: AgentToolCall["kind"],
) {
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
}

function isHigherConfidenceToolKind(
  incomingKind: AgentToolCall["kind"],
  currentKind: AgentToolCall["kind"],
) {
  const rank: Record<AgentToolCall["kind"], number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 3,
    read: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return rank[incomingKind] > rank[currentKind];
}

export {
  coalesceDisplayMessages,
  mergeAgentMessages,
  mergeMessageHistory,
  type MergeMessageHistoryOptions,
} from "./message-history";
