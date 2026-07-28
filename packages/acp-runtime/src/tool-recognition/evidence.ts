import type { AgentToolCall } from "@tiller/shared";
import { recordFrom } from "../session-update";
import type { SubagentAction, ToolEvidence, ToolObservation } from "./types";

export function evidenceFromProjectedToolCall(args: {
  observation: ToolObservation;
  projected: AgentToolCall | null;
  source?: ToolEvidence["source"];
  strength?: ToolEvidence["strength"];
  subagentAction?: SubagentAction;
  subagentTerminal?: boolean;
}): ToolEvidence[] {
  if (!args.projected) {
    return [{ source: args.source ?? "provider-structured", strength: args.strength ?? 400, suppress: true }];
  }
  const projected = args.projected;
  const source = args.source ?? inferEvidenceSource(args.observation);
  const evidence: ToolEvidence = {
    source,
    strength: args.strength ?? (source === "provider-output" ? 200 : 500),
    kind: projected.kind,
    title: projected.title,
    status: projected.status,
    mcp: projected.mcp,
    commandId: projected.commandId,
    input: projected.input,
    output: projected.output,
    stream: projected.stream,
    subagentOperation: projected.subagentOperation,
  };
  if (projected.kind === "subagent" && args.subagentAction) {
    const identity = collectSubagentIdentity(args.observation, projected);
    evidence.subagent = {
      action: args.subagentAction,
      batch: identity.batch,
      entityIds: identity.entityIds,
      background: isBackgroundObservation(args.observation),
      terminal: args.subagentTerminal ??
        isTerminalObservation(args.subagentAction, args.observation, projected),
    };
  }
  return [evidence];
}

export function collectSubagentEntityIds(
  observation: ToolObservation,
  projected: AgentToolCall,
): string[] {
  return collectSubagentIdentity(observation, projected).entityIds;
}

function collectSubagentIdentity(
  observation: ToolObservation,
  projected: AgentToolCall,
): { entityIds: string[]; batch: boolean } {
  const ids = new Set<string>();
  let batch = false;
  const commandId = projected.commandId;
  if (commandId?.startsWith("subagent:")) ids.add(commandId.slice("subagent:".length));
  batch = collectNamedIds(observation.input, ids) || batch;
  batch = collectNamedIds(observation.output, ids) || batch;
  for (const text of [observation.inputText, observation.outputText]) {
    if (!text) continue;
    for (const match of text.matchAll(/(?:agent|task|session)[_ -]?id["'\s:=]+([A-Za-z0-9._:-]+)/giu)) {
      if (match[1]) ids.add(match[1].replace(/[),.;]+$/u, ""));
    }
  }
  return { entityIds: [...ids], batch };
}

function collectNamedIds(value: unknown, ids: Set<string>): boolean {
  const record = recordFrom(value);
  let batch = false;
  for (const key of ["agent_id", "agentId", "task_id", "taskId", "session_id", "sessionId"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) ids.add(candidate.trim());
  }
  for (const key of ["agent_ids", "agentIds", "task_ids", "taskIds", "targets"]) {
    const candidates = record[key];
    if (!Array.isArray(candidates)) continue;
    const pluralIds = new Set<string>();
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        pluralIds.add(candidate.trim());
      } else {
        batch = collectNamedIds(candidate, pluralIds) || batch;
      }
    }
    for (const candidate of pluralIds) {
      ids.add(candidate);
    }
    if (pluralIds.size > 1) {
      batch = true;
    }
  }
  return batch;
}

function isBackgroundObservation(observation: ToolObservation): boolean {
  const input = recordFrom(observation.input);
  return input.run_in_background === true || input.runInBackground === true ||
    input.background === true || input.is_background === true || input.isBackground === true;
}

function isTerminalObservation(
  action: SubagentAction,
  observation: ToolObservation,
  projected: AgentToolCall,
): boolean {
  if (action === "result") return true;
  if (action !== "wait") return false;
  const output = observation.outputText?.toLowerCase() ?? "";
  if (/timeout|timed out|still running|no (?:new )?(?:updates|output)/u.test(output)) return false;
  return ["completed", "failed", "cancelled"].includes(projected.status) && Boolean(output.trim());
}

function inferEvidenceSource(observation: ToolObservation): ToolEvidence["source"] {
  return observation.outputText && !observation.inputText ? "provider-output" : "provider-structured";
}
