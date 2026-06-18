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

    if (!hasBoundary && hasOpenMarkdownFence(last.text)) {
      return replaceLastMessage(
        items,
        last,
        incoming,
        combineAssistantText(last, incoming),
        incoming.timestamp,
      );
    }

    if (hasBoundary) {
      if (hasOpenMarkdownFence(last.text)) {
        return splitAssistantTextAtMarkdownBoundary(
          items,
          last,
          incoming,
          combineAssistantText(last, incoming),
          last.text.length,
        );
      }

      if (incoming.text.startsWith(last.text)) {
        return splitAssistantTextAtMarkdownBoundary(
          items,
          last,
          incoming,
          incoming.text,
          last.text.length,
        );
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
        : shouldMergeProviderParagraphs(last, incoming)
          ? joinProviderParagraphText(last.text, incoming.text)
          : `${last.text}${incoming.text}`;
      return [
        ...items.slice(0, -1),
        {
          ...last,
          ...incoming,
          id: last.id,
          text: collapseRepeatedAssistantText(nextText),
          timelineSequence: last.timelineSequence ?? incoming.timelineSequence,
          timestamp: incoming.timestamp,
        },
      ];
    }
  }

  if (
    last.role === "system" &&
    incoming.role === "system" &&
    normalizeSystemMessageText(last.text) === normalizeSystemMessageText(incoming.text)
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
      if (isDuplicateAssistantHistoryComposite(merged, message)) {
        continue;
      }

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
  if (left.role === "user") {
    return false;
  }

  const delta = Math.abs(
    Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  return Number.isFinite(delta) && delta < 10_000;
}

function combineAssistantText(current: AgentMessage, incoming: AgentMessage) {
  return incoming.text.startsWith(current.text)
    ? incoming.text
    : shouldMergeProviderParagraphs(current, incoming)
      ? joinProviderParagraphText(current.text, incoming.text)
      : `${current.text}${incoming.text}`;
}

function replaceLastMessage(
  items: AgentMessage[],
  current: AgentMessage,
  incoming: AgentMessage,
  text: string,
  timestamp = current.timestamp,
) {
  return [
    ...items.slice(0, -1),
    {
      ...current,
      ...incoming,
      id: current.id,
      text,
      timestamp,
    },
  ];
}

function splitAssistantTextAtMarkdownBoundary(
  items: AgentMessage[],
  current: AgentMessage,
  incoming: AgentMessage,
  combinedText: string,
  proposedIndex: number,
) {
  const splitIndex = findMarkdownSafeSplitIndex(combinedText, proposedIndex);
  if (splitIndex === null) {
    return replaceLastMessage(items, current, incoming, combinedText);
  }

  const prefixText = combinedText.slice(0, splitIndex);
  const deltaText = combinedText.slice(splitIndex);
  const nextItems =
    prefixText === current.text
      ? items
      : replaceLastMessage(items, current, incoming, prefixText);
  return deltaText ? [...nextItems, { ...incoming, text: deltaText }] : nextItems;
}

function shouldMergeAssistantStreamChunk(
  current: AgentMessage,
  incoming: AgentMessage,
) {
  return (
    current.role === "assistant" &&
    incoming.role === "assistant" &&
    (shouldMergeRuntimeGeneratedMessageIds(current.id, incoming.id) ||
      isSameProviderParagraphMessage(current.id, incoming.id))
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
  return /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-s(?<segment>\d+)$/iu.exec(id)
    ?.groups?.segment;
}

function isSameProviderParagraphMessage(leftId: string, rightId: string) {
  const leftBase = providerParagraphMessageBase(leftId);
  return Boolean(leftBase && leftBase === providerParagraphMessageBase(rightId));
}

function shouldMergeProviderParagraphs(
  current: AgentMessage,
  incoming: AgentMessage,
) {
  return (
    current.role === "assistant" &&
    incoming.role === "assistant" &&
    isSameProviderParagraphMessage(current.id, incoming.id)
  );
}

function joinProviderParagraphText(
  currentText: string,
  incomingText: string,
) {
  if (!currentText) {
    return incomingText;
  }
  if (!incomingText) {
    return currentText;
  }
  if (/\n\s*\n$/u.test(currentText) || /^\s*\n/u.test(incomingText)) {
    return `${currentText}${incomingText}`;
  }
  return `${currentText}\n\n${incomingText}`;
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

function isDuplicateAssistantHistoryComposite(
  messages: AgentMessage[],
  incoming: AgentMessage,
) {
  if (incoming.role !== "assistant") {
    return false;
  }

  const normalizedIncoming = normalizeAssistantDuplicateText(incoming.text);
  if (normalizedIncoming.length < 32) {
    return false;
  }

  let normalizedRecent = "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (!current || current.role !== "assistant") {
      break;
    }

    normalizedRecent = `${normalizeAssistantDuplicateText(current.text)}${normalizedRecent}`;
    if (normalizedRecent.length < 32) {
      continue;
    }
    if (
      normalizedRecent.includes(normalizedIncoming) ||
      normalizedIncoming.includes(normalizedRecent)
    ) {
      return true;
    }
  }

  return false;
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

type MarkdownFenceState = {
  marker: "`" | "~";
  length: number;
};

function hasOpenMarkdownFence(text: string) {
  return Boolean(markdownFenceStateAt(text, text.length));
}

function findMarkdownSafeSplitIndex(text: string, proposedIndex: number) {
  const openFence = markdownFenceStateAt(text, proposedIndex);
  if (!openFence) {
    return proposedIndex;
  }

  const tail = text.slice(proposedIndex);
  const fenceLinePattern = /^[ \t]*(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gmu;
  let match: RegExpExecArray | null;
  while ((match = fenceLinePattern.exec(tail))) {
    const marker = match[1];
    if (
      marker?.[0] === openFence.marker &&
      marker.length >= openFence.length
    ) {
      return proposedIndex + match.index + match[0].length;
    }
  }

  return null;
}

function markdownFenceStateAt(text: string, endIndex: number) {
  const fenceLinePattern = /^[ \t]*(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gmu;
  let state: MarkdownFenceState | null = null;
  let match: RegExpExecArray | null;
  while ((match = fenceLinePattern.exec(text))) {
    if (match.index >= endIndex) {
      break;
    }
    const marker = match[1];
    if (!marker) {
      continue;
    }
    const markerKind = marker[0] as "`" | "~";
    if (state && state.marker === markerKind && marker.length >= state.length) {
      state = null;
      continue;
    }
    if (!state) {
      state = { marker: markerKind, length: marker.length };
    }
  }
  return state;
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

export function normalizeSystemMessageText(text: string) {
  return text.replace(/\(request id: [^)]*\)/gu, "").replace(/\s+/gu, " ").trim();
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
