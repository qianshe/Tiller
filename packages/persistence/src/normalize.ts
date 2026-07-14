import {
  compactBinaryToolCallOutput,
  collapseRepeatedStreamingText,
  mergeStreamingText,
  type AgentMessage,
  type AgentToolCall,
  type AgentToolCallKind,
  type CommandChunk,
} from "@tiller/shared";
import {
  findEquivalentReplayDuplicateMessageIndex,
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  resolveStructuredToolName,
} from "@tiller/shared";

export function mergeSessionMessage(messages: AgentMessage[], message: AgentMessage) {
  return normalizeSessionMessages([...messages, message]);
}

export function normalizeSessionMessages(messages: AgentMessage[]) {
  return messages.reduce<AgentMessage[]>((merged, message) => {
    const existingIndex = merged.findIndex((item) => item.id === message.id);
    if (existingIndex !== -1) {
      merged[existingIndex] = mergeAgentMessageChunk(merged[existingIndex]!, message);
      return merged;
    }

    if (findEquivalentReplayDuplicateMessageIndex(merged, message) !== -1) {
      return merged;
    }

    const last = merged.at(-1);
    if (!last || !shouldMergeAssistantStreamChunk(last, message)) {
      return [...merged, message];
    }

    merged[merged.length - 1] = mergeAgentMessageChunk(last, message);
    return merged;
  }, []);
}

export function mergeToolCall(current: AgentToolCall, incoming: AgentToolCall): AgentToolCall {
  return compactBinaryToolCallOutput({
    ...current,
    ...incoming,
    // Live ACP mapper classification is immutable; this merge only updates
    // payload/status for an already identified entity.
    kind: current.kind,
    title: resolveToolCallTitle(current.title, incoming.title, incoming.id),
    mcp: incoming.mcp ?? current.mcp,
    output: mergeToolCallOutput(current.output, incoming.output),
    input: incoming.input ?? current.input,
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
    updatedAt: incoming.updatedAt,
  });
}

export function mergeToolCallOutput(currentOutput: string | undefined, incomingOutput: string | undefined) {
  return mergeStreamingText(currentOutput, incomingOutput);
}

export function sortCommandChunks(items: CommandChunk[]) {
  return sortSequencedItems(items);
}

export function sortToolCalls(items: AgentToolCall[]) {
  return sortSequencedItems(items);
}

function sortSequencedItems<T extends { sequence?: number }>(items: T[]) {
  if (!items.every((item) => typeof item.sequence === "number")) {
    return [...items];
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.sequence! - right.item.sequence! || left.index - right.index)
    .map(({ item }) => item);
}

export function isLegacyToolKindMoreSpecific(
  incomingKind: AgentToolCallKind,
  currentKind: AgentToolCallKind,
) {
  const rank: Record<AgentToolCallKind, number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 3,
    read: 3,
    diagnostics: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return rank[incomingKind] > rank[currentKind];
}

export function normalizeLegacyPersistedAgentToolCall(
  toolCall: AgentToolCall | null,
): AgentToolCall | null {
  if (!toolCall) {
    return null;
  }

  const normalizedKind = normalizeLegacyPersistedAgentToolCallKind(toolCall.kind);
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: toolCall.input,
    title: toolCall.title,
    rawTitle: toolCall.mcp?.rawTitle,
  });
  if (!mcp || (normalizedKind !== "mcp" && !isLegacyToolKindMoreSpecific("mcp", normalizedKind))) {
    return compactBinaryToolCallOutput({ ...toolCall, kind: normalizedKind });
  }

  return compactBinaryToolCallOutput({
    ...toolCall,
    kind: "mcp",
    title: resolveQualifiedMcpToolCallTitle(mcp),
    mcp,
  });
}

