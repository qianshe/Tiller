import type { AgentMessage } from "@tiller/shared";

const PROVIDER_PARAGRAPH_MESSAGE_ID_PATTERN = /^(?<base>.+)#p\d+$/u;

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

    const duplicateProviderStream = resolveDuplicateProviderStreamMessage(
      last,
      incoming,
    );
    if (duplicateProviderStream === "skip-incoming") {
      return items;
    }
    if (duplicateProviderStream === "replace-current") {
      return [...items.slice(0, -1), { ...incoming, timestamp: last.timestamp }];
    }

    const duplicateAssistantText = resolveDuplicateAssistantText(last, incoming);
    if (duplicateAssistantText === "skip-incoming") {
      return items;
    }
    if (duplicateAssistantText === "replace-current") {
      return [...items.slice(0, -1), { ...incoming, timestamp: last.timestamp }];
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
      const duplicateStreamRange = findDuplicateAssistantStreamRange(
        merged,
        message,
      );
      if (duplicateStreamRange) {
        merged.splice(
          duplicateStreamRange.start,
          duplicateStreamRange.count,
          message,
        );
        continue;
      }

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
    ((isRuntimeGeneratedMessageId(current.id) &&
      isRuntimeGeneratedMessageId(incoming.id)) ||
      isSameProviderParagraphMessage(current.id, incoming.id))
  );
}

function isSameProviderParagraphMessage(leftId: string, rightId: string) {
  const leftBase = providerParagraphMessageBase(leftId);
  return Boolean(leftBase && leftBase === providerParagraphMessageBase(rightId));
}

function providerParagraphMessageBase(id: string) {
  return PROVIDER_PARAGRAPH_MESSAGE_ID_PATTERN.exec(id)?.groups?.base;
}

function resolveDuplicateProviderStreamMessage(
  current: AgentMessage,
  incoming: AgentMessage,
) {
  const currentBase = providerParagraphMessageBase(current.id);
  const incomingBase = providerParagraphMessageBase(incoming.id);

  if (incomingBase && current.id === incomingBase && current.text.includes(incoming.text)) {
    return "skip-incoming" as const;
  }

  if (currentBase && incoming.id === currentBase && incoming.text.includes(current.text)) {
    return "replace-current" as const;
  }

  return null;
}

function resolveDuplicateAssistantText(
  current: AgentMessage,
  incoming: AgentMessage,
) {
  if (current.role !== "assistant" || incoming.role !== "assistant") {
    return null;
  }
  if (current.id === incoming.id) {
    return null;
  }
  if (current.text === incoming.text || current.text.includes(incoming.text)) {
    return "skip-incoming" as const;
  }
  if (incoming.text.includes(current.text)) {
    return "replace-current" as const;
  }

  const normalizedCurrent = normalizeAssistantDuplicateText(current.text);
  const normalizedIncoming = normalizeAssistantDuplicateText(incoming.text);
  if (!normalizedCurrent || !normalizedIncoming) {
    return null;
  }
  if (normalizedCurrent === normalizedIncoming || normalizedCurrent.includes(normalizedIncoming)) {
    return "skip-incoming" as const;
  }
  if (normalizedIncoming.includes(normalizedCurrent)) {
    return "replace-current" as const;
  }
  return null;
}

function normalizeAssistantDuplicateText(text: string) {
  return text
    .replace(/[\s\u00a0]+/gu, "")
    .replace(/[•·*-]+/gu, "")
    .trim();
}

function findDuplicateAssistantStreamRange(
  messages: AgentMessage[],
  incoming: AgentMessage,
) {
  if (incoming.role !== "assistant") {
    return null;
  }

  let text = "";
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (!current || current.role !== "assistant") {
      break;
    }

    const nextText = `${current.text}${text}`;
    if (!incoming.text.endsWith(nextText)) {
      break;
    }

    start = index;
    text = nextText;
    if (text === incoming.text && isMergeableAssistantStreamRange(messages, start)) {
      return { start, count: messages.length - start };
    }
  }

  return null;
}

function isMergeableAssistantStreamRange(messages: AgentMessage[], start: number) {
  for (let index = start + 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (!previous || !current || !shouldMergeAssistantStreamChunk(previous, current)) {
      return false;
    }
  }
  return start < messages.length;
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
