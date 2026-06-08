import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionUpdateRecord,
} from "@tiller/shared";
import {
  applySessionUpdateRecordToState,
  createEmptySessionUpdateReducerState,
  createSessionUpdateRecord,
  type SessionUpdateReducerState,
} from "./reducer";

type SessionUpdateContentInput = {
  sessionId: string;
  runtimeSessionId: string;
  providerId: string;
  source: SessionUpdateRecord["source"];
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  plan?: AgentPlan;
};

type OrderedRuntimeEvent = {
  event: SessionRuntimeEvent;
  order: number;
};

export function buildSessionUpdateRecordsFromContent(input: SessionUpdateContentInput): SessionUpdateRecord[] {
  return collectOrderedRuntimeEvents(input)
    .map(({ event }, index) =>
      createSessionUpdateRecord({
        sessionId: input.sessionId,
        runtimeSessionId: input.runtimeSessionId,
        providerId: input.providerId,
        source: input.source,
        sequence: index + 1,
        event,
      }),
    );
}

export function reduceSessionUpdateRecords(records: SessionUpdateRecord[]): SessionUpdateReducerState {
  return records.reduce(
    applySessionUpdateRecordToState,
    createEmptySessionUpdateReducerState(),
  );
}

function collectOrderedRuntimeEvents(input: SessionUpdateContentInput): OrderedRuntimeEvent[] {
  const events: OrderedRuntimeEvent[] = [
    ...input.messages.map((message) => ({
      event: { type: "message" as const, message },
      order: resolveOrder(message),
    })),
    ...input.toolCalls.map((toolCall) => ({
      event: { type: "tool-call" as const, toolCall },
      order: resolveOrder(toolCall),
    })),
    ...input.outputs.map((chunk) => ({
      event: { type: "command-output" as const, chunk },
      order: resolveOrder(chunk),
    })),
  ];
  if (input.diffs.length) {
    events.push({
      event: { type: "diff-update", files: input.diffs },
      order: Number.MAX_SAFE_INTEGER - 1,
    });
  }
  if (input.plan) {
    events.push({
      event: { type: "plan-update", plan: input.plan },
      order: Number.MAX_SAFE_INTEGER,
    });
  }
  return events
    .map((item, index) => ({ ...item, index }))
    .sort((left, right) => left.order - right.order || left.index - right.index);
}

function resolveOrder(item: { timelineSequence?: number; timestamp?: string }) {
  if (typeof item.timelineSequence === "number" && Number.isFinite(item.timelineSequence)) {
    return item.timelineSequence;
  }
  const timestamp = item.timestamp ? Date.parse(item.timestamp) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}
