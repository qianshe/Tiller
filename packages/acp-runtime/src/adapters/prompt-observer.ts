import type { AgentToolCall } from "@tiller/shared";
import type { AcpPromptObservationContext } from "./types";

export type PromptToolCallReader = (
  context: AcpPromptObservationContext,
) => AgentToolCall[];

export function safelyReadPromptToolCalls(
  reader: PromptToolCallReader,
  context: AcpPromptObservationContext,
): AgentToolCall[] {
  try {
    return reader(context);
  } catch {
    return [];
  }
}

export function fingerprintPromptToolCall(toolCall: AgentToolCall): string {
  return JSON.stringify([
    toolCall.kind,
    toolCall.title,
    toolCall.status,
    toolCall.input,
    toolCall.output,
    toolCall.updatedAt,
  ]);
}
