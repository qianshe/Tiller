import {
  looksLikeCompactionCompletedMessage,
  looksLikeCompactionStartedMessage,
  looksLikeContinuationSummary,
} from "@tiller/shared";
import type { AcpRuntimeProviderConfig, AgentToolCall, SessionStatus } from "@tiller/shared";
import type { SessionRuntimeEvent } from "./runtime-types";
import { mapAdapterSessionUpdate, normalizeAdapterToolCall, SUPPRESS_SESSION_UPDATE } from "./adapters";
import type { AcpSessionUpdateProjection } from "./adapters";
import { extractAvailableCommands } from "./available-command-events";
import { extractCommandChunk, extractPermissionRequest } from "./command-events";
import { extractSessionConfigOptions, resolveSessionConfigState } from "./config-events";
import { extractDiffFiles } from "./diff-events";
import { extractAgentPlan } from "./plan-events";
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

function timestamp() {
  return new Date().toISOString();
}

function normalizeProviderToolCall(
  provider: AcpRuntimeProviderConfig | undefined,
  providerId: string | undefined,
  toolCall: AgentToolCall,
  update: any,
) {
  return normalizeAdapterToolCall(provider, providerId, { toolCall, update });
}

export function mapSessionUpdateNotification(
  payload: any,
  options: { provider?: AcpRuntimeProviderConfig; providerId?: string } = {},
): { sessionId: string; event: SessionRuntimeEvent } | null {
  if (payload?.method !== "session/update") {
    return null;
  }

  const sessionId = payload?.params?.sessionId ?? payload?.params?.session_id;
  const update = payload?.params?.update;
  if (!sessionId || !update) {
    return null;
  }

  const updateType = resolveSessionUpdateType(update);
  const text = extractTextContent(update.content) ?? extractTextContent(update.delta) ?? extractTextContent(update.message);

  const thinkingToolCall = extractThinkingToolCall(sessionId, updateType, update);
  if (thinkingToolCall) {
    return {
      sessionId,
      event: {
        type: "tool-call",
        toolCall: thinkingToolCall,
      },
    };
  }

  const adapterEvent = mapAdapterSessionUpdate(options.provider, {
    sessionId,
    updateType,
    update,
  });
  if (isSuppressedAdapterSessionUpdate(adapterEvent)) {
    return null;
  }
  if (adapterEvent) {
    return { sessionId, event: adapterEvent };
  }

  const compactionEvent = extractCompactionEvent(sessionId, updateType, update, text);
  if (compactionEvent) {
    return {
      sessionId,
      event: compactionEvent,
    };
  }

  if (text && (updateType === "agent_message_chunk" || updateType === "user_message_chunk")) {
    return {
      sessionId,
      event: {
        type: "message",
        message: {
          id: resolveMessageId(sessionId, update),
          role: updateType === "user_message_chunk" ? "user" : "assistant",
          text,
          timestamp: timestamp(),
        },
      },
    };
  }

  const plan = extractAgentPlan(updateType, update);
  if (plan) {
    return {
      sessionId,
      event: {
        type: "plan-update",
        plan,
      },
    };
  }

  const configOptions = extractSessionConfigOptions(update);
  if (configOptions.length && updateType === "config_option_update") {
    return {
      sessionId,
      event: {
        type: "config-options",
        state: resolveSessionConfigState(configOptions),
        options: configOptions,
      },
    };
  }

  const availableCommands = extractAvailableCommands(updateType, update);
  if (availableCommands) {
    return {
      sessionId,
      event: {
        type: "available-commands",
        commands: availableCommands,
      },
    };
  }

  const explicitToolCall = extractToolCall(sessionId, updateType, update);
  if (explicitToolCall) {
    return {
      sessionId,
      event: {
        type: "tool-call",
        toolCall: normalizeProviderToolCall(options.provider, options.providerId, explicitToolCall, update),
      },
    };
  }

  const permissionRequest = extractPermissionRequest(sessionId, updateType, update);
  if (permissionRequest) {
    return {
      sessionId,
      event: {
        type: "permission-request",
        request: permissionRequest,
      },
    };
  }

  const commandChunk = extractCommandChunk(sessionId, updateType, update);
  if (commandChunk) {
    return {
      sessionId,
      event: {
        type: "command-output",
        chunk: commandChunk,
        toolCall: mapCommandChunkToToolCall(commandChunk),
      },
    };
  }

  const diffFiles = extractDiffFiles(updateType, update);
  if (diffFiles) {
    return {
      sessionId,
      event: {
        type: "diff-update",
        files: diffFiles,
      },
    };
  }

  const status = normalizeSessionStatus(updateType);
  if (status) {
    return {
      sessionId,
      event: {
        type: "status",
        status,
        message: typeof update.message === "string" ? update.message : undefined,
      },
    };
  }

  return null;
}

