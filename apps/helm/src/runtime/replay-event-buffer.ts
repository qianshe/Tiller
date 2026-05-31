import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import {
  buildSessionTimelineFromLegacy,
  type AgentMessage,
  type AgentToolCall,
  type AgentToolCallKind,
  type CommandChunk,
  type FileDiffSummary,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

type ReplayBufferContext = Pick<
  HelmHandlerContext,
  "sessionMessageStore" | "sessionArtifactStore" | "sessionTimelineStore" | "logInfo"
>;

export type RestoreReplayFlushCounts = {
  messages: number;
  toolCalls: number;
  outputs: number;
  diffs: number;
};

export function createRestoreReplayBuffer(sessionId: string, context: ReplayBufferContext) {
  const messages = new Map<string, AgentMessage>();
  const toolCalls = new Map<string, AgentToolCall>();
  const outputs = new Map<string, CommandChunk>();
  let diffs: FileDiffSummary[] | null = null;

  function snapshot() {
    return {
      messages: Array.from(messages.values()),
      toolCalls: Array.from(toolCalls.values()),
      outputs: Array.from(outputs.values()),
      diffs: diffs ?? [],
    };
  }

  return {
    add(event: SessionRuntimeEvent) {
      switch (event.type) {
        case "message":
          messages.set(event.message.id, event.message);
          return true;
        case "tool-call":
          upsertToolCall(toolCalls, event.toolCall);
          return true;
        case "command-output":
          outputs.set(event.chunk.id, event.chunk);
          if (event.toolCall) {
            upsertToolCall(toolCalls, event.toolCall);
          }
          return true;
        case "diff-update":
          diffs = event.files;
          return true;
        default:
          return false;
      }
    },
    snapshot,
    flush(): RestoreReplayFlushCounts {
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
      const counts = {
        messages: messages.size,
        toolCalls: toolCalls.size,
        outputs: outputs.size,
        diffs: diffs?.length ?? 0,
      };
      context.logInfo(
        `[tiller] 阶段=恢复重放缓存落盘 session=${sessionId} messages=${counts.messages} toolCalls=${counts.toolCalls} outputs=${counts.outputs} diffs=${counts.diffs}`,
      );
      messages.clear();
      toolCalls.clear();
      outputs.clear();
      diffs = null;
      return counts;
    },
  };

  function persistReplayTimeline() {
    if (!context.sessionTimelineStore) {
      return;
    }

    const entries = buildSessionTimelineFromLegacy({
      messages: Array.from(messages.values()),
      outputs: Array.from(outputs.values()),
      toolCalls: Array.from(toolCalls.values()),
    });
    if (entries.length) {
      context.sessionTimelineStore.replace(sessionId, entries);
    }
  }
}

function upsertToolCall(toolCalls: Map<string, AgentToolCall>, next: AgentToolCall) {
  const current = toolCalls.get(next.id);
  toolCalls.set(next.id, {
    ...current,
    ...next,
    kind: resolveToolCallKind(current?.kind, next.kind),
    title: resolveToolCallTitle(current?.title, next.title, next.id),
    timestamp: current?.timestamp ?? next.timestamp,
    input: next.input ?? current?.input,
    output: `${current?.output ?? ""}${next.output ?? ""}` || undefined,
  });
}

function resolveToolCallKind(
  currentKind: AgentToolCallKind | undefined,
  incomingKind: AgentToolCallKind,
) {
  if (!currentKind) return incomingKind;
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
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
