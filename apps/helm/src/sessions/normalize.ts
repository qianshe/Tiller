import type { AgentMessage, AgentToolCall, AgentToolCallKind, CommandChunk } from "@tiller/shared";

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

    const last = merged.at(-1);
    if (!last || !shouldMergeAssistantStreamChunk(last, message)) {
      return [...merged, message];
    }

    merged[merged.length - 1] = mergeAgentMessageChunk(last, message);
    return merged;
  }, []);
}

export function mergeToolCall(current: AgentToolCall, incoming: AgentToolCall): AgentToolCall {
  return {
    ...current,
    ...incoming,
    kind: resolveToolCallKind(current.kind, incoming.kind),
    title: resolveToolCallTitle(current.title, incoming.title, incoming.id),
    output: mergeToolCallOutput(current.output, incoming.output),
    input: incoming.input ?? current.input,
    timestamp: current.timestamp,
    timelineSequence: current.timelineSequence ?? incoming.timelineSequence,
    updatedAt: incoming.updatedAt,
  };
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
  return [...items].sort((left, right) =>
    compareHistoryPosition(
      left.updatedAt || left.timestamp,
      left.id,
      right.updatedAt || right.timestamp,
      right.id,
    ),
  );
}

export function resolveToolCallKind(
  currentKind: AgentToolCallKind,
  incomingKind: AgentToolCallKind,
) {
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
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
  const timelineSequence = current.timelineSequence ?? incoming.timelineSequence;
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
  if (timelineSequence === undefined) {
    delete merged.timelineSequence;
  } else {
    merged.timelineSequence = timelineSequence;
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