function isSuppressedAdapterSessionUpdate(
  projection: AcpSessionUpdateProjection | null,
): projection is typeof SUPPRESS_SESSION_UPDATE {
  return projection === SUPPRESS_SESSION_UPDATE;
}

export function summarizeSessionUpdateNotification(
  params: any,
  mappedEventType?: SessionRuntimeEvent["type"],
  options: { providerId?: string } = {},
) {
  const update = params?.update;
  const updateType = resolveSessionUpdateType(update);
  const text = extractTextContent(update?.content ?? update?.delta ?? update?.message);
  const compactionProbe = summarizeCompactionProbe({
    providerId: options.providerId,
    updateType,
    text,
    mappedEventType,
  });
  return {
    sessionId: stringFrom(params?.sessionId ?? params?.session_id),
    updateType: typeof updateType === "string" ? updateType : undefined,
    updateKeys: objectKeys(update),
    contentShape: describeContentShape(update?.content ?? update?.delta ?? update?.message),
    mappedEventType: mappedEventType ?? null,
    ...(compactionProbe ? { compactionProbe } : {}),
  };
}

function objectKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function describeContentShape(content: unknown): unknown {
  if (typeof content === "string") {
    return { kind: "string", chars: content.length };
  }
  if (Array.isArray(content)) {
    return {
      kind: "array",
      length: content.length,
      itemShapes: content.slice(0, 5).map((item) => describeContentShape(item)),
    };
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    return {
      kind: "object",
      type: typeof record.type === "string" ? record.type : undefined,
      keys: Object.keys(record).sort(),
    };
  }
  return content == null ? null : { kind: typeof content };
}

function resolveSessionUpdateType(update: any) {
  return update?.sessionUpdate ?? update?.session_update ?? update?.type;
}

function resolveMessageId(sessionId: string, update: any) {
  return (
    stringFrom(update.messageId ?? update.message_id ?? update.message?.id ?? update.id) ??
    `${sessionId}-msg-${hashStableMessageSeed(sessionId, update)}`
  );
}

function extractCompactionEvent(
  sessionId: string,
  updateType: string | undefined,
  update: any,
  extractedText: string | null,
): Extract<SessionRuntimeEvent, { type: "compaction" }> | null {
  const text = extractedText?.trim() || "";
  const explicitPhase = resolveExplicitCompactionPhase(updateType, update, text);
  if (explicitPhase) {
    return {
      type: "compaction",
      phase: explicitPhase,
      source: "provider",
      timestamp: resolveEventTimestamp(update),
      summaryText: explicitPhase === "completed" ? resolveCompactionSummaryText(update, text) : undefined,
      messageId: explicitPhase === "completed" ? resolveMessageId(sessionId, update) : undefined,
    };
  }
  if (!text || !looksLikeContinuationSummary(text)) {
    return null;
  }
  return {
    type: "compaction",
    phase: "completed",
    source: "heuristic",
    timestamp: resolveEventTimestamp(update),
    summaryText: text,
    messageId: resolveMessageId(sessionId, update),
  };
}

function resolveThinkingMessageId(sessionId: string, update: any) {
  return (
    stringFrom(update.messageId ?? update.message_id ?? update.message?.id ?? update.id) ??
    `${sessionId}-thinking`
  );
}

