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

type ClaudeTaskEntry = {
  content: string;
  priority: AgentPlanEntryPriority;
  status: AgentPlanEntryStatus;
  order: number;
};

type ClaudeLivePlanState = {
  tasks: Map<string, ClaudeTaskEntry>;
  toolCallTaskIds: Map<string, string>;
};

export function createClaudePlanUpdateProjector() {
  const sessions = new Map<string, ClaudeLivePlanState>();

  const mapUpdate = (
    context: AcpSessionUpdateProjectionContext,
  ): AcpSessionUpdateProjection | null => {
    if (context.updateType !== "tool_call" && context.updateType !== "tool_call_update") {
      return null;
    }

    const update = recordFrom(context.update);
    const source = sourceFrom(update);
    const toolName = normalizeToolName(resolveToolName(source, update));
    const toolCallId = resolveToolCallId(source, update);
    const existingState = sessions.get(context.sessionId);
    if (toolName === "todowrite") {
      const plan = extractTodoWritePlanFromSource(
        source,
        update,
        context.now ?? new Date().toISOString(),
      );
      return plan ? { type: "plan-update", plan } : null;
    }
    const isKnownTaskCreateUpdate =
      !toolName && Boolean(toolCallId) && existingState?.toolCallTaskIds.has(toolCallId);
    if (toolName !== "taskcreate" && toolName !== "taskupdate" && !isKnownTaskCreateUpdate) {
      return null;
    }

    const state = existingState ?? resolveLivePlanState(sessions, context.sessionId);
    const input = extractToolInput(source, update);
    const output = resolveToolOutput(source, update);
    const changed = toolName === "taskcreate" || isKnownTaskCreateUpdate
      ? applyTaskCreate(state, input, output, toolCallId)
      : applyTaskUpdate(state, input);
    if (!changed) {
      return null;
    }

    return {
      type: "plan-update",
      plan: {
        entries: liveTaskEntries(state),
        updatedAt: context.now ?? new Date().toISOString(),
      },
    };
  };

  return {
    mapUpdate,
    disposeSession: (sessionId: string) => {
      sessions.delete(sessionId);
    },
  };
}

export function extractClaudePlanFromToolCalls(
  toolCalls: AgentToolCall[],
): AgentPlan | null {
  const tasks = new Map<string, ClaudeTaskEntry>();
  let latestTodoWritePlan: AgentPlan | null = null;
  let latestTodoWriteIndex = -1;
  let latestTaskIndex = -1;
  let lastUpdatedAt = "";

  for (const [index, toolCall] of toolCalls.entries()) {
    const toolName = normalizeToolName(toolCall.title);
    if (toolName === "todowrite") {
      const plan = extractTodoWritePlan(toolCall);
      if (plan) {
        latestTodoWritePlan = plan;
        latestTodoWriteIndex = index;
      }
      continue;
    }

    if (toolName === "taskcreate") {
      const input = recordFrom(parsePayload(toolCall.input));
      const content = firstString(
        input.subject,
        input.content,
        input.title,
        input.text,
        input.activeForm,
        input.active_form,
        input.description,
      ).trim();
      if (!content) {
        continue;
      }
      const taskId = resolveCreatedTaskId(input, toolCall) ?? toolCall.id;
      tasks.set(taskId, {
        content,
        priority: normalizePriority(input.priority),
        status: normalizeStatus(input.status),
        order: tasks.size,
      });
      latestTaskIndex = index;
      lastUpdatedAt = resolveToolUpdatedAt(toolCall);
      continue;
    }

    if (toolName === "taskupdate") {
      const input = recordFrom(parsePayload(toolCall.input));
      const taskId = firstString(input.taskId, input.task_id, input.id);
      if (!taskId) {
        continue;
      }
      const current = tasks.get(taskId);
      if (!current) {
        continue;
      }
      tasks.set(taskId, {
        ...current,
        status: normalizeStatus(input.status),
      });
      latestTaskIndex = index;
      lastUpdatedAt = resolveToolUpdatedAt(toolCall);
    }
  }

  const entries = [...tasks.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ content, priority, status }) => ({ content, priority, status }));
  const taskPlan = entries.length && lastUpdatedAt
    ? { entries, updatedAt: lastUpdatedAt }
    : null;
  return latestTodoWriteIndex > latestTaskIndex
    ? latestTodoWritePlan ?? taskPlan
    : taskPlan ?? latestTodoWritePlan;
}

function extractTodoWritePlan(toolCall: AgentToolCall): AgentPlan | null {
  const input = parsePayload(toolCall.input);
  return buildTodoWritePlan(
    [
      input,
      recordFrom(input).todos,
      recordFrom(input).items,
      parsePayload(toolCall.output),
    ],
    resolveToolUpdatedAt(toolCall),
  );
}

function extractTodoWritePlanFromSource(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
  updatedAt: string,
): AgentPlan | null {
  const input = extractToolInput(source, update);
  return buildTodoWritePlan(
    [
      input,
      recordFrom(input).todos,
      recordFrom(input).items,
      parsePayload(resolveToolOutput(source, update)),
    ],
    updatedAt,
  );
}

