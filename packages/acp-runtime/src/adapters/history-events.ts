import type {
  AgentMessage,
  AgentPromptImageContent,
  AgentToolCall,
  AgentToolCallKind,
} from "@tiller/shared";
import type { AcpAuthoritativeHistory } from "./types";

export type HistoryMessageEvent = {
  kind: "message";
  id: string;
  role: AgentMessage["role"];
  text?: string;
  timestamp: string;
  attachments?: AgentPromptImageContent[];
};

export type HistoryThinkingEvent = {
  kind: "thinking";
  id: string;
  text: string;
  timestamp: string;
  updatedAt?: string;
};

export type HistoryToolCallEvent = {
  kind: "tool_call";
  id: string;
  title: string;
  toolKind?: AgentToolCallKind;
  status?: AgentToolCall["status"];
  input?: string;
  output?: string;
  timestamp: string;
  updatedAt?: string;
};

export type HistoryToolResultEvent = {
  kind: "tool_result";
  id: string;
  status?: AgentToolCall["status"];
  output?: string;
  timestamp: string;
};

export type HistoryEvent =
  | HistoryMessageEvent
  | HistoryThinkingEvent
  | HistoryToolCallEvent
  | HistoryToolResultEvent;

export type BuildAuthoritativeHistoryOptions = {
  coalesceThinking?: boolean;
};

export function buildAuthoritativeHistoryFromEvents(
  events: HistoryEvent[],
  options: BuildAuthoritativeHistoryOptions = {},
): AcpAuthoritativeHistory {
  const messages: AgentMessage[] = [];
  const toolCalls = new Map<string, AgentToolCall>();
  let timelineSequence = 0;
  const nextTimelineSequence = () => {
    timelineSequence += 1;
    return timelineSequence;
  };

  for (const event of events) {
    if (event.kind === "message") {
      appendHistoryMessage(messages, event, nextTimelineSequence());
      continue;
    }

    if (event.kind === "thinking") {
      const nextThinking: AgentToolCall = {
        id: event.id,
        commandId: event.id,
        kind: "think",
        title: "Thinking",
        status: "completed",
        output: event.text,
        timestamp: event.timestamp,
        updatedAt: event.updatedAt ?? event.timestamp,
        timelineSequence: nextTimelineSequence(),
      };
      const existing = toolCalls.get(event.id);
      toolCalls.set(
        event.id,
        options.coalesceThinking && existing?.kind === "think"
          ? mergeThinkingToolCalls(existing, nextThinking)
          : nextThinking,
      );
      continue;
    }

    if (event.kind === "tool_call") {
      toolCalls.set(event.id, {
        id: event.id,
        commandId: event.id,
        kind: event.toolKind ?? "tool",
        title: event.title,
        status: event.status ?? "running",
        ...(event.input ? { input: event.input } : {}),
        ...(event.output ? { output: event.output } : {}),
        timestamp: event.timestamp,
        updatedAt: event.updatedAt ?? event.timestamp,
        timelineSequence: nextTimelineSequence(),
      });
      continue;
    }

    const existing = toolCalls.get(event.id);
    if (existing) {
      toolCalls.set(event.id, {
        ...existing,
        status: event.status ?? "completed",
        ...(event.output ? { output: event.output } : {}),
        updatedAt: event.timestamp,
      });
      continue;
    }

    toolCalls.set(event.id, {
      id: event.id,
      commandId: event.id,
      kind: "tool",
      title: event.id,
      status: event.status ?? "completed",
      ...(event.output ? { output: event.output } : {}),
      timestamp: event.timestamp,
      updatedAt: event.timestamp,
      timelineSequence: nextTimelineSequence(),
    });
  }

  const resolvedToolCalls = options.coalesceThinking
    ? coalesceThinkingToolCalls([...toolCalls.values()])
    : [...toolCalls.values()];

  return {
    messages: sortByTimeline(messages),
    toolCalls: sortByTimeline(resolvedToolCalls),
  };
}

export function normalizeHistoryMessageRole(role: unknown): AgentMessage["role"] | null {
  return role === "user" || role === "assistant" || role === "system" ? role : null;
}

export function timestampFromMillis(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;
}

export function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function stringifyHistoryPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function collectTextPartValues(parts: unknown, textTypes = new Set(["text"])) {
  if (!Array.isArray(parts)) {
    return [];
  }
  return parts
    .filter((part) => textTypes.has(stringFrom(part?.type) ?? "") && typeof part.text === "string")
    .map((part) => part.text as string);
}

function appendHistoryMessage(
  messages: AgentMessage[],
  event: HistoryMessageEvent,
  timelineSequence: number,
) {
  const attachments = event.attachments?.length ? event.attachments : undefined;
  const text = event.text || (attachments ? `图片 ${attachments.length} 张` : "");
  if (!text && !attachments) {
    return;
  }
  messages.push({
    id: event.id,
    role: event.role,
    text,
    timestamp: event.timestamp,
    timelineSequence,
    ...(attachments ? { attachments } : {}),
  });
}

function coalesceThinkingToolCalls(toolCalls: AgentToolCall[]) {
  const coalesced = new Map<string, AgentToolCall>();
  const result: AgentToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (toolCall.kind !== "think") {
      result.push(toolCall);
      continue;
    }

    const existing = coalesced.get(toolCall.id);
    if (!existing) {
      const copy = { ...toolCall };
      coalesced.set(toolCall.id, copy);
      result.push(copy);
      continue;
    }

    Object.assign(existing, mergeThinkingToolCalls(existing, toolCall));
    coalesced.set(toolCall.id, existing);
  }

  return result;
}

function mergeThinkingToolCalls(left: AgentToolCall, right: AgentToolCall): AgentToolCall {
  return {
    ...left,
    output: [left.output, right.output].filter(Boolean).join("\n\n"),
    timestamp: right.timestamp < left.timestamp ? right.timestamp : left.timestamp,
    updatedAt: right.updatedAt > left.updatedAt ? right.updatedAt : left.updatedAt,
    timelineSequence: minOptionalTimelineSequence(left.timelineSequence, right.timelineSequence),
  };
}

function sortByTimeline<T extends { timestamp: string; id: string; timelineSequence?: number }>(
  items: T[],
) {
  return [...items].sort((left, right) => {
    const timelineDelta = compareOptionalTimelineSequence(
      left.timelineSequence,
      right.timelineSequence,
    );
    if (timelineDelta !== null) {
      return timelineDelta;
    }
    const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
}

function compareOptionalTimelineSequence(
  left: number | undefined,
  right: number | undefined,
) {
  if (left === undefined || right === undefined) {
    return null;
  }
  const delta = left - right;
  return delta === 0 ? null : delta;
}

function minOptionalTimelineSequence(left: number | undefined, right: number | undefined) {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.min(left, right);
}