function hashStableMessageSeed(sessionId: string, update: any) {
  const updateType = resolveSessionUpdateType(update) ?? "message";
  const text =
    extractTextContent(update.content) ??
    extractTextContent(update.delta) ??
    extractTextContent(update.message) ??
    "";
  return stableHash(`${sessionId}\u001f${updateType}\u001f${text}`).toString(10);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
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

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveExplicitCompactionPhase(
  updateType: string | undefined,
  update: any,
  text: string,
) {
  const record = recordFrom(update);
  const compaction = recordFrom(record.compaction);
  const candidatePhase = normalizeCompactionPhase(
    compaction.phase ??
      record.phase ??
      record.compactionPhase ??
      record.compaction_phase ??
      record.status,
  );
  if (candidatePhase && isCompactionRelatedUpdateType(updateType)) {
    return candidatePhase;
  }
  if (isCompactionStartedText(text)) {
    return "started";
  }
  if (isCompactionCompletedText(text)) {
    return "completed";
  }
  return isCompactionRelatedUpdateType(updateType)
    ? normalizeCompactionPhase(updateType)
    : null;
}

function summarizeCompactionProbe(args: {
  providerId?: string;
  updateType?: string;
  text: string | null;
  mappedEventType?: SessionRuntimeEvent["type"];
}) {
  const normalizedText = args.text?.trim() || "";
  const matchedLifecyclePhase = normalizedText
    ? summarizeLifecycleCompactionPhase(normalizedText)
    : null;
  const matchedContinuationSummary = normalizedText
    ? looksLikeContinuationSummary(normalizedText)
    : false;
  const providerSignal = summarizeProviderCompactionSignal(args.providerId, normalizedText);
  const updateTypeCompactionRelated = isCompactionRelatedUpdateType(args.updateType);

  if (
    !matchedLifecyclePhase &&
    !matchedContinuationSummary &&
    !providerSignal &&
    !updateTypeCompactionRelated &&
    args.mappedEventType !== "compaction"
  ) {
    return null;
  }

  return {
    textChars: normalizedText.length,
    updateTypeCompactionRelated,
    matchedLifecyclePhase,
    matchedContinuationSummary,
    ...(providerSignal ? { providerSignal } : {}),
  };
}

function summarizeLifecycleCompactionPhase(text: string) {
  if (looksLikeCompactionStartedMessage(text)) {
    return "started" as const;
  }
  if (looksLikeCompactionCompletedMessage(text)) {
    return "completed" as const;
  }
  return null;
}

function summarizeProviderCompactionSignal(providerId: string | undefined, text: string) {
  if (providerId !== "codex" || !text) {
    return null;
  }

  const prefix = "context compacted";
  if (!text.toLowerCase().startsWith(prefix)) {
    return null;
  }

  const trailingText = text.slice(prefix.length).trim();
  return {
    kind: "codex_context_compacted_prefix" as const,
    exactMatch: trailingText.length === 0,
    hasTrailingText: trailingText.length > 0,
  };
}

function normalizeCompactionPhase(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "started" ||
    normalized === "starting" ||
    normalized === "running" ||
    normalized === "compacting" ||
    normalized === "compaction_started" ||
    normalized === "compaction-started"
  ) {
    return "started";
  }
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "compaction_completed" ||
    normalized === "compaction-completed"
  ) {
    return "completed";
  }
  return null;
}

function isCompactionRelatedUpdateType(updateType: string | undefined) {
  if (!updateType) {
    return false;
  }
  return /(?:^|[_./-])compaction(?:$|[_./-])|^compacting(?:$|[_./-])/iu.test(updateType);
}

function isCompactionStartedText(text: string) {
  return looksLikeCompactionStartedMessage(text);
}

function isCompactionCompletedText(text: string) {
  return looksLikeCompactionCompletedMessage(text);
}

function resolveEventTimestamp(update: any) {
  return stringFrom(update?.timestamp ?? update?.message?.timestamp) ?? timestamp();
}

function resolveCompactionSummaryText(update: any, text: string) {
  const record = recordFrom(update);
  const compaction = recordFrom(record.compaction);
  const summary = extractTextContent(
    compaction.summaryText ??
      compaction.summary_text ??
      compaction.summary ??
      record.summaryText ??
      record.summary_text ??
      record.summary,
  );
  return summary?.trim() || (looksLikeContinuationSummary(text) ? text : undefined);
}


function extractTextContent(content: any): string | null {
  if (!content) {
    return null;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => extractTextContent(item)).filter(Boolean).join("") || null;
  }

  if (content.type === "text" && typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.content === "string") {
    return content.content;
  }

  return extractTextContent(content.content) ?? null;
}

function normalizeSessionStatus(updateType: string | undefined): SessionStatus | null {
  switch (updateType) {
    case "completed":
    case "idle":
    case "session_idle":
      return "idle";
    case "running":
    case "started":
    case "session_running":
      return "running";
    case "cancelled":
    case "session_cancelled":
      return "cancelled";
    case "error":
    case "session_error":
      return "error";
    default:
      return null;
  }
}
