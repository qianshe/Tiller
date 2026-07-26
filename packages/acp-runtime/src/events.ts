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
import { extractThinkingToolCall } from "./thinking-events";
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
};

export function createRuntimeEventOriginTracker(): RuntimeEventOriginTracker {
  return { commandOrigins: new Map() };
}

export function clearRuntimeEventOriginTrackerSession(
  tracker: RuntimeEventOriginTracker,
  sessionId: string,
) {
  const prefix = `${sessionId}\0`;
  for (const key of tracker.commandOrigins.keys()) {
    if (key.startsWith(prefix)) tracker.commandOrigins.delete(key);
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
  const effectiveOrigin = origin ?? commandIds
    .map((commandId) => tracker?.commandOrigins.get(originTrackerKey(sessionId, commandId)))
    .find((candidate): candidate is RuntimeEventOrigin => Boolean(candidate));
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

  const thinkingToolCall = extractThinkingToolCall(sessionId, updateType, update);
  if (thinkingToolCall) {
    return [{ type: "tool-call", toolCall: thinkingToolCall }];
  }

  if (isMessageChunkUpdateType(updateType)) {
    const adapterEvent = mapAdapterMessageUpdate(options.provider, adapterContext);
    if (isSuppressed(adapterEvent)) {
      return [];
    }
    if (adapterEvent) {
      return [adapterEvent];
    }
  }
  const compactionEvent = projectCompactionEvent(sessionId, updateType, update, text);
  if (compactionEvent) {
    return [compactionEvent];
  }
  if (isMessageChunkUpdateType(updateType)) {
    const messageEvent = projectMessageEvent(sessionId, updateType, update, text);
    if (messageEvent) {
      return [messageEvent];
    }
  }

  const plan = extractAgentPlan(updateType, update);
  if (plan) {
    return [{ type: "plan-update", plan }];
  }

  const configOptions = extractSessionConfigOptions(update);
  if (configOptions.length && updateType === "config_option_update") {
    return [{
      type: "config-options",
      state: resolveSessionConfigState(configOptions),
      options: configOptions,
    }];
  }

  const availableCommands = extractAvailableCommands(updateType, update);
  if (availableCommands) {
    return [{ type: "available-commands", commands: availableCommands }];
  }

  const metadataEvent = projectSessionMetadataEvent(updateType, update);
  if (metadataEvent) {
    return [metadataEvent];
  }

  const explicitToolCall = extractToolCall(sessionId, updateType, update);
  const adapterToolEvent = isToolCallUpdateType(updateType)
    ? mapAdapterToolCallUpdate(options.provider, adapterContext)
    : null;
  if (isSuppressed(adapterToolEvent)) {
    return [];
  }
  if (adapterToolEvent?.type === "compaction") {
    return [adapterToolEvent];
  }
  if (explicitToolCall) {
    const toolCalls = recognizeProviderToolCalls(options, sessionId, explicitToolCall, update);
    if (!toolCalls.length) {
      return adapterToolEvent ? [adapterToolEvent] : [];
    }
    return [
      ...toolCalls.map((toolCall): SessionRuntimeEvent => ({ type: "tool-call", toolCall })),
      ...(adapterToolEvent ? [adapterToolEvent] : []),
    ];
  }
  if (adapterToolEvent) {
    return [adapterToolEvent];
  }

  const permissionRequest = extractPermissionRequest(sessionId, updateType, update);
  if (permissionRequest) {
    return [{ type: "permission-request", request: permissionRequest }];
  }

  const commandChunk = extractCommandChunk(sessionId, updateType, update);
  if (commandChunk) {
    return [
      { type: "tool-call", toolCall: mapCommandChunkToToolCall(commandChunk) },
      { type: "command-output", chunk: commandChunk },
    ];
  }

  const diffFiles = extractDiffFiles(updateType, update);
  if (diffFiles) {
    return [{ type: "diff-update", files: diffFiles }];
  }

  const statusEvent = projectSessionStatusEvent(updateType, update);
  if (statusEvent) {
    return [statusEvent];
  }

  const adapterUnknownEvent = mapAdapterUnknownUpdate(options.provider, adapterContext);
  if (isSuppressed(adapterUnknownEvent)) {
    return [];
  }
  return adapterUnknownEvent ? [adapterUnknownEvent] : [];
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
