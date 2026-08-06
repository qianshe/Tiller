import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  resolveStructuredToolName,
  type AgentToolCall,
  type CommandChunk,
} from "@tiller/shared";
import { classifyStructuredFileOperation } from "./tool-recognition/file-operation";

function timestamp() {
  return new Date().toISOString();
}

export function extractToolCall(sessionId: string, updateType: string | undefined, update: any): AgentToolCall | null {
  const type = updateType ?? "";
  if (!/(tool|terminal)/iu.test(type) || /command_output/iu.test(type)) {
    return null;
  }

  const source = update.toolCall ?? update.tool_call ?? update.tool ?? update.terminal ?? update;
  const rawToolInput = resolveRawToolInput(source, update);
  const rawToolOutput = resolveRawToolOutput(source, update);
  const parsedToolInput = parseToolInput(rawToolInput);
  const id = stringFrom(
    update.toolCallId ??
      update.tool_call_id ??
      update.callId ??
      source.id ??
      source.toolCallId ??
      source.tool_call_id ??
      source.callId ??
      update.id,
  ) ?? `${sessionId}-tool-${Date.now()}`;
  const commandId = stringFrom(source.commandId ?? source.command_id ?? source.terminalId ?? update.commandId);
  const toolName = extractToolName(source, update, parsedToolInput);
  const rawTitle = stringFrom(source.title ?? source.label ?? source.displayName ?? source.display_name ?? source.name ?? source.toolName ?? source.tool_name ?? source.tool ?? source.command ?? update.title ?? update.name);
  const output = stringifyToolPayload(rawToolOutput);
  const input = stringifyToolPayload(rawToolInput);
  const mcp = resolveAgentToolCallMcp({ input: parsedToolInput, toolName, rawTitle });
  const kind = inferToolCallKind(type, source, rawTitle, rawToolInput);
  const title = resolveToolTitle(rawTitle, toolName, commandId, id, input, kind, mcp);
  const now = timestamp();

  return {
    id,
    kind,
    title,
    status: inferToolCallStatus(type, update.status ?? source.status ?? update.state ?? source.state),
    ...(mcp ? { mcp } : {}),
    ...(commandId ? { commandId } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(source.stream === "stderr" || source.stream === "stdout" ? { stream: source.stream } : {}),
    timestamp: stringFrom(source.timestamp ?? update.timestamp) ?? now,
    updatedAt: stringFrom(source.updatedAt ?? source.updated_at ?? update.updatedAt ?? update.timestamp) ?? now,
  };
}

export function mapCommandChunkToToolCall(chunk: CommandChunk): AgentToolCall {
  return {
    id: `tool-${chunk.commandId}`,
    kind: "shell",
    title: chunk.commandId,
    status: chunk.stream === "stderr" ? "failed" : "running",
    commandId: chunk.commandId,
    output: chunk.text,
    stream: chunk.stream,
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
  };
}

function resolveToolTitle(
  rawTitle: string | undefined,
  toolName: string | undefined,
  commandId: string | undefined,
  id: string,
  input: string | undefined,
  kind: AgentToolCall["kind"] | undefined,
  mcp: AgentToolCall["mcp"] | undefined,
) {
  if (mcp) {
    return formatAgentToolCallMcpTitle(mcp);
  }
  if (isInformativeToolTitle(rawTitle, id)) {
    return rawTitle!;
  }
  if (isInformativeToolTitle(toolName, id)) {
    return toolName!.includes("/") ? `Tool: ${toolName}` : toolName!;
  }
  if (isInformativeToolTitle(commandId, id)) {
    return commandId!;
  }
  const path = extractPathFromInput(input);
  if (path) {
    return path;
  }
  const kindTitle = kindAsTitle(kind);
  if (kindTitle) {
    return kindTitle;
  }
  return `Tool call ${shortOpaqueToolCallId(id)}`;
}

function shortOpaqueToolCallId(id: string) {
  return id.length > 12 ? `${id.slice(0, 9)}…` : id;
}

function extractToolName(source: any, update: any, parsedToolInput?: unknown) {
  return (
    toolNameFromToolInput(parsedToolInput) ??
    primitiveStringFrom(
      source.toolName ??
        source.tool_name ??
        source.name ??
        source.tool ??
        source.function?.name ??
        source.input?.name ??
        source.input?.tool ??
        source.input?.toolName ??
        source.input?.tool_name ??
        source.arguments?.name ??
        source.args?.name ??
        update.toolName ??
        update.tool_name ??
        update.name,
    )
  );
}

function toolNameFromToolInput(input: unknown) {
  return resolveStructuredToolName(parseToolInput(input));
}

function parseToolInput(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return input;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return input;
  }
}

function stringifyToolPayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isInformativeToolTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized) && !/^Tool call\b/u.test(normalized));
}

function primitiveStringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function inferToolCallKind(
  updateType: string,
  source: any,
  rawTitle?: string,
  rawToolInput?: unknown,
): AgentToolCall["kind"] {
  const toolInput = parseToolInput(rawToolInput ?? resolveRawToolInput(source, source));
  const toolName = toolNameFromToolInput(toolInput);
  const structuredKind = inferKindFromStructuredInput(toolInput);
  const explicitKind = resolveExplicitToolCallKind(source);
  const mcp = resolveAgentToolCallMcp({ input: toolInput, toolName, rawTitle });
  const descriptorRaw = [
    source.name,
    source.toolName,
    source.tool_name,
    source.tool,
    toolName,
    updateType,
  ]
    .map((value) => primitiveStringFrom(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const raw = [
    explicitKind,
    source.title,
    source.label,
    source.displayName,
    source.display_name,
    source.name,
    source.toolName,
    source.tool_name,
    source.tool,
    toolName,
    updateType,
  ]
    .map((value) => primitiveStringFrom(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (explicitKind === "subagent") return "subagent";
  if (/\b(?:lsp[_-]?)?diagnostics?\b/u.test(descriptorRaw)) return "diagnostics";
  if (/\b(?:todo[_-]?write|todowrite)\b/u.test(descriptorRaw)) return "todo";
  if (explicitKind === "shell" && structuredKind === "search") return "search";
  if (explicitKind && explicitKind !== "tool" && explicitKind !== "unknown") return explicitKind;
  if (isSkillToolInput(toolInput) || /(^|[_-])skill(s)?($|[_-])|execute_skill|load_skill/u.test(raw)) return "skill";
  if (mcp) return "mcp";
  if (structuredKind === "shell") return "shell";
  if (/\b(?:read|view|list|glob)\b/u.test(raw)) return "read";
  if (/edit|delete|move|diff|patch|write|file/u.test(raw)) return "write";
  if (/search|grep/u.test(raw)) return "search";
  if (/execute|terminal|command|shell|bash|exec/u.test(raw)) return "shell";
  if (/fetch/u.test(raw)) return "fetch";
  if (/\btodo/u.test(raw)) return "todo";
  if (structuredKind) return structuredKind;
  if (looksLikePathTitle(source.title)) return "read";
  if (/tool/u.test(raw)) return "tool";
  return "unknown";
}

function resolveExplicitToolCallKind(source: any): AgentToolCall["kind"] | undefined {
  const candidates = [
    primitiveStringFrom(source.kind),
    primitiveStringFrom(source.type),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  const explicitKindMap: Record<string, AgentToolCall["kind"]> = {
    mcp: "mcp",
    skill: "skill",
    read: "read",
    diagnostic: "diagnostics",
    diagnostics: "diagnostics",
    write: "write",
    search: "search",
    shell: "shell",
    terminal: "shell",
    command: "shell",
    fetch: "fetch",
    // ACP ToolKind is display metadata; assistant reasoning arrives via agent_thought updates.
    think: "tool",
    todo: "todo",
    subagent: "subagent",
    tool: "tool",
    unknown: "unknown",
  };
  for (const candidate of candidates) {
    const mapped = explicitKindMap[candidate];
    if (mapped) {
      return mapped;
    }
  }
  return undefined;
}

function isSkillToolInput(rawInput: unknown) {
  if (!rawInput || typeof rawInput !== "object") return false;
  const record = rawInput as Record<string, unknown>;
  return typeof record.skillName === "string" || typeof record.skill === "string";
}

function inferKindFromStructuredInput(toolInput: unknown): AgentToolCall["kind"] | undefined {
  if (!toolInput || typeof toolInput !== "object") return undefined;
  const record = toolInput as Record<string, unknown>;
  const fileOperation = classifyStructuredFileOperation(record);
  if (fileOperation) return fileOperation.kind;
  if (typeof record.notebook_path === "string") return "write";
  if (typeof record.command === "string") return "shell";
  if ("substring_pattern" in record || "search_string" in record) return "search";
  if (typeof record.pattern === "string") return "search";
  if (typeof record.query === "string") return "search";
  if (typeof record.url === "string" && typeof record.prompt === "string") return "fetch";
  if ("todos" in record) return "todo";
  return undefined;
}

function looksLikePathTitle(title: unknown): boolean {
  if (typeof title !== "string") return false;
  const normalized = title.trim();
  if (!normalized || /^Tool call\b/u.test(normalized) || /^call_[A-Za-z0-9]+$/u.test(normalized)) return false;
  return /[\\/]/u.test(normalized) && !/\s/u.test(normalized);
}

function extractPathFromInput(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const parsed = parseToolInput(input);
  return classifyStructuredFileOperation(parsed)?.path;
}

function resolveRawToolInput(source: any, update: any) {
  const rawInput = source.rawInput ?? source.raw_input ?? update.rawInput ?? update.raw_input;
  const fallbackInput =
    source.input ??
    source.arguments ??
    source.args ??
    source.params ??
    source.command ??
    source.state?.input ??
    update.input ??
    update.arguments ??
    update.args ??
    update.params ??
    update.command;
  return resolvePreferredToolPayload(rawInput, fallbackInput);
}

function resolveRawToolOutput(source: any, update: any) {
  const rawOutput = source.rawOutput ?? source.raw_output ?? update.rawOutput ?? update.raw_output;
  const fallbackOutput =
    source.output ??
    source.result ??
    source.content ??
    source.text ??
    source.state?.output ??
    update.output ??
    update.result ??
    update.content ??
    update.text ??
    update.state?.output;
  return resolvePreferredToolPayload(rawOutput, fallbackOutput);
}

function resolvePreferredToolPayload(primary: unknown, fallback: unknown) {
  return hasMeaningfulToolPayload(primary) ? primary : fallback ?? primary;
}

function hasMeaningfulToolPayload(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

const KIND_TITLES: Record<string, string> = {
  read: "Read", diagnostics: "Diagnostics", write: "Write", shell: "Shell", search: "Search",
  fetch: "Fetch", skill: "Skill", todo: "Todo",
};

function kindAsTitle(kind: AgentToolCall["kind"] | undefined): string | undefined {
  return kind ? KIND_TITLES[kind] : undefined;
}

function inferToolCallStatus(updateType: string, status: unknown): AgentToolCall["status"] {
  const rawStatus = status && typeof status === "object"
    ? (status as { status?: unknown; state?: unknown }).status ??
      (status as { state?: unknown }).state ??
      status
    : status;
  const tokens = new Set(
    String(rawStatus ?? updateType).toLowerCase().split(/[^a-z]+/u).filter(Boolean),
  );
  if (hasAnyStatusToken(tokens, "fail", "failed", "failure", "error", "errored", "reject", "rejected")) {
    return "failed";
  }
  if (hasAnyStatusToken(tokens, "cancel", "canceled", "cancelled")) {
    return "cancelled";
  }
  if (hasAnyStatusToken(tokens, "wait", "waiting", "permission", "confirm", "confirmation")) {
    return "waiting_for_permission";
  }
  if (hasAnyStatusToken(tokens, "complete", "completed", "done", "success", "successful", "succeeded", "finished", "end", "ended")) {
    return "completed";
  }
  if (hasAnyStatusToken(tokens, "pending", "queued", "start", "started")) {
    return "pending";
  }
  return "running";
}

function hasAnyStatusToken(tokens: Set<string>, ...candidates: string[]) {
  return candidates.some((candidate) => tokens.has(candidate));
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
