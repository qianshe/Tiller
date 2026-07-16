import type { AcpToolEvidenceContext } from "../types";
import { evidenceFromProjectedToolCall, type SubagentAction, type ToolEvidence } from "../../tool-recognition";
import { normalizeCodexToolCall } from "./tool-calls";

export function collectCodexToolEvidence(context: AcpToolEvidenceContext): ToolEvidence[] {
  const projected = normalizeCodexToolCall(context.observation.toolCall, context.observation.update);
  return evidenceFromProjectedToolCall({
    observation: context.observation,
    projected,
    subagentAction: projected.kind === "subagent"
      ? resolveCodexSubagentAction(context.observation.descriptor, context.observation.inputText)
      : undefined,
  });
}

function resolveCodexSubagentAction(descriptor: string, inputText?: string): SubagentAction {
  const text = `${descriptor} ${inputText ?? ""}`.toLowerCase();
  if (/\b(?:interrupt_agent|close_agent)\b/u.test(text)) return "cancel";
  if (/\b(?:list_agents)\b/u.test(text)) return "status";
  if (/\b(?:wait_agent)\b/u.test(text)) return "wait";
  if (/\b(?:send_message|send_input|followup_task|resume_agent)\b/u.test(text)) return "message";
  return "spawn";
}
