import type {
  AgentPlan,
  AgentPlanEntryPriority,
  AgentPlanEntryStatus,
  AgentToolCall,
} from "@tiller/shared";
import type {
  AcpSessionUpdateProjection,
  AcpSessionUpdateProjectionContext,
} from "../types";

export function mapCodexPlanUpdate(
  context: AcpSessionUpdateProjectionContext,
): AcpSessionUpdateProjection | null {
  if (context.updateType !== "tool_call" && context.updateType !== "tool_call_update") {
    return null;
  }

  const update = recordFrom(context.update);
  const source = sourceFrom(update);
  if (!isCodexPlanToolName(resolveToolName(source, update))) {
    return null;
  }

  const plan = extractCodexPlanFromSource(
    source,
    update,
    context.now ?? new Date().toISOString(),
  );
  return plan ? { type: "plan-update", plan } : null;
}

export function extractCodexPlanFromToolCall(toolCall: AgentToolCall): AgentPlan | null {
  if (!isCodexPlanToolName(toolCall.title)) {
    return null;
  }
  return extractCodexPlanFromSource(
    { title: toolCall.title, input: toolCall.input, output: toolCall.output },
    {},
    toolCall.updatedAt ?? toolCall.timestamp,
  );
}

export function isCodexPlanToolCall(toolCall: AgentToolCall) {
  return toolCall.kind === "todo" ||
    isCodexPlanToolName(toolCall.title) ||
    Boolean(extractCodexPlanFromToolCall(toolCall));
}

function extractCodexPlanFromSource(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
  updatedAt: string,
): AgentPlan | null {
  const items = [
    nestedInput(source.state),
    source.rawInput,
    source.raw_input,
    source.input,
    source.arguments,
    source.args,
    source.params,
    update.rawInput,
    update.raw_input,
    update.input,
    update.arguments,
    update.args,
    update.params,
  ]
    .map(extractPlanItems)
    .find((candidate): candidate is Record<string, unknown>[] => Boolean(candidate));

  if (!items) {
    return null;
  }

  return {
    updatedAt,
    entries: items.flatMap((item) => {
      const content = stringFrom(item.step ?? item.content ?? item.title ?? item.text).trim();
      if (!content) {
        return [];
      }
      return [{
        content,
        priority: normalizePriority(item.priority),
        status: normalizeStatus(item.status),
      }];
    }),
  };
}

function extractPlanItems(value: unknown): Record<string, unknown>[] | null {
  const parsed = parseInput(value);
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }
  if (!isRecord(parsed)) {
    return null;
  }

  for (const key of ["plan", "entries", "todos", "items"]) {
    const candidate = parsed[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  for (const key of ["arguments", "args", "params", "input"]) {
    const nested = extractPlanItems(parsed[key]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function resolveToolName(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  const rawName =
    optionalStringFrom(source.toolName) ??
    optionalStringFrom(source.tool_name) ??
    optionalStringFrom(source.tool) ??
    optionalStringFrom(source.name) ??
    optionalStringFrom(update.toolName) ??
    optionalStringFrom(update.tool_name) ??
    optionalStringFrom(update.tool) ??
    optionalStringFrom(update.name) ??
    optionalStringFrom(source.title) ??
    "";
  const namespace = optionalStringFrom(source.namespace ?? update.namespace);
  return namespace && rawName ? `${namespace}.${rawName}` : rawName;
}

export function isCodexPlanToolName(value: string) {
  return /(?:^|[./\s_-])update[_-]?plan$/iu.test(value.trim());
}

function sourceFrom(update: Record<string, unknown>) {
  const source = update.toolCall ?? update.tool_call ?? update.tool ?? update;
  return isRecord(source) ? source : {};
}

function nestedInput(value: unknown): unknown {
  return isRecord(value) ? value.input : undefined;
}

function parseInput(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeStatus(value: unknown): AgentPlanEntryStatus {
  if (value === "completed" || value === "complete" || value === "done") {
    return "completed";
  }
  if (value === "in_progress" || value === "running") {
    return "in_progress";
  }
  return "pending";
}

function normalizePriority(value: unknown): AgentPlanEntryPriority {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

function recordFrom(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalStringFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
