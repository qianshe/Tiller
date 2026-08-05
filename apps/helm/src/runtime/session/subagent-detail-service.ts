import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionSubagentDetailStore } from "@tiller/persistence";
import {
  mergeStreamingText,
  type AgentMessage,
  type AgentToolCall,
  type CommandChunk,
  type SessionSubagentDetail,
  type SessionSubagentDetailDelta,
  type SessionTimelineBatch,
  type SessionTimelineEntry,
} from "@tiller/shared";
import { createSessionTimelineWorker, type SessionTimelineWorker } from "../session-timeline/worker";

const DEFAULT_FLUSH_WINDOW_MS = 50;

type DetailState = {
  nextSequence: number;
  worker: SessionTimelineWorker;
  invocations: Map<string, DetailInvocationState>;
  pendingCommits: SessionTimelineBatch[];
  pendingOutputs: Map<string, CommandChunk[]>;
  latestTools: Map<string, AgentToolCall>;
  toolAliases: Map<string, string>;
  timer?: ReturnType<typeof setTimeout>;
};

type DetailInvocationState = {
  prompt?: string;
  hasAssistantContent: boolean;
  assistantMessageId?: string;
  fallbackMessageId?: string;
  namespace?: string;
};

type SubagentContentEvent = Extract<
  SessionRuntimeEvent,
  { type: "message" | "tool-call" | "command-output" }
>;

