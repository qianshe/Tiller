import type { AgentToolCall } from "@tiller/shared";
import type { AcpToolEvidenceContext } from "../types";
import { evidenceFromProjectedToolCall, type SubagentAction, type ToolEvidence } from "../../tool-recognition";
import { recordFrom } from "../../session-update";
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
  const subagentAction = projected.kind === "subagent"
    ? resolveCodexSubagentAction(context.observation.descriptor, context.observation.inputText, activity)
    : undefined;
  const operationTerminalStatus = projected.kind === "subagent"
    ? resolveCodexOperationTerminalStatus(context, projected, activity)
    : undefined;
  // A terminal ACP snapshot is already the provider's source-of-truth status.
  // Do not send it back through the launch lifecycle, which intentionally keeps
  // completed spawn calls running until a later lifecycle event arrives.
  const isTerminalSnapshot = projected.kind === "subagent" &&
    projected.status === "completed" &&
    !activity &&
    !projected.subagentOperation;
  return evidenceFromProjectedToolCall({
    observation: context.observation,
    projected,
    subagentAction: isTerminalSnapshot ? undefined : subagentAction,
    subagentTerminal: projected.kind === "subagent"
      ? projected.subagentOperation
        ? operationTerminalStatus !== undefined
        : isTerminalCodexSubagentActivity(activity, projected.status)
      : undefined,
    subagentTerminalStatus: operationTerminalStatus,
  });
}

function resolveCodexOperationTerminalStatus(
  context: AcpToolEvidenceContext,
  projected: AgentToolCall,
  activity: CodexSubagentActivity | null,
): Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled"> | undefined {
  const operation = projected.subagentOperation;
  if (!operation || operation.action === "spawn") {
    return undefined;
  }
  if (operation.action === "close") {
    if (activity?.kind === "interrupted") {
      return projected.status === "completed" ||
        projected.status === "failed" ||
        projected.status === "cancelled"
        ? projected.status
        : undefined;
    }
    return projected.status === "completed" || projected.status === "cancelled"
      ? "cancelled"
      : undefined;
  }

  const input = recordFrom(context.observation.input);
  const output = recordFrom(context.observation.output);
  const states = recordFrom(
    input.agentsStates ?? input.agents_states ?? output.agentsStates ?? output.agents_states,
  );
  const targetStatuses = operation.targets.map((target) =>
    normalizeCodexTargetStatus(recordFrom(states[target.id]).status)
  );
  if (targetStatuses.length && targetStatuses.every(Boolean)) {
    if (targetStatuses.includes("failed")) return "failed";
    if (targetStatuses.includes("cancelled")) return "cancelled";
    return "completed";
  }

  const outputText = context.observation.outputText?.toLowerCase() ?? "";
  if (
    !outputText.trim() ||
    /timeout|timed out|still running|no (?:new )?(?:updates|output)/u.test(outputText)
  ) {
    return undefined;
  }
  if (projected.status === "failed" || projected.status === "cancelled") {
    return projected.status;
  }
  return projected.status === "completed" ? "completed" : undefined;
}

function normalizeCodexTargetStatus(
  value: unknown,
): Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled"> | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[_ -]+/gu, "");
  if (["completed", "complete", "done", "success", "succeeded"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "failure", "error", "errored"].includes(normalized)) {
    return "failed";
  }
  if (["cancelled", "canceled", "interrupted", "closed"].includes(normalized)) {
    return "cancelled";
  }
  return undefined;
}

function resolveCodexSubagentAction(
  descriptor: string,
  inputText?: string,
  activity?: CodexSubagentActivity | null,
): SubagentAction {
  const activityKind = activity?.kind;
  // An interruption notification closes the provider-side activity record, but
  // the ACP tool update itself may still be a completed result. Keep that
  // source status intact while the lifecycle correlator removes the entity.
  if (activityKind === "interrupted") return "result";
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
