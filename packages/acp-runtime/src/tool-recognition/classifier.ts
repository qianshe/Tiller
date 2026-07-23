import { resolveAgentToolCallMcp, type AgentToolCall } from "@tiller/shared";
import { recordFrom } from "../session-update";
import { classifyStructuredFileOperation } from "./file-operation";
import type { ToolEvidence, ToolObservation } from "./types";

const WEAK_KINDS = new Set<AgentToolCall["kind"]>(["tool", "unknown"]);

export function collectGenericToolEvidence(observation: ToolObservation): ToolEvidence[] {
  const evidence: ToolEvidence[] = [];
  const base = observation.toolCall;
  if (!WEAK_KINDS.has(base.kind)) {
    evidence.push({ source: "acp-explicit", strength: 500, kind: base.kind });
  }
  const mcp = resolveAgentToolCallMcp({
    existing: base.mcp,
    input: observation.input,
    toolName: observation.toolName,
    title: base.title,
  });
  if (mcp && (base.kind === "mcp" || WEAK_KINDS.has(base.kind))) {
    evidence.push({
      source: base.kind === "mcp" ? "acp-explicit" : "generic-structured",
      strength: base.kind === "mcp" ? 500 : 300,
      kind: "mcp",
      mcp,
    });
  }
  if (!WEAK_KINDS.has(base.kind)) {
    return evidence;
  }
  const structuredKind = classifyStructuredInput(observation.input);
  if (structuredKind) {
    evidence.push({ source: "generic-structured", strength: 300, kind: structuredKind });
    return evidence;
  }
  const heuristicKind = classifyDescriptor(observation.descriptor);
  if (heuristicKind) {
    evidence.push({ source: "text-heuristic", strength: 100, kind: heuristicKind });
  }
  return evidence;
}

function classifyStructuredInput(input: unknown): AgentToolCall["kind"] | undefined {
  const record = recordFrom(input);
  if (typeof record.skillName === "string" || typeof record.skill === "string") return "skill";
  if ("todos" in record) return "todo";
  if (typeof record.command === "string" || typeof record.cmd === "string" || Array.isArray(record.command)) return "shell";
  if ("substring_pattern" in record || "search_string" in record || "query" in record || "pattern" in record) return "search";
  if (typeof record.url === "string") return "fetch";
  return classifyStructuredFileOperation(record)?.kind;
}

function classifyDescriptor(descriptor: string): AgentToolCall["kind"] | undefined {
  if (/\b(?:lsp[_-]?)?diagnostics?\b/u.test(descriptor)) return "diagnostics";
  if (/\b(?:todo[_-]?write|todowrite)\b/u.test(descriptor)) return "todo";
  if (/(?:^|[_./-])skill(?:$|[_./-])|execute_skill|load_skill/u.test(descriptor)) return "skill";
  if (/\b(?:search|grep|find_symbol|codebase_search)\b/u.test(descriptor)) return "search";
  if (/\b(?:read|view|glob)\b/u.test(descriptor)) return "read";
  if (/\b(?:edit|patch|write|delete_file|move_file)\b/u.test(descriptor)) return "write";
  if (/\b(?:execute|terminal|command|shell|bash|exec)\b/u.test(descriptor)) return "shell";
  if (/\b(?:fetch|crawl|extract|web)\b/u.test(descriptor)) return "fetch";
  return undefined;
}
