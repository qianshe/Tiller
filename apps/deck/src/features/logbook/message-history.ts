import type { AgentMessage } from "@tiller/shared";

export function coalesceDisplayMessages(
  items: AgentMessage[],
  boundaryTimestamps: string[] = [],
) {
  const boundaryTimes = boundaryTimestamps
    .map((timestamp) => Date.parse(timestamp))
    .filter(Number.isFinite);
  return items.reduce<AgentMessage[]>(
    (merged, item) => mergeAgentMessages(merged, item, boundaryTimes),
    [],
  );
}

export function mergeAgentMessages(
  items: AgentMessage[],
  incoming: AgentMessage,
  boundaryTimes: number[] = [],
) {
  const last = items.at(-1);
  if (!last) {
    return [incoming];
  }

  if (last.role === incoming.role && last.role !== "system") {
    const hasBoundary = hasTimelineBoundaryBetween(
      last.timestamp,
      incoming.timestamp,
      boundaryTimes,
    );

    if (hasBoundary) {
      if (incoming.text.startsWith(last.text)) {
        const deltaText = incoming.text.slice(last.text.length);
        return deltaText ? [...items, { ...incoming, text: deltaText }] : items;
      }
      return [...items, incoming];
    }

    if (
      last.id === incoming.id ||
      shouldMergeAssistantStreamChunk(last, incoming)
    ) {
      const isCumulativeSnapshot = incoming.text.startsWith(last.text);
      const nextText = isCumulativeSnapshot
        ? incoming.text
        : `${last.text}${incoming.text}`;
      return [
        ...items.slice(0, -1),
        {
          ...last,
          ...incoming,
          id: last.id,
          text: collapseRepeatedAssistantText(nextText),
          timestamp: incoming.timestamp,
        },
      ];
    }
  }

  if (
    last.role === "system" &&
    incoming.role === "system" &&
    last.text === incoming.text
  ) {
    return items;
  }

  return [...items, incoming];
}

export type MergeMessageHistoryOptions = {
  mode?: "append" | "prepend";
};

export function mergeMessageHistory(
  current: AgentMessage[],
  incoming: AgentMessage[],
  options: MergeMessageHistoryOptions = {},
) {
  const merged = [...current];
  const source =
    options.mode === "prepend" ? [...incoming].reverse() : incoming;

  for (const message of source) {
    const index = merged.findIndex((item) => item.id === message.id);
    const equivalentIndex =
      index === -1
        ? merged.findIndex((item) => isEquivalentMessage(item, message))
        : -1;
    const mergeIndex = index === -1 ? equivalentIndex : index;

    if (mergeIndex === -1) {
      if (options.mode === "prepend") {
        merged.unshift(message);
      } else {
        merged.push(message);
      }
      continue;
    }

    const existing = merged[mergeIndex]!;
    merged[mergeIndex] = {
      ...existing,
      ...message,
      text:
        existing.text === message.text || existing.text.endsWith(message.text)
          ? existing.text
          : `${existing.text}${message.text}`,
      timestamp: existing.timestamp,
    };
  }

  return merged;
}

function isEquivalentMessage(left: AgentMessage, right: AgentMessage) {
  if (left.role !== right.role || left.text !== right.text) {
    return false;
  }

  const delta = Math.abs(
    Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  return Number.isFinite(delta) && delta < 10_000;
}

function shouldMergeAssistantStreamChunk(
  current: AgentMessage,
  incoming: AgentMessage,
) {
  return (
    current.role === "assistant" &&
    incoming.role === "assistant" &&
    isRuntimeGeneratedMessageId(current.id) &&
    isRuntimeGeneratedMessageId(incoming.id)
  );
}

function isRuntimeGeneratedMessageId(id: string) {
  return /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-[a-z0-9]+$/iu.test(id);
}

function hasTimelineBoundaryBetween(
  leftTimestamp: string,
  rightTimestamp: string,
  boundaryTimes: number[],
) {
  const leftTime = Date.parse(leftTimestamp);
  const rightTime = Date.parse(rightTimestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  const minTime = Math.min(leftTime, rightTime);
  const maxTime = Math.max(leftTime, rightTime);
  return boundaryTimes.some(
    (boundaryTime) => boundaryTime > minTime && boundaryTime <= maxTime,
  );
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
    bridgeIndex !== -1 && repeatIndex - bridgeIndex < 240
      ? bridgeIndex
      : repeatIndex;
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
