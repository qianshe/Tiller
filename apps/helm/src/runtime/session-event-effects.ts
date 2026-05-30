import type { AgentToolCall, CommandChunk } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { createSessionEventPublisher } from "./session-event-publisher";
import { resolveBroadcastToolCall } from "./session-event-normalizer";
import { persistTimelineToolCall } from "./session-timeline-effects";

export function publishRuntimeToolCall(
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
  persistTimelineToolCall(context, sessionId, mergedToolCall);
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "tool_call",
    toolCall: mergedToolCall,
  });
  return mergedToolCall;
}

export function publishRuntimeCommandOutput(
  context: HelmHandlerContext,
  sessionId: string,
  chunk: CommandChunk,
  toolCall?: AgentToolCall,
) {
  context.sessionArtifactStore.appendOutput(sessionId, chunk);
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "command_output",
    commandId: chunk.commandId,
    chunk,
  });
  if (toolCall) {
    publishRuntimeToolCall(context, sessionId, toolCall);
  }
}
