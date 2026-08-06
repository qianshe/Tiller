import type { AcpToolEvidenceContext } from "../types";
import {
  collectSubagentEntityIds,
  evidenceFromProjectedToolCall,
  type ToolEvidence,
} from "../../tool-recognition";
import { normalizeOpenCodeToolCall } from "./tool-calls";

export function collectOpenCodeToolEvidence(context: AcpToolEvidenceContext): ToolEvidence[] {
  const observation = context.observation;
  const projected = normalizeOpenCodeToolCall(observation.toolCall, observation.update);
  const evidence = evidenceFromProjectedToolCall({
    observation,
    projected,
    subagentAction: projected.kind === "subagent"
      ? resolveOpenCodeSubagentAction(observation, projected)
      : undefined,
  });
  if (projected.kind === "tool" && isTerminalBackgroundOutput(observation, projected)) {
    const entityIds = collectSubagentEntityIds(observation, {
      ...projected,
      kind: "subagent",
    });
    evidence.push({
      source: "provider-structured",
      strength: 500,
      subagent: {
        action: "result",
        batch: false,
        entityIds,
        background: false,
        terminal: true,
        lifecycleOnly: true,
        existingOnly: true,
      },
    });
  }
  return evidence;
}

function isTerminalBackgroundOutput(
  observation: AcpToolEvidenceContext["observation"],
  projected: AcpToolEvidenceContext["observation"]["toolCall"],
) {
  if (!isOpenCodeBackgroundOutputTitle(projected.title, observation.descriptor)) {
    return false;
  }
  const output = observation.outputText?.trim() ?? "";
  return hasOpenCodeTerminalSubagentResult(output);
}

function isOpenCodeBackgroundOutputTitle(title: string, descriptor: string) {
  return /(?:^|\s)(?:tool:\s*)?background[_ -]?output(?:$|\s)/iu.test(`${title} ${descriptor}`);
}

function resolveOpenCodeSubagentAction(
  observation: AcpToolEvidenceContext["observation"],
  projected: AcpToolEvidenceContext["observation"]["toolCall"],
) {
  const output = observation.outputText?.trim() ?? "";
  if (hasOpenCodeTerminalSubagentResult(output)) {
    return "result" as const;
  }
  if (projected.status === "pending" || projected.status === "running") {
    return "spawn" as const;
  }
  if (/\bbackground task launched\b|\bstatus\s*[:=]\s*(?:pending|queued|running)\b/iu.test(output)) {
    return "spawn" as const;
  }
  return output ? "result" as const : "spawn" as const;
}

function hasOpenCodeTerminalSubagentResult(output: string) {
  return /\btask\s+result\b|\btask\s+completed(?:\s+in|\b)|\bbackground\s+task\s+(?:completed|failed|cancelled)\b|\bstatus\s*[:=]\s*(?:completed|failed|cancelled)\b|<task_(?:result|completed)>/iu.test(output);
}
