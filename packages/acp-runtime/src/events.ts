import type { AcpRuntimeProviderConfig, AgentToolCall } from "@tiller/shared";
import type {
  MappedSessionRuntimeEvents,
  RuntimeEventOrigin,
  SessionRuntimeEvent,
} from "./runtime-types";
import {
  mapAdapterMessageUpdate,
  mapAdapterToolCallUpdate,
  mapAdapterUnknownUpdate,
  recognizeAdapterToolCalls,
  resolveAdapterRuntimeEventOrigin,
  SUPPRESS_SESSION_UPDATE,
} from "./adapters";
import type { AcpSessionUpdateProjection } from "./adapters";
import { extractAvailableCommands } from "./available-command-events";
import { extractCommandChunk, extractPermissionRequest } from "./command-events";
import { projectCompactionEvent } from "./compaction-events";
import { extractSessionConfigOptions, resolveSessionConfigState } from "./config-events";
import { extractDiffFiles } from "./diff-events";
import { projectMessageEvent } from "./message-events";
import { extractAgentPlan } from "./plan-events";
import {
  isMessageChunkUpdateType,
  isToolCallUpdateType,
  parseSessionUpdateNotification,
  type SessionUpdateEnvelope,
} from "./session-update";
import { projectSessionMetadataEvent, projectSessionStatusEvent } from "./session-state-events";
import { extractThinkingContent, type ThinkingContent } from "./thinking-events";
import { extractToolCall, mapCommandChunkToToolCall } from "./tool-events";

export {
  extractAcpModelState,
  extractSessionConfigOptions,
  findSessionConfigOptionId,
  hasSessionConfigOptionIdValue,
  hasSessionConfigOptionValue,
  resolveCombinedSessionConfigState,
  resolveSessionConfigState,
} from "./config-events";
export { normalizeProviderCleanupResult } from "./cleanup-results";
export { summarizeSessionUpdateNotification } from "./session-update-summary";

export type SessionUpdateMappingOptions = {
  provider?: AcpRuntimeProviderConfig;
  providerId?: string;
  sessionCwd?: string;
  originTracker?: RuntimeEventOriginTracker;
};

export type RuntimeEventOriginTracker = {
  commandOrigins: Map<string, RuntimeEventOrigin>;
  /**
   * commandId → parent subagent root tool-call id, used to backfill an origin
   * for a provider (e.g. OpenCode) that emits child tool calls under the same
   * commandId as the root subagent launch but exposes no parent metadata.
   */
  subagentCommandParents: Map<string, string>;
};

const trackedSubagentRootKeys = new WeakMap<RuntimeEventOriginTracker, Set<string>>();

export function createRuntimeEventOriginTracker(): RuntimeEventOriginTracker {
  const tracker = { commandOrigins: new Map(), subagentCommandParents: new Map() };
  trackedSubagentRootKeys.set(tracker, new Set());
  return tracker;
}

export function clearRuntimeEventOriginTrackerSession(
  tracker: RuntimeEventOriginTracker,
  sessionId: string,
) {
  const prefix = `${sessionId}\0`;
  for (const key of tracker.commandOrigins.keys()) {
    if (key.startsWith(prefix)) tracker.commandOrigins.delete(key);
  }
  for (const key of tracker.subagentCommandParents.keys()) {
    if (key.startsWith(prefix)) tracker.subagentCommandParents.delete(key);
  }
  const rootKeys = trackedSubagentRootKeys.get(tracker);
  if (rootKeys) {
    for (const key of rootKeys) {
      if (key.startsWith(prefix)) rootKeys.delete(key);
    }
  }
}

/** @internal Kept for package characterization tests; package consumers use the batch mapper. */
export function mapSessionUpdateNotification(
  payload: unknown,
  options: SessionUpdateMappingOptions = {},
): { sessionId: string; event: SessionRuntimeEvent; derivedEvents?: SessionRuntimeEvent[] } | null {
  const mapped = mapSessionUpdateNotificationBatch(payload, options);
  if (!mapped?.events.length) {
    return null;
  }
  const [event, ...derivedEvents] = mapped.events;
  if (event.type === "tool-call" && derivedEvents[0]?.type === "command-output") {
    return {
      sessionId: mapped.sessionId,
      event: { ...derivedEvents[0], toolCall: event.toolCall },
      ...(derivedEvents.length > 1 ? { derivedEvents: derivedEvents.slice(1) } : {}),
    };
  }
  return {
    sessionId: mapped.sessionId,
    event,
    ...(derivedEvents.length ? { derivedEvents } : {}),
  };
}

