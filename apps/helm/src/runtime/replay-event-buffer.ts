import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentToolCall, CommandChunk, FileDiffSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

type ReplayBufferContext = Pick<
  HelmHandlerContext,
  "sessionMessageStore" | "sessionArtifactStore" | "logInfo"
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
}

function upsertToolCall(toolCalls: Map<string, AgentToolCall>, next: AgentToolCall) {
  const current = toolCalls.get(next.id);
  toolCalls.set(next.id, {
    ...current,
    ...next,
    timestamp: current?.timestamp ?? next.timestamp,
    input: next.input ?? current?.input,
    output: `${current?.output ?? ""}${next.output ?? ""}` || undefined,
  });
}
