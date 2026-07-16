import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  SessionTimelineEntry,
  SessionUpdateRecord,
  SessionUpdateRecordPage,
} from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";
import { broadcastSessionUpdate } from "../../rpc/notifications";
import {
  applySessionUpdateRecordToState,
  type SessionUpdateReducerState,
} from "../../runtime/session-updates/reducer";
import type { HelmHandlerContext } from "../context";

type RepairTimelineParams = {
  sessionId: string;
  apply?: boolean;
};

type RepairTimelineReason = "no_journal" | "unsafe_gap" | "session_active";

type RepairTimelineResult = {
  sessionId: string;
  repairable: boolean;
  applied: boolean;
  updateCount: number;
  beforeEntryCount: number;
  afterEntryCount: number;
  changedEntryCount: number;
  reason?: RepairTimelineReason;
};

const UPDATE_PAGE_SIZE = 200;

export function repairTimeline(
  params: RepairTimelineParams,
  context: HelmHandlerContext,
): RepairTimelineResult {
  const currentEntries = context.sessionTimelineStore.list(params.sessionId) as SessionTimelineEntry[];
  const baseResult = {
    sessionId: params.sessionId,
    applied: false,
    updateCount: 0,
    beforeEntryCount: currentEntries.length,
    afterEntryCount: currentEntries.length,
    changedEntryCount: 0,
  };

  if (context.sessions.has(params.sessionId)) {
    return blockedResult(baseResult, "session_active");
  }

  const records = listAllSessionUpdates(params.sessionId, context);
  if (records.length === 0) {
    return blockedResult(baseResult, "no_journal");
  }
  baseResult.updateCount = records.length;

  const earliestSequence = records[0]!.sequence;
  const latestSequence = records.at(-1)!.sequence;
  const boundary = resolveSafeRepairBoundary(currentEntries, earliestSequence, latestSequence);
  if (!boundary.safe) {
    return blockedResult(baseResult, "unsafe_gap");
  }

  const prefix = currentEntries.slice(0, boundary.index);
  const seed = createReducerSeed(prefix);
  const reduced = records.reduce(applySessionUpdateRecordToState, seed);
  const repairedEntries = sortSessionTimelineEntries(reduced.entries);
  const changedEntryCount = countChangedEntries(currentEntries, repairedEntries);
  const result: RepairTimelineResult = {
    ...baseResult,
    repairable: true,
    afterEntryCount: repairedEntries.length,
    changedEntryCount,
  };

  if (!params.apply) {
    return result;
  }

  const persistedEntries = context.sessionTimelineStore.replace(
    params.sessionId,
    repairedEntries,
  ) as SessionTimelineEntry[];
  broadcastSessionUpdate(context, params.sessionId, {
    kind: "timeline_batch",
    batch: {
      replace: true,
      deliverySequence: 0,
      lastSequence: Math.max(latestSequence, resolveMaximumSequence(persistedEntries)),
      entries: persistedEntries,
    },
  });
  return {
    ...result,
    applied: true,
    afterEntryCount: persistedEntries.length,
    changedEntryCount: countChangedEntries(currentEntries, persistedEntries),
  };
}

function blockedResult(
  base: Omit<RepairTimelineResult, "repairable" | "reason">,
  reason: RepairTimelineReason,
): RepairTimelineResult {
  return {
    ...base,
    repairable: false,
    reason,
  };
}

function listAllSessionUpdates(
  sessionId: string,
  context: HelmHandlerContext,
): SessionUpdateRecord[] {
  const records: SessionUpdateRecord[] = [];
  const visitedCursors = new Set<string>();
  let before: string | undefined;
  while (true) {
    const page = context.sessionUpdateStore.listPage(sessionId, {
      limit: UPDATE_PAGE_SIZE,
      ...(before ? { before } : {}),
    }) as SessionUpdateRecordPage;
    records.push(...page.updates);
    if (!page.hasMore || !page.nextCursor || visitedCursors.has(page.nextCursor)) {
      break;
    }
    visitedCursors.add(page.nextCursor);
    before = page.nextCursor;
  }
  return records.sort((left, right) => left.sequence - right.sequence);
}