type SessionSubagentDetailServiceOptions = {
  store: SessionSubagentDetailStore;
  publish: (sessionId: string, delta: SessionSubagentDetailDelta) => void;
  materializeCommandOutput?: (sessionId: string, chunk: CommandChunk) => CommandChunk;
  logError?: (message: string) => void;
  flushWindowMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

export type SessionSubagentDetailService = ReturnType<typeof createSessionSubagentDetailService>;

export function createSessionSubagentDetailService(options: SessionSubagentDetailServiceOptions) {
  const states = new Map<string, DetailState>();
  const detailAliases = new Map<string, string>();
  const deletingSessions = new Set<string>();
  const flushWindowMs = options.flushWindowMs ?? DEFAULT_FLUSH_WINDOW_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  function handleEvent(
    sessionId: string,
    parentToolCallId: string,
    event: SubagentContentEvent,
  ) {
    if (deletingSessions.has(sessionId)) return;
    const canonicalParentToolCallId = resolveDetailParentId(sessionId, parentToolCallId);
    const state = getState(sessionId, canonicalParentToolCallId);
    const invocation = resolveInvocation(state, parentToolCallId);
    const localized = reconcileFallbackAssistantMessage(
      invocation,
      localizeEvent(state, invocation.namespace, event),
    );
    if (localized.type === "tool-call") {
      const toolCall = stabilizeToolCall(
        state,
        omitProjectedCommandOutput(localized.toolCall),
      );
      state.worker.enqueue({ type: "tool-call", toolCall });
      applyPendingOutputs(state, toolCall);
      if (isTerminalStatus(toolCall.status)) {
        flushState(sessionId, canonicalParentToolCallId, state);
        return;
      }
      scheduleFlush(sessionId, canonicalParentToolCallId, state);
      return;
    }
    if (localized.type === "command-output") {
      const chunk = options.materializeCommandOutput?.(sessionId, localized.chunk) ?? localized.chunk;
      if (!mergeCommandOutputIntoTool(state, chunk)) {
        const pending = state.pendingOutputs.get(chunk.commandId) ?? [];
        pending.push(chunk);
        state.pendingOutputs.set(chunk.commandId, pending);
      }
      scheduleFlush(sessionId, canonicalParentToolCallId, state);
      return;
    }
    state.worker.enqueue(localized);
    if (isAssistantContentMessage(localized.message)) {
      invocation.hasAssistantContent = true;
    }
    if (localized.message.streaming === false) {
      flushState(sessionId, canonicalParentToolCallId, state);
      return;
    }
    scheduleFlush(sessionId, canonicalParentToolCallId, state);
  }

  function registerRoot(sessionId: string, toolCall: AgentToolCall) {
    if (deletingSessions.has(sessionId) || toolCall.kind !== "subagent") return;
    let parentToolCallId = resolveRootDetailParentId(toolCall);
    const previousParentToolCallId = detailAliases.get(stateKey(sessionId, toolCall.id));
    if (previousParentToolCallId && previousParentToolCallId !== parentToolCallId) {
      const migrated = migrateDetailParent(sessionId, previousParentToolCallId, parentToolCallId);
      if (!migrated) {
        parentToolCallId = previousParentToolCallId;
      }
    }
    rememberDetailAlias(sessionId, toolCall.id, parentToolCallId);
    rememberDetailAlias(sessionId, parentToolCallId, parentToolCallId);
    const prompt = resolveSubagentPrompt(toolCall.input ?? "");
    const state = getState(sessionId, parentToolCallId);
    const invocation = resolveInvocation(state, toolCall.id);
    if (prompt && prompt !== invocation.prompt) {
      const message: AgentMessage = {
        id: `subagent-prompt:${toolCall.id}`,
        role: "user",
        text: prompt,
        timestamp: toolCall.timestamp,
        sequence: ++state.nextSequence,
        streaming: false,
        streamMode: "snapshot",
      };
      state.worker.enqueue({ type: "message", message });
      invocation.prompt = prompt;
    }
    if (
      toolCall.status === "completed" &&
      !invocation.hasAssistantContent &&
      !invocation.fallbackMessageId
    ) {
      const result = toolCall.output?.trim();
      if (result) {
        const messageId = `subagent-result:${toolCall.id}`;
        const message: AgentMessage = {
          id: messageId,
          role: "assistant",
          text: result,
          timestamp: toolCall.updatedAt,
          sequence: ++state.nextSequence,
          streaming: false,
          streamMode: "snapshot",
        };
        invocation.assistantMessageId = messageId;
        invocation.fallbackMessageId = messageId;
        state.worker.enqueue({ type: "message", message });
      }
    }
    if (isTerminalStatus(toolCall.status)) {
      flushState(sessionId, parentToolCallId, state);
      return;
    }
    if (prompt) scheduleFlush(sessionId, parentToolCallId, state);
  }

  function getDetail(sessionId: string, parentToolCallId: string): SessionSubagentDetail {
    const canonicalParentToolCallId = resolveDetailParentId(sessionId, parentToolCallId);
    if (!deletingSessions.has(sessionId)) {
      const state = states.get(stateKey(sessionId, canonicalParentToolCallId));
      if (state) flushState(sessionId, canonicalParentToolCallId, state);
    }
    return options.store.get(sessionId, canonicalParentToolCallId);
  }

  function flush(sessionId: string, parentToolCallId?: string) {
    if (deletingSessions.has(sessionId)) return;
    if (parentToolCallId) {
      const canonicalParentToolCallId = resolveDetailParentId(sessionId, parentToolCallId);
      const state = states.get(stateKey(sessionId, canonicalParentToolCallId));
      if (state) flushState(sessionId, canonicalParentToolCallId, state);
      return;
    }
    for (const [key, state] of states) {
      const parsed = parseStateKey(key);
      if (parsed.sessionId === sessionId) {
        flushState(parsed.sessionId, parsed.parentToolCallId, state);
      }
    }
  }

  function beginDelete(sessionId: string) {
    deletingSessions.add(sessionId);
    for (const [key, state] of states) {
      if (parseStateKey(key).sessionId !== sessionId) continue;
      if (state.timer) clearTimeoutFn(state.timer);
      states.delete(key);
    }
    const aliasPrefix = `${sessionId}\0`;
    for (const key of detailAliases.keys()) {
      if (key.startsWith(aliasPrefix)) detailAliases.delete(key);
    }
  }

  function remove(sessionId: string) {
    beginDelete(sessionId);
    options.store.remove(sessionId);
  }

  function dispose() {
    for (const [key, state] of states) {
      const parsed = parseStateKey(key);
      flushState(parsed.sessionId, parsed.parentToolCallId, state);
    }
    states.clear();
    detailAliases.clear();
  }

  function rememberDetailAlias(sessionId: string, alias: string, parentToolCallId: string) {
    detailAliases.set(stateKey(sessionId, alias), parentToolCallId);
  }

  function resolveDetailParentId(sessionId: string, parentToolCallId: string) {
    return detailAliases.get(stateKey(sessionId, parentToolCallId)) ?? parentToolCallId;
  }

  function migrateDetailParent(
    sessionId: string,
    previousParentToolCallId: string,
    nextParentToolCallId: string,
  ): boolean {
    const previousKey = stateKey(sessionId, previousParentToolCallId);
    const nextKey = stateKey(sessionId, nextParentToolCallId);
    const previousState = states.get(previousKey);
    if (previousState) {
      flushState(sessionId, previousParentToolCallId, previousState);
    }
    const nextState = states.get(nextKey);
    if (nextState) {
      flushState(sessionId, nextParentToolCallId, nextState);
    }

    const previousDetail = options.store.get(sessionId, previousParentToolCallId);
    if (previousDetail.entries.length > 0) {
      try {
        options.store.commitBatch(sessionId, nextParentToolCallId, {
          replace: false,
          deliverySequence: previousDetail.throughSequence,
          lastSequence: previousDetail.throughSequence,
          entries: previousDetail.entries,
        });
      } catch (error) {
        options.logError?.(
          `[tiller] subagent.detail.migrate_failed session=${sessionId} from=${previousParentToolCallId} to=${nextParentToolCallId} message=${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    }
    states.delete(previousKey);
    states.delete(nextKey);
    rememberDetailAlias(sessionId, previousParentToolCallId, nextParentToolCallId);
    return true;
  }

  function getState(sessionId: string, parentToolCallId: string): DetailState {
    const key = stateKey(sessionId, parentToolCallId);
    const existing = states.get(key);
    if (existing) return existing;
    const detail = options.store.get(sessionId, parentToolCallId);
    const next: DetailState = {
      nextSequence: detail.throughSequence,
      worker: createSessionTimelineWorker({
        sessionId: key,
        lastSequence: detail.throughSequence,
        initialEntries: detail.entries,
      }),
      invocations: loadInvocationStates(detail.entries),
      pendingCommits: [],
      pendingOutputs: new Map(),
      latestTools: new Map(),
      toolAliases: new Map(),
    };
    for (const entry of detail.entries) {
      if (entry.kind === "tool_call") stabilizeToolCall(next, entry.toolCall);
    }
    states.set(key, next);
    return next;
  }

  function resolveInvocation(state: DetailState, invocationId: string) {
    const existing = state.invocations.get(invocationId);
    if (existing) {
      return existing;
    }
    const invocation = getInvocation(state, invocationId);
    if (state.worker.aggregate().entries.length || state.invocations.size > 1) {
      invocation.namespace = `subagent:${invocationId}:`;
    }
    return invocation;
  }

  function getInvocation(state: DetailState, invocationId: string) {
    const existing = state.invocations.get(invocationId);
    if (existing) return existing;
    const invocation: DetailInvocationState = { hasAssistantContent: false };
    state.invocations.set(invocationId, invocation);
    return invocation;
  }

  function scheduleFlush(sessionId: string, parentToolCallId: string, state: DetailState) {
    if (state.timer || deletingSessions.has(sessionId)) return;
    state.timer = setTimeoutFn(() => {
      state.timer = undefined;
      flushState(sessionId, parentToolCallId, state);
    }, flushWindowMs);
    state.timer.unref?.();
  }

  function flushState(sessionId: string, parentToolCallId: string, state: DetailState) {
    if (deletingSessions.has(sessionId)) return;
    if (state.timer) {
      clearTimeoutFn(state.timer);
      state.timer = undefined;
    }
    for (const commit of state.worker.flush()) {
      state.pendingCommits.push(commit.batch);
    }
    while (state.pendingCommits.length > 0) {
      const batch = state.pendingCommits[0]!;
      try {
        options.store.commitBatch(sessionId, parentToolCallId, batch);
      } catch (error) {
        options.logError?.(
          `[tiller] subagent.detail.flush_failed session=${sessionId} parent=${parentToolCallId} message=${error instanceof Error ? error.message : String(error)}`,
        );
        scheduleFlush(sessionId, parentToolCallId, state);
        return;
      }
      state.pendingCommits.shift();
      for (const entry of batch.entries) {
        options.publish(sessionId, {
          sessionId,
          parentToolCallId,
          batch: { ...batch, entries: [entry] },
        });
      }
    }
  }

  return {
    beginDelete,
    dispose,
    flush,
    getDetail,
    handleEvent,
    registerRoot,
    remove,
  };
}

function localizeEvent(
  state: DetailState,
  namespace: string | undefined,
  event: SubagentContentEvent,
): SubagentContentEvent {
  const sequence = ++state.nextSequence;
  const localizeId = (kind: string, id: string) => namespace ? `${namespace}${kind}:${id}` : id;
  const localizeCommandId = (commandId: string) => namespace
    ? `${namespace}command:${commandId}`
    : commandId;
  if (event.type === "message") {
    return {
      type: "message",
      message: {
        ...event.message,
        id: localizeId("message", event.message.id),
        sequence,
      },
    };
  }
  if (event.type === "tool-call") {
    return {
      type: "tool-call",
      toolCall: {
        ...event.toolCall,
        id: localizeId("tool", event.toolCall.id),
        ...(event.toolCall.commandId
          ? { commandId: localizeCommandId(event.toolCall.commandId) }
          : {}),
        sequence,
      },
    };
  }
  return {
    type: "command-output",
    chunk: {
      ...event.chunk,
      id: localizeId("output", event.chunk.id),
      commandId: localizeCommandId(event.chunk.commandId),
      sequence,
    },
  };
}

function reconcileFallbackAssistantMessage(
  invocation: DetailInvocationState,
  event: SubagentContentEvent,
): SubagentContentEvent {
  if (
    event.type !== "message" ||
    !isAssistantContentMessage(event.message) ||
    !invocation.assistantMessageId
  ) {
    return event;
  }

  const replacesFallback = Boolean(invocation.fallbackMessageId);
  invocation.fallbackMessageId = undefined;
  return {
    ...event,
    message: {
      ...event.message,
      id: invocation.assistantMessageId,
      ...(replacesFallback ? { streamMode: "snapshot" as const } : {}),
    },
  };
}

function applyPendingOutputs(state: DetailState, toolCall: AgentToolCall) {
  const commandIds = [toolCall.commandId, toolCall.id]
    .filter((value): value is string => Boolean(value));
  const chunks = commandIds
    .flatMap((commandId) => state.pendingOutputs.get(commandId) ?? [])
    .filter((chunk, index, all) => all.indexOf(chunk) === index)
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  for (const commandId of commandIds) state.pendingOutputs.delete(commandId);
  for (const chunk of chunks) mergeCommandOutputIntoTool(state, chunk);
}

function mergeCommandOutputIntoTool(state: DetailState, chunk: CommandChunk) {
  const toolEntry = findToolEntry(state.worker.aggregate().entries, chunk.commandId);
  const entryId = state.toolAliases.get(chunk.commandId) ?? chunk.commandId;
  const currentToolCall = toolEntry?.toolCall ?? state.latestTools.get(entryId);
  if (!currentToolCall) return false;
  const toolCall = stabilizeToolCall(state, {
    ...currentToolCall,
    output: mergeStreamingText(currentToolCall.output, chunk.text, "delta"),
    stream: chunk.stream,
    updatedAt: chunk.timestamp,
    sequence: chunk.sequence,
  });
  state.worker.enqueue({
    type: "tool-call",
    toolCall,
  });
  return true;
}

function stabilizeToolCall(state: DetailState, incoming: AgentToolCall) {
  const entryId = resolveToolCallEntryId(state, incoming);
  const current = state.latestTools.get(entryId);
  const currentTerminal = current ? isTerminalStatus(current.status) : false;
  const incomingTerminal = isTerminalStatus(incoming.status);
  const toolCall: AgentToolCall = current
    ? {
        ...current,
        ...incoming,
        kind: isWeakKind(incoming.kind) && !isWeakKind(current.kind)
          ? current.kind
          : incoming.kind,
        title: isWeakTitle(incoming.title) && !isWeakTitle(current.title)
          ? current.title
          : incoming.title,
        status: currentTerminal && !incomingTerminal ? current.status : incoming.status,
        input: incoming.input ?? current.input,
        output: incoming.output ?? current.output,
        timestamp: current.timestamp,
        sequence: current.sequence ?? incoming.sequence,
      }
    : incoming;
  state.latestTools.set(entryId, toolCall);
  state.toolAliases.set(entryId, entryId);
  state.toolAliases.set(incoming.id, entryId);
  if (incoming.commandId) state.toolAliases.set(incoming.commandId, entryId);
  return toolCall;
}

function resolveToolCallEntryId(state: DetailState, incoming: AgentToolCall): string {
  const exactEntryId = state.toolAliases.get(incoming.id);
  const exactCurrent = exactEntryId ? state.latestTools.get(exactEntryId) : undefined;
  if (exactEntryId && exactCurrent) {
    return exactEntryId;
  }
  if (incoming.kind === "subagent") {
    return incoming.id;
  }
  const commandEntryId = incoming.commandId
    ? state.toolAliases.get(incoming.commandId)
    : undefined;
  const commandCurrent = commandEntryId ? state.latestTools.get(commandEntryId) : undefined;
  return commandCurrent?.kind === "subagent"
    ? incoming.id
    : commandEntryId ?? incoming.commandId ?? incoming.id;
}

function findToolEntry(entries: SessionTimelineEntry[], commandId: string) {
  return [...entries].reverse().find((entry): entry is Extract<
    SessionTimelineEntry,
    { kind: "tool_call" }
  > => entry.kind === "tool_call" && (
    entry.toolCall.commandId === commandId ||
    entry.toolCall.id === commandId ||
    entry.id === `tool:${commandId}`
  ));
}

function omitProjectedCommandOutput(toolCall: AgentToolCall): AgentToolCall {
  if (
    !toolCall.commandId ||
    toolCall.id !== `tool-${toolCall.commandId}` ||
    toolCall.output === undefined
  ) {
    return toolCall;
  }
  const { output: _projectedOutput, ...identitySnapshot } = toolCall;
  return identitySnapshot;
}

function stateKey(sessionId: string, parentToolCallId: string) {
  return `${sessionId}\0${parentToolCallId}`;
}

function parseStateKey(key: string) {
  const separator = key.indexOf("\0");
  return {
    sessionId: key.slice(0, separator),
    parentToolCallId: key.slice(separator + 1),
  };
}

function isTerminalStatus(status: AgentToolCall["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isWeakKind(kind: AgentToolCall["kind"]) {
  return kind === "tool" || kind === "unknown";
}

function isWeakTitle(title: string) {
  return !title.trim() || /^(tool|unknown|command)$/iu.test(title.trim());
}

function resolveSubagentPrompt(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    return findPrompt(JSON.parse(trimmed) as unknown, 0) ?? "";
  } catch {
    return trimmed;
  }
}

function findPrompt(value: unknown, depth: number): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const prompt = findPrompt(item, depth + 1);
      if (prompt) return prompt;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["prompt", "message", "task", "query", "instructions"]) {
    const prompt = findPrompt(record[key], depth + 1);
    if (prompt) return prompt;
  }
  for (const key of ["arguments", "args", "params", "input", "content"]) {
    const prompt = findPrompt(record[key], depth + 1);
    if (prompt) return prompt;
  }
  return undefined;
}

function resolveRootDetailParentId(toolCall: AgentToolCall) {
  return toolCall.commandId ?? toolCall.id;
}

function loadInvocationStates(entries: SessionTimelineEntry[]) {
  const prompts = entries
    .filter((entry): entry is Extract<SessionTimelineEntry, { kind: "user_message" | "system_message" }> =>
      entry.kind === "user_message" && entry.id.startsWith("subagent-prompt:"),
    )
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const invocations = new Map<string, DetailInvocationState>();
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index]!;
    const invocationId = prompt.id.slice("subagent-prompt:".length);
    const nextPromptSequence = prompts[index + 1]?.sequence;
    const assistantEntries = entries.filter((entry) =>
      entry.kind === "assistant_message" &&
      entry.chunks.some((chunk) =>
        chunk.kind === "content" &&
        chunk.text.trim() &&
        (entry.sequence ?? 0) > (prompt.sequence ?? 0) &&
        (nextPromptSequence === undefined || (entry.sequence ?? 0) < nextPromptSequence),
      ),
    );
    const fallbackEntry = assistantEntries.find((entry) =>
      entry.id.startsWith("subagent-result:"),
    );
    const hasAssistantContent = assistantEntries.some((entry) => entry !== fallbackEntry);
    invocations.set(invocationId, {
      prompt: prompt.message.text,
      hasAssistantContent,
      ...(index > 0 ? { namespace: `subagent:${invocationId}:` } : {}),
      ...(fallbackEntry
        ? {
            assistantMessageId: fallbackEntry.id,
            fallbackMessageId: fallbackEntry.id,
          }
        : {}),
    });
  }
  return invocations;
}

function isAssistantContentMessage(message: AgentMessage) {
  return message.role === "assistant" &&
    message.contentKind !== "thought" &&
    Boolean(message.text.trim());
}