export function resolveToolCallTitle(currentTitle: string, incomingTitle: string, id: string) {
  if (isInformativeToolCallTitle(incomingTitle, id) && !isFallbackToolCallTitle(incomingTitle)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

export function isFallbackToolCallTitle(title: string | undefined) {
  return /^Tool call\b/u.test(title?.trim() ?? "");
}

export function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function resolveQualifiedMcpToolCallTitle(mcp: NonNullable<AgentToolCall["mcp"]>) {
  return formatAgentToolCallMcpTitle(mcp);
}

function normalizeLegacyPersistedAgentToolCallKind(value: unknown): AgentToolCallKind {
  if (value === "terminal") return "shell";
  if (value === "edit") return "write";
  return typeof value === "string"
    ? ([
      "mcp",
      "skill",
      "read",
      "diagnostics",
      "write",
      "search",
      "shell",
      "fetch",
      "think",
      "todo",
      "subagent",
      "tool",
      "unknown",
    ] as const).includes(value as AgentToolCallKind)
      ? (value as AgentToolCallKind)
      : "unknown"
    : "unknown";
}

function toolNameFromInput(input: string | undefined) {
  return resolveStructuredToolName(input);
}

function primitiveStringFrom(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function shouldMergeAssistantStreamChunk(current: AgentMessage, incoming: AgentMessage) {
  return (
    current.role === "assistant" &&
    incoming.role === "assistant" &&
    shouldMergeRuntimeGeneratedMessageIds(current.id, incoming.id)
  );
}

function shouldMergeRuntimeGeneratedMessageIds(leftId: string, rightId: string) {
  if (!isRuntimeGeneratedMessageId(leftId) || !isRuntimeGeneratedMessageId(rightId)) {
    return false;
  }

  const leftSegment = normalizedRuntimeSegmentId(leftId);
  const rightSegment = normalizedRuntimeSegmentId(rightId);
  if (leftSegment || rightSegment) {
    return Boolean(leftSegment && leftSegment === rightSegment);
  }

  return true;
}

function normalizedRuntimeSegmentId(id: string) {
  const match = /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-(?:(?:s(?<legacySegment>\d+))|(?<orderedSegment>\d{6}-\d{6})-[pc][a-z0-9]{1,32})$/iu.exec(id);
  return match?.groups?.legacySegment ?? match?.groups?.orderedSegment;
}

function isRuntimeGeneratedMessageId(id: string) {
  return /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-(?:[a-z0-9]+|\d{6}-\d{6}-[pc][a-z0-9]{1,32})$/iu.test(id);
}

function mergeAgentMessageChunk(current: AgentMessage, incoming: AgentMessage): AgentMessage {
  const nextText = mergeStreamingText(current.text, incoming.text) ?? current.text;
  const isDuplicateText = nextText === current.text;
  const sequence = current.sequence ?? incoming.sequence;
  const merged: AgentMessage = {
    ...current,
    ...incoming,
    id: current.id,
    text: collapseRepeatedAssistantText(nextText),
    timestamp:
      isDuplicateText && Date.parse(incoming.timestamp) > Date.parse(current.timestamp)
        ? incoming.timestamp
        : current.timestamp,
  };
  if (sequence === undefined) {
    delete merged.sequence;
  } else {
    merged.sequence = sequence;
  }
  return merged;
}

function collapseRepeatedAssistantText(text: string) {
  const repeatedUnit = collapseRepeatedStreamingText(text);
  if (repeatedUnit !== text) {
    return repeatedUnit;
  }

  const firstLine = text.split(/\r?\n/u)[0]?.trim();
  if (!firstLine || firstLine.length < 8) {
    return text;
  }

  const repeatIndex = text.indexOf(firstLine, firstLine.length);
  if (repeatIndex === -1) {
    return text;
  }

  const bridgeIndex = text.lastIndexOf("我会按 `superpowers`", repeatIndex);
  const cutIndex =
    bridgeIndex !== -1 && repeatIndex - bridgeIndex < 240 ? bridgeIndex : repeatIndex;
  return text.slice(0, cutIndex).trimEnd();
}
