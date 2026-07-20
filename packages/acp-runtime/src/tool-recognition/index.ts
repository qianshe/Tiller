import type { AgentToolCall } from "@tiller/shared";
import { collectGenericToolEvidence } from "./classifier";
import { createToolLifecycleCorrelator } from "./lifecycle";
import { createToolObservation } from "./observation";
import { projectRecognizedToolCall } from "./projector";
import type { ToolEvidence, ToolObservation, ToolRecognitionResult } from "./types";

const lifecycle = createToolLifecycleCorrelator();

export function recognizeToolObservation(
  observation: ToolObservation,
  providerEvidence: ToolEvidence[] = [],
): ToolRecognitionResult {
  const evidence = [...collectGenericToolEvidence(observation), ...providerEvidence];
  const projected = projectRecognizedToolCall(observation, evidence);
  return {
    toolCalls: projected ? lifecycle.project(observation, projected, evidence) : [],
  };
}

export function recognizeToolCall(args: {
  providerId?: string;
  sessionId?: string;
  cwd?: string;
  toolCall: AgentToolCall;
  update?: unknown;
  providerEvidence?: ToolEvidence[];
}): ToolRecognitionResult {
  return recognizeToolObservation(createToolObservation(args), args.providerEvidence);
}

export function disposeToolRecognitionSession(providerId: string | undefined, sessionId: string): void {
  lifecycle.dispose(providerId, sessionId);
}

export { createToolObservation, promptEventsToToolObservations } from "./observation";
export { evidenceFromProjectedToolCall } from "./evidence";
export { classifyStructuredFileOperation } from "./file-operation";
export type { ToolEvidence, ToolObservation, ToolRecognitionResult, SubagentAction } from "./types";
