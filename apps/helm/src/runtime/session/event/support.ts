import type { AgentToolCall, CommandChunk } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import type { TillerLogFields } from "../../../logging/logger";
import type { SessionRuntimeEventState } from "./runtime-state";

export const RUNTIME_EVENT_STATE_KEY = {
  assistantDeltaTimer: "assistant-delta-timer",
  commandOutputSummaries: "command-output-summaries",
  ignoredUserEchoSummary: "ignored-user-echo-summary",
  pendingCommandOutput: "pending-command-output",
  pendingRunningToolCall: "pending-running-tool-call",
  pendingToolCallPlaceholders: "pending-tool-call-placeholders",
  planLogState: "plan-log-state",
  activeToolCalls: "active-tool-calls",
  completedBackgroundTasks: "completed-background-tasks",
  historicalToolCalls: "historical-tool-calls",
  toolCallClassifications: "tool-call-classifications",
  toolCallOccurrences: "tool-call-occurrences",
} as const;

const DEFAULT_ASSISTANT_FLUSH_WINDOW_MS = 32;
const DEFAULT_ASSISTANT_MAX_CHARS = 256;
const DEFAULT_COMMAND_OUTPUT_FLUSH_WINDOW_MS = 32;
const DEFAULT_COMMAND_OUTPUT_MAX_CHARS = 256;
const DEFAULT_RUNNING_TOOL_CALL_FLUSH_WINDOW_MS = 64;
const DEFAULT_RUNNING_TOOL_CALL_MAX_CHARS = 512;

export const MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS = 2_048;

export type TimerHandle = ReturnType<typeof setTimeout>;

export type RuntimePlanLogState = {
  lastEntryCount: number;
};

export type CommandOutputSummary = {
  chars: number;
  chunks: number;
  commandId: string;
  firstSeq: number;
  lastSeq: number;
  stream: string;
};

export type PendingCommandOutput = {
  chunk: CommandChunk;
  inputChunks: number;
  timer?: TimerHandle;
};

export type PendingRunningToolCall = {
  toolCall: AgentToolCall;
  bufferedChars: number;
  hasUnflushedChanges: boolean;
  timer?: TimerHandle;
};

export type PendingToolCallPlaceholder = {
  toolCall: AgentToolCall;
  timer?: TimerHandle;
};

export type PendingToolCallPlaceholders = Map<string, PendingToolCallPlaceholder>;

export type StableToolCallClassification = Pick<AgentToolCall, "kind"> & {
  mcp?: AgentToolCall["mcp"];
  title?: string;
};

export type StableToolCallOccurrence = Pick<
  AgentToolCall,
  "sequence" | "timestamp" | "status"
>;

export type IgnoredUserEchoSummary = {
  count: number;
  firstMessageId: string;
  firstSeq: number;
  lastMessageId: string;
  lastSeq: number;
  messageIds: Set<string>;
  totalChars: number;
};

export function runtimeLogScope(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  return `session=${sessionId} agent=${record?.agent?.id ?? "<stored>"} cwd=${record?.worktree?.path ?? "<stored>"}`;
}

export function runtimeLogFields(
  sessionId: string,
  context: HelmHandlerContext,
): TillerLogFields {
  const record = context.sessions.get(sessionId);
  return {
    sessionId,
    agentId: record?.agent?.id ?? "<stored>",
    cwd: record?.worktree?.path ?? "<stored>",
  };
}

export function logRuntimeDebug(
  context: HelmHandlerContext,
  event: string,
  fields: TillerLogFields,
) {
  if (context.logger) {
    context.logger.debug(event, fields);
    return;
  }
  context.logDebug?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

export function logRuntimeInfo(
  context: HelmHandlerContext,
  event: string,
  fields: TillerLogFields,
) {
  if (context.logger) {
    context.logger.info(event, fields);
    return;
  }
  context.logInfo?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

export function logRuntimeError(
  context: HelmHandlerContext,
  event: string,
  fields: TillerLogFields,
) {
  if (context.logger) {
    context.logger.error(event, fields);
    return;
  }
  context.logError?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: TillerLogFields) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

export function runtimeEventState(context: HelmHandlerContext): SessionRuntimeEventState {
  if (context.sessionRuntimeEventState) {
    return context.sessionRuntimeEventState;
  }
  throw new Error("Runtime event state is required.");
}

export function resolveRuntimeEventThrottleConfig(context: HelmHandlerContext) {
  return {
    assistantWindowMs:
      context.runtimeEventThrottleConfig?.assistantWindowMs ?? DEFAULT_ASSISTANT_FLUSH_WINDOW_MS,
    assistantMaxChars:
      context.runtimeEventThrottleConfig?.assistantMaxChars ?? DEFAULT_ASSISTANT_MAX_CHARS,
    commandOutputWindowMs:
      context.runtimeEventThrottleConfig?.commandOutputWindowMs ?? DEFAULT_COMMAND_OUTPUT_FLUSH_WINDOW_MS,
    commandOutputMaxChars:
      context.runtimeEventThrottleConfig?.commandOutputMaxChars ?? DEFAULT_COMMAND_OUTPUT_MAX_CHARS,
    toolCallWindowMs:
      context.runtimeEventThrottleConfig?.toolCallWindowMs ?? DEFAULT_RUNNING_TOOL_CALL_FLUSH_WINDOW_MS,
    toolCallMaxChars:
      context.runtimeEventThrottleConfig?.toolCallMaxChars ?? DEFAULT_RUNNING_TOOL_CALL_MAX_CHARS,
    setTimeoutFn:
      context.runtimeEventThrottleConfig?.setTimeoutFn ??
      ((callback: () => void, delay: number) => setTimeout(callback, delay)),
    clearTimeoutFn:
      context.runtimeEventThrottleConfig?.clearTimeoutFn ??
      ((timer: TimerHandle) => clearTimeout(timer)),
  };
}

export function scheduleRuntimeEventTimer(
  context: HelmHandlerContext,
  callback: () => void,
  delay: number,
) {
  const handle = resolveRuntimeEventThrottleConfig(context).setTimeoutFn(callback, delay);
  handle.unref?.();
  return handle;
}

export function clearRuntimeEventTimer(
  context: HelmHandlerContext,
  timer: TimerHandle | undefined,
) {
  if (!timer) {
    return;
  }
  resolveRuntimeEventThrottleConfig(context).clearTimeoutFn(timer);
}