export function mapSessionUpdateNotificationBatch(
  payload: unknown,
  options: SessionUpdateMappingOptions = {},
): MappedSessionRuntimeEvents | null {
  const envelope = parseSessionUpdateNotification(payload);
  if (!envelope) {
    return null;
  }
  const adapterContext = {
    sessionId: envelope.sessionId,
    cwd: options.sessionCwd,
    updateType: envelope.updateType,
    update: envelope.update,
    text: envelope.text,
  };
  const origin = resolveAdapterRuntimeEventOrigin(options.provider, adapterContext);
  const events = projectSessionUpdate(envelope, options).map((event) =>
    attachRuntimeEventOrigin(envelope.sessionId, event, origin, options.originTracker),
  );
  return events.length ? { sessionId: envelope.sessionId, events } : null;
}

function attachRuntimeEventOrigin(
  sessionId: string,
  event: SessionRuntimeEvent,
  origin: RuntimeEventOrigin | undefined,
  tracker: RuntimeEventOriginTracker | undefined,
): SessionRuntimeEvent {
  const commandIds = event.type === "command-output"
    ? [event.chunk.commandId]
    : event.type === "tool-call"
      ? [event.toolCall.commandId, event.toolCall.id].filter((value): value is string => Boolean(value))
      : [];
  const isUnattributedSubagentRoot = event.type === "tool-call" &&
    event.toolCall.kind === "subagent" &&
    !origin &&
    Boolean(event.toolCall.id);
  const isTrackedSubagentRoot = tracker && event.type === "tool-call" &&
    hasTrackedSubagentRoot(tracker, sessionId, event.toolCall.id);
  const isSubagentRoot = isUnattributedSubagentRoot || isTrackedSubagentRoot;
  const isNewSubagentRoot = isUnattributedSubagentRoot && !isTrackedSubagentRoot;
  if (tracker && isNewSubagentRoot) {
    // OpenCode reuses the logical task/session id for a later invocation. The
    // latest root owns that task id, while per-tool origins remain available
    // for delayed updates from older children.
    rememberSubagentRoot(tracker, sessionId, event.toolCall.id);
    for (const commandId of commandIds) {
      tracker.commandOrigins.delete(originTrackerKey(sessionId, commandId));
      tracker.subagentCommandParents.set(
        originTrackerKey(sessionId, commandId),
        event.toolCall.id,
      );
    }
  }
  const originLookupIds = event.type === "tool-call"
    ? [event.toolCall.id, event.toolCall.commandId].filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    )
    : commandIds;
  const cachedOrigin = !isSubagentRoot
    ? originLookupIds
        .map((commandId) => tracker?.commandOrigins.get(originTrackerKey(sessionId, commandId)))
        .find((candidate): candidate is RuntimeEventOrigin => Boolean(candidate))
    : undefined;
  const reverseParent = !origin && !cachedOrigin && !isSubagentRoot && tracker
    ? originLookupIds
        .map((commandId) => tracker.subagentCommandParents.get(originTrackerKey(sessionId, commandId)))
        .find((candidate): candidate is string =>
          Boolean(candidate) &&
          !(event.type === "tool-call" && candidate === event.toolCall.id)
        )
    : undefined;
  const effectiveOrigin = origin ?? cachedOrigin ??
    (reverseParent ? { scope: "subagent", parentToolCallId: reverseParent } : undefined);
  if (effectiveOrigin && tracker) {
    for (const commandId of commandIds) {
      tracker.commandOrigins.set(originTrackerKey(sessionId, commandId), effectiveOrigin);
    }
  }
  if (!effectiveOrigin || (event.type !== "message" && event.type !== "tool-call" && event.type !== "command-output")) {
    return event;
  }
  return { ...event, origin: effectiveOrigin };
}

/**
 * Applies only an origin previously established for the same session/tool ID.
 * Transcript observers use this to enrich delayed projections without making
 * a new subagent inference.
 */
export function attachTrackedRuntimeEventOrigin(
  sessionId: string,
  event: SessionRuntimeEvent,
  tracker: RuntimeEventOriginTracker,
): SessionRuntimeEvent {
  return attachRuntimeEventOrigin(sessionId, event, undefined, tracker);
}

function originTrackerKey(sessionId: string, commandId: string) {
  return `${sessionId}\0${commandId}`;
}

function hasTrackedSubagentRoot(
  tracker: RuntimeEventOriginTracker,
  sessionId: string,
  toolCallId: string,
) {
  return trackedSubagentRootKeys.get(tracker)?.has(originTrackerKey(sessionId, toolCallId)) ?? false;
}

function rememberSubagentRoot(
  tracker: RuntimeEventOriginTracker,
  sessionId: string,
  toolCallId: string,
) {
  const keys = trackedSubagentRootKeys.get(tracker) ?? new Set<string>();
  keys.add(originTrackerKey(sessionId, toolCallId));
  trackedSubagentRootKeys.set(tracker, keys);
}

