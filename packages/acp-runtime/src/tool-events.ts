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
    kind: "terminal",
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
  return commandId ?? rawTitle ?? id;
}

function extractToolName(source: any, update: any) {
  return (
    toolNameFromRawInput(source.rawInput ?? source.raw_input ?? update.rawInput ?? update.raw_input) ??
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
  return tool ?? server;
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
  const raw = String(source.kind ?? source.type ?? updateType).toLowerCase();
  if (/terminal|command|shell|bash|exec/u.test(raw)) {
    return "terminal";
  }
  if (/edit|diff|patch|file/u.test(raw)) {
    return "edit";
  }
  if (/subagent|agent/u.test(raw)) {
    return "subagent";
  }
  if (/tool/u.test(raw)) {
    return "tool";
  }
  return "unknown";
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
