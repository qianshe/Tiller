import {
  compactBinaryToolCallOutput,
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
    kind: resolveMergedToolCallKind(current, incoming),
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
  if (!incomingOutput) {
    return currentOutput;
  }
  if (!currentOutput || incomingOutput.startsWith(currentOutput)) {
    return incomingOutput;
  }
  if (currentOutput.startsWith(incomingOutput)) {
    return currentOutput;
  }
  if (currentOutput.endsWith(incomingOutput)) {
    return currentOutput;
  }
  return `${currentOutput}${incomingOutput}`;
}

export function sortCommandChunks(items: CommandChunk[]) {
  return [...items].sort((left, right) =>
    compareHistoryPosition(left.timestamp, left.id, right.timestamp, right.id),
  );
}

export function sortToolCalls(items: AgentToolCall[]) {
  return [...items].sort(compareToolCallPosition);
}

function compareToolCallPosition(left: AgentToolCall, right: AgentToolCall) {
  const sequenceDelta = compareOptionalTimelineSequence(
    left.sequence,
    right.sequence,
  );
  if (sequenceDelta !== 0) {
    return sequenceDelta;
  }
  return compareHistoryPosition(
    left.timestamp || left.updatedAt,
    left.id,
    right.timestamp || right.updatedAt,
    right.id,
  );
}

function compareOptionalTimelineSequence(
  left: number | undefined,
  right: number | undefined,
) {
  if (left === undefined || right === undefined) {
    return 0;
  }
  return left - right;
}

export function resolveToolCallKind(
  currentKind: AgentToolCallKind,
  incomingKind: AgentToolCallKind,
) {
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
}

function resolveMergedToolCallKind(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (shouldPreferSearchRepair(current, incoming)) {
    return incoming.kind;
  }
  return resolveToolCallKind(current.kind, incoming.kind);
}

export function isHigherConfidenceToolKind(
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
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return rank[incomingKind] > rank[currentKind];
}

function shouldPreferSearchRepair(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  return current.kind === "shell" &&
    incoming.kind === "search" &&
    Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt);
}

export function normalizePersistedAgentToolCall(
  toolCall: AgentToolCall | null,
): AgentToolCall | null {
  if (!toolCall) {
    return null;
  }

  const normalizedKind = normalizePersistedAgentToolCallKind(toolCall.kind);
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: toolCall.input,
    title: toolCall.title,
    rawTitle: toolCall.mcp?.rawTitle,
  });
  if (!mcp || (normalizedKind !== "mcp" && !isHigherConfidenceToolKind("mcp", normalizedKind))) {
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

function normalizePersistedAgentToolCallKind(value: unknown): AgentToolCallKind {
  if (value === "terminal") return "shell";
  if (value === "edit") return "write";
  return typeof value === "string"
    ? ([
      "mcp",
      "skill",
      "read",
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

export function compareHistoryPosition(
  leftTimestamp: string,
  leftId: string,
  rightTimestamp: string,
  rightId: string,
) {
  const timestampDelta = Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return leftId.localeCompare(rightId);
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
  const isDuplicateText = current.text === incoming.text || current.text.endsWith(incoming.text);
  const isCumulativeSnapshot = incoming.text.startsWith(current.text);
  const nextText = isDuplicateText
    ? current.text
    : isCumulativeSnapshot
      ? incoming.text
      : `${current.text}${incoming.text}`;
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
  const repeatedUnit = collapseExactRepeatedText(text);
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

function collapseExactRepeatedText(text: string) {
  const minUnitLength = 40;
  const maxUnitLength = Math.floor(text.length / 2);
  for (let unitLength = minUnitLength; unitLength <= maxUnitLength; unitLength += 1) {
    if (text.length % unitLength !== 0) {
      continue;
    }

    const unit = text.slice(0, unitLength);
    let repeatsExactly = true;
    for (let index = unitLength; index < text.length; index += unitLength) {
      if (text.slice(index, index + unitLength) !== unit) {
        repeatsExactly = false;
        break;
      }
    }

    if (repeatsExactly) {
      return unit;
    }
  }
  return text;
}
