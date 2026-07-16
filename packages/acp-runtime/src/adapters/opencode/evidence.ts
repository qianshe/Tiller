import type { AcpToolEvidenceContext } from "../types";
import { evidenceFromProjectedToolCall, type ToolEvidence } from "../../tool-recognition";
import { normalizeOpenCodeToolCall } from "./tool-calls";

export function collectOpenCodeToolEvidence(context: AcpToolEvidenceContext): ToolEvidence[] {
  const observation = context.observation;
  const projected = normalizeOpenCodeToolCall(observation.toolCall, observation.update);
  return evidenceFromProjectedToolCall({
    observation,
    projected,
    subagentAction: projected.kind === "subagent"
      ? resolveOpenCodeSubagentAction(observation, projected)
      : undefined,
  });
}

function resolveOpenCodeSubagentAction(
  observation: AcpToolEvidenceContext["observation"],
  projected: AcpToolEvidenceContext["observation"]["toolCall"],
) {
  if (projected.status === "pending" || projected.status === "running") {
    return "spawn" as const;
  }
  const output = observation.outputText?.trim() ?? "";
  if (/\bbackground task launched\b|\bstatus\s*[:=]\s*(?:pending|queued|running)\b/iu.test(output)) {
    return "spawn" as const;
  }
  return output ? "result" as const : "spawn" as const;
}
