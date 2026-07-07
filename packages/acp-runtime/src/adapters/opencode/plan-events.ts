import type {
  AgentPlan,
  AgentPlanEntryPriority,
  AgentPlanEntryStatus,
  AgentToolCall,
} from "@tiller/shared";
import { SUPPRESS_SESSION_UPDATE, type AcpSessionUpdateProjection, type AcpSessionUpdateProjectionContext } from "../types";

export function mapOpenCodePlanUpdate(
  context: AcpSessionUpdateProjectionContext,
): AcpSessionUpdateProjection | null {
  if (context.updateType !== "tool_call" && context.updateType !== "tool_call_update") {
    return null;
  }
  const source = sourceFrom(context.update);
  const toolName = stringFrom(source.tool ?? source.toolName ?? source.tool_name ?? source.name).toLowerCase();
  const todos = extractTodoList(source);
  const countOnlyTodo = isCountOnlyTodoUpdate(source);
  if (!isOpenCodePlanToolName(toolName) && !todos && !countOnlyTodo) {
    return null;
  }
  if (!todos) {
    return countOnlyTodo ? SUPPRESS_SESSION_UPDATE : null;
  }
  const plan = extractOpenCodePlanFromSource(source, context.now ?? new Date().toISOString());
  if (!plan) {
    return null;
  }
  return {
    type: "plan-update",
    plan,
  };
}

export function extractOpenCodePlanFromToolCall(toolCall: AgentToolCall): AgentPlan | null {
  return extractOpenCodePlanFromSource({
    input: toolCall.input,
    output: toolCall.output,
    title: toolCall.title,
  }, toolCall.updatedAt ?? toolCall.timestamp);
}

export function isOpenCodePlanToolCall(toolCall: AgentToolCall) {
  return toolCall.kind === "todo" ||
    isCountOnlyTodoUpdate({ title: toolCall.title }) ||
    isOpenCodePlanToolName(toolCall.title) ||
    Boolean(extractOpenCodePlanFromToolCall(toolCall));
}

function extractOpenCodePlanFromSource(
  source: Record<string, unknown>,
  updatedAt: string,
): AgentPlan | null {
  const todos = extractTodoList(source);
  if (!todos) {
    return null;
  }
  return {
    updatedAt,
    entries: todos.flatMap((item) => {
      const content = stringFrom(item.content ?? item.step ?? item.title ?? item.text).trim();
      if (!content) {
        return [];
      }
      return [{
        content,
        priority: normalizeTodoPriority(item.priority),
        status: normalizeTodoStatus(item.status),
      }];
    }),
  };
}

function isCountOnlyTodoUpdate(source: Record<string, unknown>) {
  const title = stringFrom(source.title ?? source.label ?? source.displayName ?? source.display_name).trim();
  return /^\d+\s+todos?$/iu.test(title);
}

function isOpenCodePlanToolName(value: string) {
  return /todo[_-]?write|todo[_-]?read|todos?/u.test(value.trim().toLowerCase());
}

function sourceFrom(update: unknown): Record<string, unknown> {
  if (!update || typeof update !== "object") {
    return {};
  }
  const record = update as Record<string, unknown>;
  const source = record.toolCall ?? record.tool_call ?? record.tool ?? record;
  return source && typeof source === "object" && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {};
}

function extractTodoList(source: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const input = parseInput(
    nestedInput(source.state) ??
      source.rawInput ??
      source.raw_input ??
      source.input ??
      source.arguments ??
      source.args ??
      source.params,
  );
  const candidates = [
    input,
      input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).todos : null,
      input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).items : null,
      parseInput(source.output),
      source.todos,
    ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
      );
    }
  }
  return null;
}

function nestedInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return (value as Record<string, unknown>).input;
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

function normalizeTodoStatus(value: unknown): AgentPlanEntryStatus {
  if (value === "completed" || value === "done") {
    return "completed";
  }
  if (value === "in_progress" || value === "running") {
    return "in_progress";
  }
  return "pending";
}

function normalizeTodoPriority(value: unknown): AgentPlanEntryPriority {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}
