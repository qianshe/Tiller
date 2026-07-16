import { resolveStructuredToolName, type AgentToolCall } from "@tiller/shared";
import { recordFrom, serializableStringFrom } from "../session-update";
import type { ToolObservation } from "./types";

export function createToolObservation(args: {
  providerId?: string;
  sessionId?: string;
  cwd?: string;
  toolCall: AgentToolCall;
  update?: unknown;
}): ToolObservation {
  const update = recordFrom(args.update);
  const source = recordFrom(update.toolCall ?? update.tool_call ?? update.tool ?? update);
  const state = recordFrom(source.state ?? update.state);
  const rawInput = firstMeaningful(
    source.rawInput,
    source.raw_input,
    update.rawInput,
    update.raw_input,
  );
  const fallbackInput = firstMeaningful(
    source.input,
    source.arguments,
    source.args,
    source.params,
    source.command,
    state.input,
    update.input,
    update.arguments,
    update.args,
    update.params,
    update.command,
    args.toolCall.input,
  );
  const rawOutput = firstMeaningful(
    source.rawOutput,
    source.raw_output,
    update.rawOutput,
    update.raw_output,
  );
  const fallbackOutput = firstMeaningful(
    source.output,
    source.result,
    source.content,
    source.text,
    state.output,
    update.output,
    update.result,
    update.content,
    update.text,
    args.toolCall.output,
  );
  const input = parsePayload(hasMeaningfulValue(rawInput) ? rawInput : fallbackInput);
  const output = parsePayload(hasMeaningfulValue(rawOutput) ? rawOutput : fallbackOutput);
  const toolName = resolveStructuredToolName(input) ?? firstPrimitiveString(
    source.toolName,
    source.tool_name,
    source.name,
    source.tool,
    recordFrom(source.function).name,
    update.toolName,
    update.tool_name,
    update.name,
  );
  const inputRecord = recordFrom(input);
  const namespace = firstPrimitiveString(
    inputRecord.namespace,
    inputRecord.server,
    inputRecord.serverName,
    inputRecord.server_name,
    source.namespace,
    update.namespace,
  );
  const descriptor = [namespace, toolName, args.toolCall.title]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return {
    providerId: args.providerId,
    sessionId: args.sessionId,
    cwd: args.cwd,
    toolCall: args.toolCall,
    update: args.update,
    toolName,
    namespace,
    descriptor,
    input,
    output,
    inputText: serializableStringFrom(input),
    outputText: serializableStringFrom(output),
  };
}

export function promptEventsToToolObservations(
  events: Array<{ type: string; toolCall?: AgentToolCall }>,
  args: { providerId: string; sessionId: string; cwd: string },
): ToolObservation[] {
  return events.flatMap((event) => event.type === "tool-call" && event.toolCall
    ? [createToolObservation({
        providerId: args.providerId,
        sessionId: args.sessionId,
        cwd: args.cwd,
        toolCall: event.toolCall,
        update: event,
      })]
    : []);
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function firstMeaningful(...values: unknown[]): unknown {
  return values.find((value) => hasMeaningfulValue(value));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function firstPrimitiveString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}
