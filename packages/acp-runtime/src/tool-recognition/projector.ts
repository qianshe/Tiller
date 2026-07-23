import type { AgentToolCall } from "@tiller/shared";
import type { ToolEvidence, ToolObservation } from "./types";

export function projectRecognizedToolCall(
  observation: ToolObservation,
  evidence: ToolEvidence[],
): AgentToolCall | null {
  if (evidence.some((item) => item.suppress)) {
    return null;
  }
  const projected = { ...observation.toolCall };
  for (const item of evidence.slice().sort((left, right) => left.strength - right.strength)) {
    if (item.kind) projected.kind = item.kind;
    if (item.title) projected.title = item.title;
    if (item.status) projected.status = item.status;
    if (item.mcp) projected.mcp = item.mcp;
    if (item.commandId) projected.commandId = item.commandId;
    if (item.input !== undefined) projected.input = item.input;
    if (item.output !== undefined) projected.output = item.output;
    if (item.stream) projected.stream = item.stream;
    if (item.subagentOperation) projected.subagentOperation = item.subagentOperation;
  }
  return projected;
}
