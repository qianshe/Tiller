import type { AcpToolEvidenceContext } from "../types";
import { evidenceFromProjectedToolCall, type SubagentAction, type ToolEvidence } from "../../tool-recognition";
import { createClaudeToolCallNormalizer } from "./tool-calls";

export function createClaudeToolEvidenceCollector() {
  const normalizer = createClaudeToolCallNormalizer();
  return {
    collect(context: AcpToolEvidenceContext): ToolEvidence[] {
      const observation = context.observation;
      if (isBareClaudeLifecyclePlaceholder(observation)) {
        return [{
          source: "provider-structured",
          strength: 500,
          suppress: true,
        }];
      }
      const projected = normalizer.normalize(
        observation.toolCall,
        observation.update,
        observation.sessionId,
        observation.cwd,
      );
      if (!projected) {
        return [{
          source: "provider-structured",
          strength: 500,
          suppress: true,
        }];
      }
      return evidenceFromProjectedToolCall({
        observation,
        projected,
        subagentAction: projected?.kind === "subagent"
          ? resolveClaudeSubagentAction(observation, projected)
          : undefined,
      });
    },
    disposeSession(sessionId: string): void {
      normalizer.disposeSession(sessionId);
    },
  };
}

function isBareClaudeLifecyclePlaceholder(
  observation: AcpToolEvidenceContext["observation"],
) {
  const title = observation.toolCall.title.trim();
  if (!/^(?:Agent|Task|SendMessage|Tool call\b)/iu.test(title)) {
    return false;
  }
  const hasInput = Boolean(
    observation.inputText &&
      !/^(?:\{\}|\[\]|null)$/u.test(observation.inputText.trim()),
  );
  const hasOutput = Boolean(
    observation.outputText &&
      !/^(?:\{\}|\[\]|null)$/u.test(observation.outputText.trim()),
  );
  return !observation.toolCall.commandId && !hasInput && !hasOutput;
}

function resolveClaudeSubagentAction(
  observation: AcpToolEvidenceContext["observation"],
  projected: AcpToolEvidenceContext["observation"]["toolCall"],
): SubagentAction {
  const text = `${observation.descriptor} ${projected.title} ${observation.inputText ?? ""}`
    .toLowerCase();
  if (/\bsendmessage\b/u.test(text)) return "message";
  if (/\btaskoutput\b/u.test(text)) {
    return isClaudeTerminalResult(observation.outputText, projected.status)
      ? "result"
      : "wait";
  }
  if (isClaudeBackgroundLaunch(observation.outputText)) return "spawn";
  if (isClaudeTerminalResult(observation.outputText, projected.status)) return "result";
  return "spawn";
}

function isClaudeBackgroundLaunch(output: string | undefined) {
  return /\bAsync agent launched successfully\b|\bstatus\s*[:=]\s*(?:pending|queued|running)\b/iu
    .test(output ?? "");
}

function isClaudeTerminalResult(
  output: string | undefined,
  status: AcpToolEvidenceContext["observation"]["toolCall"]["status"],
) {
  const normalized = output?.trim() ?? "";
  if (!normalized || isClaudeBackgroundLaunch(normalized)) return false;
  const taggedStatus = normalized.match(/<status>\s*([^<]+?)\s*<\/status>/iu)?.[1]
    ?.trim()
    .toLowerCase();
  if (taggedStatus && ["pending", "queued", "running"].includes(taggedStatus)) {
    return false;
  }
  if (taggedStatus && ["completed", "failed", "cancelled"].includes(taggedStatus)) {
    return true;
  }
  const lifecycleText = normalized.replace(/<task_id>[\s\S]*?<\/task_id>/giu, " ");
  if (/\btimed?\s*out\b|\bstill running\b|\bno (?:new )?(?:updates|output)\b/iu.test(lifecycleText)) {
    return false;
  }
  return ["completed", "failed", "cancelled"].includes(status);
}
