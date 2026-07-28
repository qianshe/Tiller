import type { AgentToolCall } from "@tiller/shared";
import type { AcpToolEvidenceContext } from "../types";
import { evidenceFromProjectedToolCall, type SubagentAction, type ToolEvidence } from "../../tool-recognition";
import {
  normalizeCodexToolCall,
  resolveCodexSubagentActivity,
  type CodexSubagentActivity,
} from "./tool-calls";

export function collectCodexToolEvidence(context: AcpToolEvidenceContext): ToolEvidence[] {
  const projected = normalizeCodexToolCall(context.observation.toolCall, context.observation.update);
  const activity = projected.kind === "subagent"
    ? resolveCodexSubagentActivity(context.observation.input, context.observation.update)
    : null;
  return evidenceFromProjectedToolCall({
    observation: context.observation,
    projected,
    subagentAction: projected.kind === "subagent"
      ? resolveCodexSubagentAction(context.observation.descriptor, context.observation.inputText, activity)
      : undefined,
    subagentTerminal: projected.kind === "subagent"
      ? isTerminalCodexSubagentActivity(activity, projected.status)
      : undefined,
  });
}

function resolveCodexSubagentAction(
  descriptor: string,
  inputText?: string,
  activity?: CodexSubagentActivity | null,
): SubagentAction {
  const activityKind = activity?.kind;
  if (activityKind === "interrupted") return "cancel";
  if (activityKind === "interacted") return "message";
  if (activityKind === "started") return "spawn";
  const text = `${descriptor} ${inputText ?? ""}`.toLowerCase();
  if (/\b(?:interrupt_agent|close_agent)\b/u.test(text)) return "cancel";
  if (/\b(?:list_agents)\b/u.test(text)) return "status";
  if (/\b(?:wait_agent)\b/u.test(text)) return "wait";
  if (/\b(?:send_message|send_input|followup_task|resume_agent)\b/u.test(text)) return "message";
  return "spawn";
}

function isTerminalCodexSubagentActivity(
  activity: CodexSubagentActivity | null,
  status: AgentToolCall["status"],
): boolean | undefined {
  if (!activity) {
    return undefined;
  }
  return (activity.kind === "interacted" || activity.kind === "interrupted") &&
    (status === "completed" || status === "failed" || status === "cancelled");
}
