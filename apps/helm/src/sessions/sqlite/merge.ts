import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

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
    title: resolveToolCallTitle(current.title, incoming.title, incoming.id),
    output: `${current.output ?? ""}${incoming.output ?? ""}`,
    input: incoming.input ?? current.input,
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt,
  };
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

function shouldMergeAssistantStreamChunk(current: AgentMessage, incoming: AgentMessage) {
  return (
    current.role === "assistant" &&
    incoming.role === "assistant" &&
    isRuntimeGeneratedMessageId(current.id) &&
    isRuntimeGeneratedMessageId(incoming.id)
  );
}

function isRuntimeGeneratedMessageId(id: string) {
  return /-msg-\d+$/u.test(id);
}

function mergeAgentMessageChunk(current: AgentMessage, incoming: AgentMessage): AgentMessage {
  const isDuplicateText = current.text === incoming.text || current.text.endsWith(incoming.text);
  const isCumulativeSnapshot = incoming.text.startsWith(current.text);
  const nextText = isDuplicateText
    ? current.text
    : isCumulativeSnapshot
      ? incoming.text
      : `${current.text}${incoming.text}`;
  return {
    ...current,
    ...incoming,
    id: current.id,
    text: collapseRepeatedAssistantText(nextText),
    timestamp:
      isDuplicateText && Date.parse(incoming.timestamp) > Date.parse(current.timestamp)
        ? incoming.timestamp
        : current.timestamp,
  };
}

function collapseRepeatedAssistantText(text: string) {
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

function resolveToolCallTitle(currentTitle: string, incomingTitle: string, id: string) {
  if (isInformativeToolCallTitle(incomingTitle, id)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function compareHistoryPosition(
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
