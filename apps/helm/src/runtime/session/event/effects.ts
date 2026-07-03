import type { AgentToolCall, CommandChunk } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { persistTimelineToolCall } from "../timeline-effects";
import { createSessionEventPublisher } from "./publisher";
import { resolveBroadcastToolCall } from "./normalizer";

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
  context.sessionArtifactStore.appendOutput(sessionId, chunk);
}

export function publishRuntimeCommandOutput(
  context: HelmHandlerContext,
  sessionId: string,
  chunk: CommandChunk,
  toolCall?: AgentToolCall,
) {
  recordRuntimeCommandOutputArtifact(context, sessionId, chunk);
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "command_output",
    commandId: chunk.commandId,
    chunk,
  });
  if (toolCall) {
    publishRuntimeToolCall(context, sessionId, toolCall);
  }
}
