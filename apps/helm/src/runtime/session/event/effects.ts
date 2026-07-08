import type { AgentToolCall, CommandChunk } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { persistTimelineToolCall } from "../timeline-effects";
import { createSessionEventPublisher } from "./publisher";
import { resolveBroadcastToolCall } from "./normalizer";

const MAX_INLINE_COMMAND_OUTPUT_BYTES = 4 * 1024;
const COMMAND_OUTPUT_PREVIEW_CHARS = 1024;

export function recordRuntimeToolCallArtifact(
  context: HelmHandlerContext,
  sessionId: string,
  toolCall: AgentToolCall,
) {
  const artifacts = context.sessionArtifactStore.appendToolCall(sessionId, toolCall) as
    | { toolCalls?: AgentToolCall[] }
    | undefined;
  const mergedToolCall = resolveBroadcastToolCall(
    toolCall,
    artifacts?.toolCalls?.find((item) => item.id === toolCall.id),
  );
  return mergedToolCall;
}

export function publishRuntimeToolCall(
  context: HelmHandlerContext,
  sessionId: string,
  toolCall: AgentToolCall,
) {
  const mergedToolCall = recordRuntimeToolCallArtifact(context, sessionId, toolCall);
  if (!context.sessionTimelineWorkers || !context.sessionTimelineDispatcher || !context.sessionLiveStateStore) {
    persistTimelineToolCall(context, sessionId, mergedToolCall);
  }
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "tool_call",
    toolCall: mergedToolCall,
  });
  return mergedToolCall;
}

export function recordRuntimeCommandOutputArtifact(
  context: HelmHandlerContext,
  sessionId: string,
  chunk: CommandChunk,
) {
  const materialized = materializeCommandChunk(context, sessionId, chunk);
  context.sessionArtifactStore.appendOutput(sessionId, materialized);
  return materialized;
}

export function publishRuntimeCommandOutput(
  context: HelmHandlerContext,
  sessionId: string,
  chunk: CommandChunk,
) {
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "command_output",
    commandId: chunk.commandId,
    chunk,
  });
  return chunk;
}

function materializeCommandChunk(
  context: HelmHandlerContext,
  sessionId: string,
  chunk: CommandChunk,
) {
  const byteSize = Buffer.byteLength(chunk.text, "utf8");
  if (byteSize <= MAX_INLINE_COMMAND_OUTPUT_BYTES) {
    return {
      ...chunk,
      byteSize,
    };
  }
  const stored = context.sessionOutputBodyStore.putText({
    sessionId,
    outputId: chunk.id,
    text: chunk.text,
  });
  return {
    ...chunk,
    text: chunk.text.slice(0, COMMAND_OUTPUT_PREVIEW_CHARS),
    truncated: true,
    byteSize,
    contentRef: {
      id: stored.outputId,
      uri: stored.uri,
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
    },
  };
}