function buildTodoWritePlan(candidates: unknown[], updatedAt: string): AgentPlan | null {
  const todos = candidates.find(Array.isArray);
  if (!todos) {
    return null;
  }
  const entries = todos.flatMap((item) => {
    const record = recordFrom(item);
    const content = firstString(
      record.content,
      record.step,
      record.subject,
      record.title,
      record.text,
    ).trim();
    if (!content) {
      return [];
    }
    return [{
      content,
      priority: normalizePriority(record.priority),
      status: normalizeStatus(record.status),
    }];
  });
  return entries.length ? { entries, updatedAt } : null;
}

function applyTaskCreate(
  state: ClaudeLivePlanState,
  input: Record<string, unknown>,
  output: string,
  toolCallId: string,
) {
  const content = resolveTaskContent(input);
  const explicitTaskId = resolveTaskId(input, output);
  const previousTaskId = toolCallId ? state.toolCallTaskIds.get(toolCallId) : undefined;
  const previous = previousTaskId ? state.tasks.get(previousTaskId) : undefined;
  const taskId = explicitTaskId || previousTaskId || toolCallId || content;
  if (!taskId || (!content && !previous)) {
    return false;
  }

  if (previousTaskId && previousTaskId !== taskId && previous) {
    state.tasks.delete(previousTaskId);
  }
  const current = previous ?? state.tasks.get(taskId);
  state.tasks.set(taskId, {
    content: content || (current?.content ?? ""),
    priority: input.priority === undefined
      ? current?.priority ?? "medium"
      : normalizePriority(input.priority),
    status: input.status === undefined
      ? current?.status ?? "pending"
      : normalizeStatus(input.status),
    order: current?.order ?? state.tasks.size,
  });
  if (toolCallId) {
    state.toolCallTaskIds.set(toolCallId, taskId);
  }
  return true;
}

function applyTaskUpdate(
  state: ClaudeLivePlanState,
  input: Record<string, unknown>,
) {
  const taskId = firstString(input.taskId, input.task_id, input.id);
  if (!taskId) {
    return false;
  }
  const current = state.tasks.get(taskId);
  if (!current) {
    return false;
  }
  state.tasks.set(taskId, {
    ...current,
    status: normalizeStatus(input.status),
  });
  return true;
}

function resolveLivePlanState(
  sessions: Map<string, ClaudeLivePlanState>,
  sessionId: string,
) {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { tasks: new Map(), toolCallTaskIds: new Map() };
    sessions.set(sessionId, state);
  }
  return state;
}

function liveTaskEntries(state: ClaudeLivePlanState): AgentPlan["entries"] {
  return [...state.tasks.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ content, priority, status }) => ({ content, priority, status }));
}

function resolveCreatedTaskId(
  input: Record<string, unknown>,
  toolCall: AgentToolCall,
) {
  return firstString(input.taskId, input.task_id, input.id) ||
    /^Task\s+#(?<id>\d+)\s+created\b/iu.exec(toolCall.output ?? "")?.groups?.id;
}

function resolveTaskId(
  input: Record<string, unknown>,
  output: string,
) {
  return firstString(input.taskId, input.task_id, input.id) ||
    /^Task\s+#(?<id>\d+)\s+created\b/iu.exec(output)?.groups?.id;
}

function resolveTaskContent(input: Record<string, unknown>) {
  return firstString(
    input.subject,
    input.content,
    input.title,
    input.text,
    input.activeForm,
    input.active_form,
    input.description,
  ).trim();
}

function normalizeToolName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function resolveToolName(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  return firstString(
    source.toolName,
    source.tool_name,
    source.tool,
    source.name,
    source.title,
    update.toolName,
    update.tool_name,
    update.tool,
    update.name,
    update.title,
  );
}

function sourceFrom(update: Record<string, unknown>) {
  const source = update.toolCall ?? update.tool_call ?? update.tool ?? update;
  return recordFrom(source);
}

function extractToolInput(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  return recordFrom(parsePayload(
    nestedInput(source.state) ??
      source.rawInput ??
      source.raw_input ??
      source.input ??
      source.arguments ??
      source.args ??
      source.params ??
      update.rawInput ??
      update.raw_input ??
      update.input ??
      update.arguments ??
      update.args ??
      update.params,
  ));
}

function resolveToolOutput(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  return firstString(
    source.rawOutput,
    source.raw_output,
    source.output,
    source.result,
    update.rawOutput,
    update.raw_output,
    update.output,
    update.result,
  );
}

function resolveToolCallId(
  source: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  return firstString(
    source.toolCallId,
    source.tool_call_id,
    source.id,
    update.toolCallId,
    update.tool_call_id,
    update.id,
  );
}

function nestedInput(value: unknown): unknown {
  return recordFrom(value).input;
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function normalizePriority(value: unknown): AgentPlanEntryPriority {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

function normalizeStatus(value: unknown): AgentPlanEntryStatus {
  if (value === "completed" || value === "complete" || value === "done") {
    return "completed";
  }
  if (value === "in_progress" || value === "running" || value === "active") {
    return "in_progress";
  }
  return "pending";
}

function resolveToolUpdatedAt(toolCall: AgentToolCall) {
  return toolCall.updatedAt ?? toolCall.timestamp;
}