function resolveSafeRepairBoundary(
  entries: SessionTimelineEntry[],
  earliestSequence: number,
  latestSequence: number,
): { safe: true; index: number } | { safe: false } {
  if (resolveMaximumSequence(entries) > latestSequence) {
    return { safe: false };
  }
  const boundaryIndex = entries.findIndex((entry) =>
    collectEntrySequences(entry).some((sequence) => sequence >= earliestSequence)
  );
  if (boundaryIndex < 0) {
    return { safe: true, index: entries.length };
  }
  for (let index = 0; index < entries.length; index += 1) {
    const sequences = collectEntrySequences(entries[index]!);
    if (index < boundaryIndex && sequences.some((sequence) => sequence >= earliestSequence)) {
      return { safe: false };
    }
    if (index >= boundaryIndex && sequences.some((sequence) => sequence < earliestSequence)) {
      return { safe: false };
    }
    if (index >= boundaryIndex && sequences.length === 0) {
      return { safe: false };
    }
  }
  return { safe: true, index: boundaryIndex };
}

function createReducerSeed(entries: SessionTimelineEntry[]): SessionUpdateReducerState {
  const messages: AgentMessage[] = [];
  const toolCalls: AgentToolCall[] = [];
  const outputs: CommandChunk[] = [];
  let assistantBoundarySequence: number | undefined;

  for (const entry of entries) {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      messages.push(entry.message);
      continue;
    }
    if (entry.kind === "assistant_message") {
      const contentChunks = entry.chunks.filter((chunk) => chunk.kind === "content");
      const firstChunk = contentChunks[0];
      const lastChunk = contentChunks.at(-1);
      if (!firstChunk || !lastChunk) continue;
      messages.push({
        id: entry.id,
        role: "assistant",
        contentKind: "content",
        text: contentChunks.map((chunk) => chunk.text).join(""),
        timestamp: firstChunk.timestamp ?? entry.timestamp,
        sequence: entry.sequence ?? firstChunk.sequence,
        streaming: lastChunk.streaming,
        streamMode: lastChunk.streamMode,
      });
      continue;
    }
    if (entry.kind === "tool_call") {
      toolCalls.push(entry.toolCall);
      assistantBoundarySequence = maximumDefined(
        assistantBoundarySequence,
        entry.sequence,
        entry.toolCall.sequence,
      );
      continue;
    }
    if (entry.kind === "command_output") {
      outputs.push(entry.output);
      assistantBoundarySequence = maximumDefined(
        assistantBoundarySequence,
        entry.sequence,
        entry.output.sequence,
      );
    }
  }

  return {
    entries: [...entries],
    messages,
    toolCalls,
    outputs,
    diffs: [],
    ...(assistantBoundarySequence === undefined ? {} : { assistantBoundarySequence }),
  };
}

function collectEntrySequences(entry: SessionTimelineEntry): number[] {
  const sequences: Array<number | undefined> = [
    "sequence" in entry ? entry.sequence : undefined,
  ];
  if (entry.kind === "assistant_message") {
    sequences.push(...entry.chunks.map((chunk) => chunk.sequence));
  } else if (entry.kind === "tool_call") {
    sequences.push(entry.toolCall.sequence);
  } else if (entry.kind === "command_output") {
    sequences.push(entry.output.sequence);
  } else if (entry.kind === "user_message" || entry.kind === "system_message") {
    sequences.push(entry.message.sequence);
  }
  return sequences.filter((sequence): sequence is number =>
    typeof sequence === "number" && Number.isFinite(sequence)
  );
}

function resolveMaximumSequence(entries: SessionTimelineEntry[]) {
  return entries.reduce(
    (maximum, entry) => Math.max(maximum, ...collectEntrySequences(entry)),
    0,
  );
}

function maximumDefined(...values: Array<number | undefined>) {
  const defined = values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  return defined.length ? Math.max(...defined) : undefined;
}

function countChangedEntries(
  before: SessionTimelineEntry[],
  after: SessionTimelineEntry[],
) {
  const beforeById = new Map(before.map((entry, index) => [entry.id, { entry, index }]));
  const afterById = new Map(after.map((entry, index) => [entry.id, { entry, index }]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  let changed = 0;
  for (const id of ids) {
    const previous = beforeById.get(id);
    const next = afterById.get(id);
    if (
      !previous ||
      !next ||
      previous.index !== next.index ||
      JSON.stringify(previous.entry) !== JSON.stringify(next.entry)
    ) {
      changed += 1;
    }
  }
  return changed;
}
