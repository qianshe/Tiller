import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import {
  type AgentMessage,
  type AgentPlan,
  type AgentToolCall,
  type AgentToolCallKind,
  type CommandChunk,
  type FileDiffSummary,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";
import {
  applySessionUpdateRecordToState,
  createEmptySessionUpdateReducerState,
  createSessionUpdateRecord,
} from "../session-updates/reducer";

type ReplayBufferContext = Pick<
  HelmHandlerContext,
  "sessionMessageStore" | "sessionArtifactStore" | "sessionTimelineStore" | "sessionUpdateStore"
>;

type ReplayBufferMetadata = {
  runtimeSessionId?: string;
  providerId?: string;
};

export type RestoreReplayFlushCounts = {
  messages: number;
  toolCalls: number;
  outputs: number;
  diffs: number;
  plans: number;
};

type RestoreReplayFlushOptions = {
  persistLocalStores?: boolean;
};

export function hasRestoreReplayContent(counts: RestoreReplayFlushCounts) {
  return counts.messages > 0 ||
    counts.toolCalls > 0 ||
    counts.outputs > 0 ||
    counts.diffs > 0 ||
    counts.plans > 0;
}

export function createRestoreReplayBuffer(
  sessionId: string,
  context: ReplayBufferContext,
  metadata: ReplayBufferMetadata = {},
) {
  const messages = new Map<string, AgentMessage>();
  const toolCalls = new Map<string, AgentToolCall>();
  const outputs = new Map<string, CommandChunk>();
  let diffs: FileDiffSummary[] | null = null;
  let plan: AgentPlan | undefined;
  let replayTimelineSequence = 0;
  const updates: ReturnType<typeof createSessionUpdateRecord>[] = [];
  const assistantSegmentIndexById = new Map<string, number>();
  let lastReplayEventType: SessionRuntimeEvent["type"] | null = null;
  let lastAssistantBaseId: string | null = null;

  function snapshot() {
    return {
      messages: Array.from(messages.values()),
      toolCalls: Array.from(toolCalls.values()),
      outputs: Array.from(outputs.values()),
      diffs: diffs ?? [],
      ...(plan ? { plan } : {}),
    };
  }

  return {
    add(event: SessionRuntimeEvent) {
      switch (event.type) {
        case "message": {
          const message = withReplayTimelineSequence(
            resolveReplayMessage(event.message),
            undefined,
          );
          upsertReplayMessage(messages, message);
          recordReplayUpdate(
            {
              ...event,
              message,
            },
            message.sequence,
          );
          return true;
        }
        case "tool-call": {
          const toolCall = withReplayTimelineSequence(event.toolCall, toolCalls.get(event.toolCall.id)?.sequence);
          upsertToolCall(toolCalls, toolCall);
          recordReplayUpdate(
            {
              ...event,
              toolCall,
            },
            toolCall.sequence,
          );
          lastReplayEventType = "tool-call";
          lastAssistantBaseId = null;
          return true;
        }
        case "command-output":
          const chunk = withReplayTimelineSequence(
            event.chunk,
            outputs.get(event.chunk.id)?.sequence,
          );
          outputs.set(chunk.id, chunk);
          let toolCall = event.toolCall
            ? withReplayTimelineSequence(
                event.toolCall,
                toolCalls.get(event.toolCall.id)?.sequence ?? chunk.sequence,
              )
            : undefined;
          if (event.toolCall) {
            upsertToolCall(toolCalls, toolCall!);
          }
          recordReplayUpdate({ ...event, chunk, toolCall }, chunk.sequence);
          lastReplayEventType = "command-output";
          lastAssistantBaseId = null;
          return true;
        case "diff-update":
          diffs = event.files;
          recordReplayUpdate(event);
          lastReplayEventType = "diff-update";
          lastAssistantBaseId = null;
          return true;
        case "plan-update":
          plan = event.plan;
          recordReplayUpdate(event);
          lastReplayEventType = "plan-update";
          lastAssistantBaseId = null;
          return true;
        default:
          lastReplayEventType = event.type;
          lastAssistantBaseId = null;
          return false;
      }
    },
    snapshot,
    flush(options: RestoreReplayFlushOptions = {}): RestoreReplayFlushCounts {
      if (options.persistLocalStores !== false) {
        for (const message of messages.values()) {
          context.sessionMessageStore.append(sessionId, message);
        }
        for (const output of outputs.values()) {
          context.sessionArtifactStore.appendOutput(sessionId, output);
        }
        for (const toolCall of toolCalls.values()) {
          context.sessionArtifactStore.appendToolCall(sessionId, toolCall);
        }
        if (diffs) {
          context.sessionArtifactStore.replaceDiffs(sessionId, diffs);
        }
        persistReplayTimeline();
      }
      context.sessionUpdateStore?.replaceSession?.(sessionId, [...updates]);
      const counts = {
        messages: messages.size,
        toolCalls: toolCalls.size,
        outputs: outputs.size,
        diffs: diffs?.length ?? 0,
        plans: plan ? 1 : 0,
      };
      messages.clear();
      toolCalls.clear();
      outputs.clear();
      diffs = null;
      plan = undefined;
      updates.splice(0, updates.length);
      return counts;
    },
  };

  function persistReplayTimeline() {
    if (!context.sessionTimelineStore) {
      return;
    }

    const entries = updates.reduce(
      applySessionUpdateRecordToState,
      createEmptySessionUpdateReducerState(),
    ).entries;
    if (entries.length) {
      context.sessionTimelineStore.replace(sessionId, entries);
    }
  }

  function withReplayTimelineSequence<T extends { sequence?: number }>(
    item: T,
    preferredSequence?: number,
  ): T {
    if (isFiniteTimelineSequence(item.sequence)) {
      replayTimelineSequence = Math.max(replayTimelineSequence, item.sequence);
      return item;
    }
    if (isFiniteTimelineSequence(preferredSequence)) {
      return { ...item, sequence: preferredSequence };
    }
    replayTimelineSequence += 1;
    return { ...item, sequence: replayTimelineSequence };
  }

  function recordReplayUpdate(event: SessionRuntimeEvent, sequence?: number) {
    updates.push(createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: metadata.runtimeSessionId ?? sessionId,
      providerId: metadata.providerId ?? "unknown",
      sequence: sequence ?? nextReplaySequence(),
      source: "acp_load_replay",
      event,
    }));
  }

  function nextReplaySequence() {
    replayTimelineSequence += 1;
    return replayTimelineSequence;
  }

  function resolveReplayMessage(message: AgentMessage) {
    if (message.role !== "assistant") {
      lastReplayEventType = "message";
      lastAssistantBaseId = null;
      return message;
    }

    const baseId = message.id.replace(/#p\d+$/u, "");
    const currentSegmentIndex = assistantSegmentIndexById.get(baseId) ?? 0;
    const continuesCurrentSegment =
      lastReplayEventType === "message" &&
      lastAssistantBaseId === baseId;

    if (!assistantSegmentIndexById.has(baseId)) {
      assistantSegmentIndexById.set(baseId, 0);
      lastReplayEventType = "message";
      lastAssistantBaseId = baseId;
      return message;
    }

    if (continuesCurrentSegment) {
      lastReplayEventType = "message";
      lastAssistantBaseId = baseId;
      return currentSegmentIndex === 0
        ? message
        : { ...message, id: `${baseId}#p${currentSegmentIndex}` };
    }

    const nextSegmentIndex = currentSegmentIndex + 1;
    assistantSegmentIndexById.set(baseId, nextSegmentIndex);
    lastReplayEventType = "message";
    lastAssistantBaseId = baseId;
    return { ...message, id: `${baseId}#p${nextSegmentIndex}` };
  }
}