function projectSessionUpdate(
  envelope: SessionUpdateEnvelope,
  options: SessionUpdateMappingOptions,
): SessionRuntimeEvent[] {
  const { sessionId, updateType, update, text } = envelope;
  const adapterContext = {
    sessionId,
    cwd: options.sessionCwd,
    updateType,
    update,
    text,
  };

  const thinkingContent = extractThinkingContent(sessionId, updateType, update);
  const finish = (events: SessionRuntimeEvent[]): SessionRuntimeEvent[] =>
    thinkingContent
      ? [{
          type: "message",
          message: {
            id: thinkingContent.id,
            role: "assistant" as const,
            contentKind: "thought" as const,
            text: thinkingContent.text,
            timestamp: thinkingContent.timestamp,
            streaming: thinkingContent.streaming,
            streamMode: thinkingContent.streamMode,
          },
        }, ...events]
      : events;
  if (thinkingContent && isStandaloneThoughtUpdate(updateType)) {
    return finish([]);
  }

  if (isMessageChunkUpdateType(updateType)) {
    const adapterEvent = mapAdapterMessageUpdate(options.provider, adapterContext);
    if (isSuppressed(adapterEvent)) {
      return finish([]);
    }
    if (adapterEvent) {
      return finish([adapterEvent]);
    }
  }
  const compactionEvent = projectCompactionEvent(sessionId, updateType, update, text);
  if (compactionEvent) {
    return finish([compactionEvent]);
  }
  if (isMessageChunkUpdateType(updateType)) {
    const messageEvent = projectMessageEvent(sessionId, updateType, update, text);
    if (messageEvent) {
      return finish([messageEvent]);
    }
  }

  const plan = extractAgentPlan(updateType, update);
  if (plan) {
    return finish([{ type: "plan-update", plan }]);
  }

  const configOptions = extractSessionConfigOptions(update);
  if (configOptions.length && updateType === "config_option_update") {
    return finish([{
      type: "config-options",
      state: resolveSessionConfigState(configOptions),
      options: configOptions,
    }]);
  }

  const availableCommands = extractAvailableCommands(updateType, update);
  if (availableCommands) {
    return finish([{ type: "available-commands", commands: availableCommands }]);
  }

  const metadataEvent = projectSessionMetadataEvent(updateType, update);
  if (metadataEvent) {
    return finish([metadataEvent]);
  }

  const explicitToolCall = extractToolCall(sessionId, updateType, update);
  const adapterToolEvent = isToolCallUpdateType(updateType)
    ? mapAdapterToolCallUpdate(options.provider, adapterContext)
    : null;
  if (isSuppressed(adapterToolEvent)) {
    return finish([]);
  }
  if (adapterToolEvent?.type === "compaction") {
    return finish([adapterToolEvent]);
  }
  if (explicitToolCall) {
    const toolCalls = recognizeProviderToolCalls(options, sessionId, explicitToolCall, update);
    if (!toolCalls.length) {
      return finish(adapterToolEvent ? [adapterToolEvent] : []);
    }
    return finish([
      ...toolCalls.map((toolCall): SessionRuntimeEvent => ({ type: "tool-call", toolCall })),
      ...(adapterToolEvent ? [adapterToolEvent] : []),
    ]);
  }
  if (adapterToolEvent) {
    return finish([adapterToolEvent]);
  }

  const permissionRequest = extractPermissionRequest(sessionId, updateType, update);
  if (permissionRequest) {
    return finish([{ type: "permission-request", request: permissionRequest }]);
  }

  const commandChunk = extractCommandChunk(sessionId, updateType, update);
  if (commandChunk) {
    return finish([
      { type: "tool-call", toolCall: mapCommandChunkToToolCall(commandChunk) },
      { type: "command-output", chunk: commandChunk },
    ]);
  }

  const diffFiles = extractDiffFiles(updateType, update);
  if (diffFiles) {
    return finish([{ type: "diff-update", files: diffFiles }]);
  }

  const statusEvent = projectSessionStatusEvent(updateType, update);
  if (statusEvent) {
    return finish([statusEvent]);
  }

  const adapterUnknownEvent = mapAdapterUnknownUpdate(options.provider, adapterContext);
  if (isSuppressed(adapterUnknownEvent)) {
    return finish([]);
  }
  return finish(adapterUnknownEvent ? [adapterUnknownEvent] : []);
}

function isStandaloneThoughtUpdate(updateType: string | undefined) {
  return updateType === "agent_thought_chunk" ||
    updateType === "agent_thought" ||
    updateType === "agent_thought_complete";
}

function recognizeProviderToolCalls(
  options: SessionUpdateMappingOptions,
  sessionId: string,
  toolCall: AgentToolCall,
  update: unknown,
): AgentToolCall[] {
  return recognizeAdapterToolCalls(options.provider, options.providerId, {
    toolCall,
    update,
    sessionId,
    cwd: options.sessionCwd,
  });
}

function isSuppressed(
  projection: AcpSessionUpdateProjection | null,
): projection is typeof SUPPRESS_SESSION_UPDATE {
  return projection === SUPPRESS_SESSION_UPDATE;
}
