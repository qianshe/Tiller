import type { AgentToolCall, CommandChunk } from "@tiller/shared";

function timestamp() {
  return new Date().toISOString();
}

export function extractToolCall(sessionId: string, updateType: string | undefined, update: any): AgentToolCall | null {
  const type = updateType ?? "";
  if (!/(tool|terminal)/iu.test(type) || /command_output/iu.test(type)) {
    return null;
  }

  const source = update.toolCall ?? update.tool_call ?? update.tool ?? update.terminal ?? update;
  const id = stringFrom(source.id ?? source.toolCallId ?? source.tool_call_id ?? source.callId ?? update.id) ?? `${sessionId}-tool-${Date.now()}`;
  const commandId = stringFrom(source.commandId ?? source.command_id ?? source.terminalId ?? update.commandId);
  const toolName = extractToolName(source, update);
  const rawTitle = stringFrom(source.title ?? source.label ?? source.displayName ?? source.display_name ?? source.name ?? source.toolName ?? source.tool_name ?? source.tool ?? source.command);
  const title = resolveToolTitle(rawTitle, toolName, commandId, id);
  const output = stringifyToolPayload(source.output ?? source.result ?? source.rawOutput ?? source.raw_output ?? source.content ?? source.text ?? source.state?.output);
  const input = stringifyToolPayload(source.input ?? source.arguments ?? source.args ?? source.params ?? source.command ?? source.rawInput ?? source.raw_input ?? source.state?.input);
  const now = timestamp();

  return {
    id,
    kind: inferToolCallKind(type, source),
    title,
    status: inferToolCallStatus(type, source.status ?? source.state ?? update.status ?? update.state),
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

function resolveToolTitle(rawTitle: string | undefined, toolName: string | undefined, commandId: string | undefined, id: string) {
  if (isInformativeToolTitle(rawTitle, id)) {
    return rawTitle!;
  }
  if (isInformativeToolTitle(toolName, id)) {
    return toolName!.includes(":") ? toolName! : `Tool: ${toolName}`;
  }
  if (isInformativeToolTitle(commandId, id)) {
    return commandId!;
  }
  return `Tool call ${shortOpaqueToolCallId(id)}`;
}

function shortOpaqueToolCallId(id: string) {
  return id.length > 12 ? `${id.slice(0, 9)}…` : id;
}

function extractToolName(source: any, update: any) {
  return (
    toolNameFromToolInput(source.rawInput ?? source.raw_input ?? update.rawInput ?? update.raw_input) ??
    toolNameFromToolInput(source.input ?? source.arguments ?? source.args ?? source.params ?? source.state?.input ?? update.input ?? update.arguments ?? update.args ?? update.params) ??
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
        update.tool_name,
    )
  );
}

function toolNameFromToolInput(input: unknown) {
  return toolNameFromRawInput(parseToolInput(input));
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

function toolNameFromRawInput(rawInput: unknown) {
  if (!rawInput || typeof rawInput !== "object") {
    return undefined;
  }
  const record = rawInput as Record<string, unknown>;
  const server = primitiveStringFrom(record.server);
  const tool = primitiveStringFrom(record.tool ?? record.name ?? record.toolName ?? record.tool_name);
  if (server && tool) {
    return `${server}/${tool}`;
  }
  return tool ?? server ?? inferToolNameFromStructuredPayload(record);
}

function inferToolNameFromStructuredPayload(record: Record<string, unknown>) {
  if (typeof record.code === "string" && ("timeout_ms" in record || "timeoutMs" in record)) {
    return "node_repl/js";
  }
  if (
    typeof record.project_root_path === "string" &&
    typeof record.message === "string" &&
    Array.isArray(record.predefined_options)
  ) {
    return "sanshu/zhi";
  }
  if (typeof record.project_path === "string" && typeof record.action === "string") {
    return "sanshu/ji";
  }
  return undefined;
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
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
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

function inferToolCallKind(updateType: string, source: any): AgentToolCall["kind"] {
  const toolInput = parseToolInput(source.rawInput ?? source.raw_input ?? source.input ?? source.arguments ?? source.args ?? source.params ?? source.state?.input);
  const toolName = toolNameFromRawInput(toolInput);
  const raw = String(source.kind ?? source.type ?? updateType).toLowerCase();

  if (isSkillToolInput(toolInput) || /(^|[_-])skill(s)?($|[_-])|execute_skill|load_skill/u.test(raw)) return "skill";
  if (toolName) return "mcp";
  if (/read/u.test(raw)) return "read";
  if (/edit|delete|move|diff|patch|write|file/u.test(raw)) return "write";
  if (/search/u.test(raw)) return "search";
  if (/execute|terminal|command|shell|bash|exec/u.test(raw)) return "shell";
  if (/fetch/u.test(raw)) return "fetch";
  if (/think/u.test(raw)) return "think";
  if (/subagent|agent/u.test(raw)) return "subagent";
  if (/tool/u.test(raw)) return "tool";
  return "unknown";
}

function isSkillToolInput(rawInput: unknown) {
  if (!rawInput || typeof rawInput !== "object") return false;
  const record = rawInput as Record<string, unknown>;
  return typeof record.skillName === "string" || typeof record.skill === "string";
}

function inferToolCallStatus(updateType: string, status: unknown): AgentToolCall["status"] {
  const raw = String(status ?? updateType).toLowerCase();
  if (/fail|error|reject/u.test(raw)) {
    return "failed";
  }
  if (/cancel/u.test(raw)) {
    return "cancelled";
  }
  if (/wait|permission|confirm/u.test(raw)) {
    return "waiting_for_permission";
  }
  if (/complete|done|success|finished|end/u.test(raw)) {
    return "completed";
  }
  if (/pending|start/u.test(raw)) {
    return "pending";
  }
  return "running";
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
