import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

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
  text: string;
  streams: Array<CommandChunk["stream"]>;
};

export function buildConversationTimeline(messages: AgentMessage[], commandChunks: CommandChunk[], toolCalls: AgentToolCall[]): ConversationTimelineItem[] {
  const messageItems: ConversationTimelineItem[] = coalesceDisplayMessages(messages).map((message) => ({
    kind: "message",
    timestamp: message.timestamp,
    message,
  }));
  const sourceToolCalls = toolCalls.length ? toolCalls : commandChunks.map(commandChunkToToolCall);
  const toolItems = groupToolCalls(sourceToolCalls);
  return [...messageItems, ...toolItems].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function groupToolCalls(calls: AgentToolCall[]): ConversationToolCallItem[] {
  const groups = new Map<string, ConversationToolCallItem>();
  for (const call of calls) {
    const key = call.commandId ?? call.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        kind: "tool",
        id: call.id,
        commandId: key,
        title: call.title || key,
        status: call.status,
        timestamp: call.updatedAt || call.timestamp,
        text: call.output ?? call.input ?? "",
        streams: call.stream ? [call.stream] : [],
      });
      continue;
    }

    current.text = `${current.text}${call.output ?? call.input ?? ""}`;
    current.timestamp = call.updatedAt || call.timestamp;
    current.status = call.status;
    current.title = call.title || current.title;
    if (call.stream && !current.streams.includes(call.stream)) {
      current.streams.push(call.stream);
    }
  }
  return Array.from(groups.values());
}

export function commandChunkToToolCall(chunk: CommandChunk): AgentToolCall {
  return {
    id: `tool-${chunk.commandId}`,
    kind: "terminal",
    title: chunk.commandId,
    status: chunk.stream === "stderr" ? "failed" : "running",
    commandId: chunk.commandId,
    output: chunk.text,
    stream: chunk.stream,
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
  };
}

export function mergeToolCallHistory(current: AgentToolCall[], incoming: AgentToolCall[]) {
  const merged = [...current];
  for (const next of incoming) {
    const index = merged.findIndex((item) => item.id === next.id);
    if (index === -1) {
      merged.push(next);
      continue;
    }

    const existing = merged[index];
    merged[index] = {
      ...existing,
      ...next,
      output: `${existing.output ?? ""}${next.output ?? ""}`,
      input: next.input ?? existing.input,
      updatedAt: next.updatedAt,
      status: next.status,
    };
  }
  return merged.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
}

export function coalesceDisplayMessages(items: AgentMessage[]) {
  return items.reduce<AgentMessage[]>((merged, item) => mergeAgentMessages(merged, item), []);
}

export function mergeAgentMessages(items: AgentMessage[], incoming: AgentMessage) {
  const last = items.at(-1);
  if (!last) {
    return [incoming];
  }

  if (last.role === incoming.role && last.role !== "system") {
    return [
      ...items.slice(0, -1),
      {
        ...last,
        text: `${last.text}${incoming.text}`,
        timestamp: incoming.timestamp,
      },
    ];
  }

  if (last.role === "system" && incoming.role === "system" && last.text === incoming.text) {
    return items;
  }

  return [...items, incoming];
}