function upsertReplayMessage(messages: Map<string, AgentMessage>, next: AgentMessage) {
  const current = messages.get(next.id);
  if (!current || current.role === next.role) {
    messages.set(next.id, next);
    return;
  }

  const collisionId = resolveRoleScopedMessageId(messages, next);
  messages.set(collisionId, { ...next, id: collisionId });
}

function resolveRoleScopedMessageId(messages: Map<string, AgentMessage>, message: AgentMessage) {
  const baseId = `${message.id}:${message.role}`;
  let candidateId = baseId;
  let suffix = 2;
  while (true) {
    const current = messages.get(candidateId);
    if (!current || current.role === message.role) {
      return candidateId;
    }
    candidateId = `${baseId}:${suffix}`;
    suffix += 1;
  }
}

function upsertToolCall(toolCalls: Map<string, AgentToolCall>, next: AgentToolCall) {
  const current = toolCalls.get(next.id);
  toolCalls.set(next.id, {
    ...current,
    ...next,
    kind: resolveToolCallKind(current, next),
    title: resolveToolCallTitle(current?.title, next.title, next.id),
    timestamp: current?.timestamp ?? next.timestamp,
    sequence: current?.sequence ?? next.sequence,
    input: next.input ?? current?.input,
    output: `${current?.output ?? ""}${next.output ?? ""}` || undefined,
  });
}

function isFiniteTimelineSequence(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveToolCallKind(
  current: AgentToolCall | undefined,
  incoming: AgentToolCall,
) {
  if (!current) return incoming.kind;
  if (shouldPreferSearchRepair(current, incoming)) {
    return incoming.kind;
  }
  return isHigherConfidenceToolKind(incoming.kind, current.kind) ? incoming.kind : current.kind;
}

function isHigherConfidenceToolKind(
  incomingKind: AgentToolCallKind,
  currentKind: AgentToolCallKind,
) {
  const rank: Record<AgentToolCallKind, number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 2,
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

function resolveToolCallTitle(
  currentTitle: string | undefined,
  incomingTitle: string,
  id: string,
) {
  if (isInformativeToolCallTitle(incomingTitle, id) && !isFallbackToolCallTitle(incomingTitle)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function isFallbackToolCallTitle(title: string | undefined) {
  return /^Tool call\b/u.test(title?.trim() ?? "");
}
