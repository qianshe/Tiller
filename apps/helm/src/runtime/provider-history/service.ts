import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionTimelineEntry,
  SessionUpdateRecord,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import {
  buildSessionTimelineFromLegacy,
  collapseRepeatedStreamingText,
} from "@tiller/shared";
import { extractAdapterPlanFromToolCall } from "@tiller/acp-runtime";
import type { SessionRecord } from "../session/services";
import type { SessionAttachmentStore, StoredSessionRuntimeDescriptor } from "../../sessions/facade";
import type { TillerLogger } from "../../logging/logger";
import type { ProviderHistorySnapshotContent } from "./source";
import { projectLegacySessionHistoryFromTimeline } from "../session-timeline/legacy-projection.js";
import { reduceSessionUpdateRecords } from "../session-updates/records.js";
import {
  applySessionUpdateRecordToState,
  createEmptySessionUpdateReducerState,
} from "../session-updates/reducer.js";
import {
  repairSessionToolCalls,
  repairSessionUpdateToolCalls,
  repairTimelineToolCalls,
} from "./tool-call-repair.js";

type SessionMessageStore = {
  list(sessionId: string): AgentMessage[];
  replace(sessionId: string, messages: AgentMessage[]): void;
  append(sessionId: string, message: AgentMessage): void;
  remove?(sessionId: string): void;
};

type SessionArtifactStore = {
  get(sessionId: string): {
    toolCalls: AgentToolCall[];
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
  };
  replaceOutputs?(sessionId: string, outputs: CommandChunk[]): void;
  replaceToolCalls(sessionId: string, toolCalls: AgentToolCall[]): void;
};

type SessionRuntimeStore = {
  get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined;
  upsert(descriptor: StoredSessionRuntimeDescriptor): void;
};

type SessionPlanStore = {
  get(sessionId: string): AgentPlan | undefined;
  replace(sessionId: string, plan: AgentPlan): AgentPlan;
  remove(sessionId: string): void;
};

type SessionTimelineStore = {
  list?(sessionId: string): SessionTimelineEntry[];
  replace(sessionId: string, entries: SessionTimelineEntry[]): SessionTimelineEntry[];
};

type SessionUpdateStore = {
  replaceSession(sessionId: string, updates: SessionUpdateRecord[]): void;
  remove?(sessionId: string): void;
  listSinceSequence?(
    sessionId: string,
    afterSequence: number,
    limit?: number,
  ): SessionUpdateRecord[];
  listPage?(
    sessionId: string,
    options: { limit?: number; before?: string },
  ): { updates: SessionUpdateRecord[]; nextCursor?: string; hasMore?: boolean };
};

type ProviderHistoryServiceOptions = {
  sessions: Map<string, SessionRecord>;
  sessionStore: { list(): SessionSummary[] };
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionAttachmentStore?: SessionAttachmentStore;
  sessionRuntimeStore: SessionRuntimeStore;
  sessionPlanStore: SessionPlanStore;
  sessionTimelineStore?: SessionTimelineStore;
  sessionUpdateStore?: SessionUpdateStore;
  getAgents(): unknown[];
  getWorktrees(): WorktreeSummary[];
  logger?: Pick<TillerLogger, "debug" | "error">;
  logInfo(message: string): void;
  logError(message: string): void;
};

export function createProviderHistoryService(options: ProviderHistoryServiceOptions) {
  const providerHistoryPlans = new Map<string, AgentPlan>();
  const latestAppliedUpdateSequenceBySession = new Map<string, number>();
  const normalizationLogSignatures = new Map<string, string>();

  function hasHistoryContent(history: ProviderHistorySnapshotContent) {
    return Boolean(
      history.messages.length ||
        history.toolCalls.length ||
        history.outputs.length ||
        history.diffs.length ||
        isVisibleAgentPlan(history.plan),
    );
  }

  function readSessionPlan(sessionId: string) {
    const cached = providerHistoryPlans.get(sessionId);
    if (cached) {
      return cached;
    }
    const stored = options.sessionPlanStore.get(sessionId);
    if (isVisibleAgentPlan(stored)) {
      providerHistoryPlans.set(sessionId, stored);
      return stored;
    }
    const restored = readLegacySessionPlanFromUpdates(sessionId);
    if (isVisibleAgentPlan(restored)) {
      providerHistoryPlans.set(sessionId, restored);
      options.sessionPlanStore.replace(sessionId, restored);
      return restored;
    }
    return undefined;
  }

  function recordProviderHistoryPlan(sessionId: string, plan: AgentPlan | undefined) {
    if (isVisibleAgentPlan(plan)) {
      providerHistoryPlans.set(sessionId, plan);
      options.sessionPlanStore.replace(sessionId, plan);
      return;
    }
    providerHistoryPlans.delete(sessionId);
    options.sessionPlanStore.remove(sessionId);
  }

  function migrateLegacySessionHistory() {
    const sessionIds = new Set<string>([
      ...options.sessionStore.list().map((summary) => summary.id),
      ...options.sessions.keys(),
    ]);
    for (const sessionId of sessionIds) {
      const timelineState = materializeLegacyCanonicalTimeline(sessionId);
      materializeLegacySessionPlan(sessionId);
      if (!options.sessions.has(sessionId) && timelineState !== "missing") {
        purgeLegacyHistoricalSessionRecords(sessionId);
      }
    }
  }

  async function refreshAuthoritativeSessionHistory(sessionId: string) {
    // ACP session/load replay is the only authoritative external history
    // source. Passive list/artifact reads must not inspect provider files.
    // Legacy local stores are still safe to materialize into canonical
    // timeline storage once so subsequent reads stay pure-canonical.
    if (repairCanonicalTimelineFromSessionUpdates(sessionId) !== "ready") {
      materializeLegacyCanonicalTimeline(sessionId);
    }
    readSessionPlan(sessionId);
    repairPersistedStateFromSessionUpdates(sessionId);
    repairPersistedTimelineSnapshots(sessionId);
    repairPersistedToolCallHistory(sessionId);
  }

  function materializeLegacyCanonicalTimeline(sessionId: string): "ready" | "empty" | "missing" {
    if (!options.sessionTimelineStore) {
      return "missing";
    }
    const existingTimeline = options.sessionTimelineStore?.list?.(sessionId) ?? [];
    if (existingTimeline.length > 0) {
      return "ready";
    }
    const artifacts = options.sessionArtifactStore.get(sessionId);
    const history = buildSessionTimelineFromLegacy({
      messages: options.sessionMessageStore.list(sessionId),
      outputs: artifacts.outputs,
      toolCalls: artifacts.toolCalls,
    });
    if (history.length === 0) {
      return "empty";
    }
    options.sessionTimelineStore?.replace(sessionId, history);
    return "ready";
  }

  function repairCanonicalTimelineFromSessionUpdates(sessionId: string): "ready" | "empty" | "missing" {
    if (
      !options.sessionTimelineStore?.list ||
      !options.sessionTimelineStore.replace ||
      !options.sessionUpdateStore?.listPage
    ) {
      return "missing";
    }
    const existingTimeline = options.sessionTimelineStore.list(sessionId) ?? [];
    const incrementalState = applyIncrementalCanonicalTimelineFromSessionUpdates(sessionId, existingTimeline);
    if (incrementalState !== "missing") {
      return incrementalState;
    }
    const updates = readAllSessionUpdateRecords(sessionId);
    if (!updates.length) {
      return existingTimeline.length ? "ready" : "empty";
    }
    latestAppliedUpdateSequenceBySession.set(sessionId, updates.at(-1)?.sequence ?? 0);
    const repairedTimeline = reduceSessionUpdateRecords(updates).entries;
    if (!repairedTimeline.length) {
      return existingTimeline.length ? "ready" : "empty";
    }
    if (!shouldReplaceCanonicalTimeline(existingTimeline, repairedTimeline)) {
      return "ready";
    }
    options.sessionTimelineStore.replace(sessionId, repairedTimeline);
    logProviderHistoryInfo(options, "provider.history.timeline.repaired_from_updates", {
      sessionId,
      previousEntries: existingTimeline.length,
      nextEntries: repairedTimeline.length,
    });
    return "ready";
  }

  function readAllSessionUpdateRecords(sessionId: string) {
    const records: SessionUpdateRecord[] = [];
    let before: string | undefined;
    while (true) {
      const page = options.sessionUpdateStore?.listPage?.(sessionId, { limit: 200, before });
      if (!page) {
        break;
      }
      records.push(...page.updates);
      if (!page.hasMore || !page.nextCursor) {
        break;
      }
      before = page.nextCursor;
    }
    return records.sort((left, right) => left.sequence - right.sequence);
  }

  function repairPersistedStateFromSessionUpdates(sessionId: string) {
    if (!options.sessionUpdateStore?.listPage) {
      return;
    }
    const updates = readAllSessionUpdateRecords(sessionId);
    if (!updates.length) {
      return;
    }

    const rebuiltState = reduceSessionUpdateRecords(updates);
    let changed = false;

    const currentMessages = options.sessionMessageStore.list(sessionId);
    if (!areSerializedValuesEqual(currentMessages, rebuiltState.messages)) {
      options.sessionMessageStore.replace(sessionId, rebuiltState.messages);
      changed = true;
    }

    const currentArtifacts = options.sessionArtifactStore.get(sessionId);
    if (!areSerializedValuesEqual(currentArtifacts.toolCalls, rebuiltState.toolCalls)) {
      options.sessionArtifactStore.replaceToolCalls(sessionId, rebuiltState.toolCalls);
      changed = true;
    }
    if (
      options.sessionArtifactStore.replaceOutputs &&
      !areSerializedValuesEqual(currentArtifacts.outputs, rebuiltState.outputs)
    ) {
      options.sessionArtifactStore.replaceOutputs(sessionId, rebuiltState.outputs);
      changed = true;
    }

    if (
      options.sessionTimelineStore?.list &&
      options.sessionTimelineStore.replace
    ) {
      const currentTimeline = options.sessionTimelineStore.list(sessionId) ?? [];
      if (!areSerializedValuesEqual(currentTimeline, rebuiltState.entries)) {
        options.sessionTimelineStore.replace(sessionId, rebuiltState.entries);
        changed = true;
      }
    }

    if (changed) {
      logProviderHistoryInfo(options, "provider.history.state.rebuilt_from_updates", {
        sessionId,
        messages: rebuiltState.messages.length,
        toolCalls: rebuiltState.toolCalls.length,
        timelineEntries: rebuiltState.entries.length,
      });
    }
  }

  function repairPersistedTimelineSnapshots(sessionId: string) {
    if (!options.sessionTimelineStore?.list || !options.sessionTimelineStore.replace) {
      return;
    }
    if (options.sessionUpdateStore?.listPage?.(sessionId, { limit: 1 }).updates.length) {
      return;
    }
    const currentTimeline = options.sessionTimelineStore.list(sessionId) ?? [];
    if (!currentTimeline.length) {
      return;
    }

    let changed = false;
    const repairedTimeline = currentTimeline.map((entry) => {
      const repairedEntry = repairTimelineSnapshotEntry(entry);
      changed ||= repairedEntry !== entry;
      return repairedEntry;
    });

    if (!changed) {
      return;
    }

    options.sessionTimelineStore.replace(sessionId, repairedTimeline);

    const projected = projectLegacySessionHistoryFromTimeline(repairedTimeline);
    const currentMessages = options.sessionMessageStore.list(sessionId);
    if (!areSerializedValuesEqual(currentMessages, projected.messages)) {
      options.sessionMessageStore.replace(sessionId, projected.messages);
    }

    const currentArtifacts = options.sessionArtifactStore.get(sessionId);
    if (!areSerializedValuesEqual(currentArtifacts.toolCalls, projected.toolCalls)) {
      options.sessionArtifactStore.replaceToolCalls(sessionId, projected.toolCalls);
    }
    if (
      options.sessionArtifactStore.replaceOutputs &&
      !areSerializedValuesEqual(currentArtifacts.outputs, projected.outputs)
    ) {
      options.sessionArtifactStore.replaceOutputs(sessionId, projected.outputs);
    }

    logProviderHistoryInfo(options, "provider.history.timeline.snapshot_repaired", {
      sessionId,
      entries: repairedTimeline.length,
    });
  }

  function applyIncrementalCanonicalTimelineFromSessionUpdates(
    sessionId: string,
    existingTimeline: SessionTimelineEntry[],
  ): "ready" | "missing" {
    if (
      !existingTimeline.length ||
      !options.sessionUpdateStore?.listSinceSequence ||
      !options.sessionMessageStore.replace ||
      !options.sessionArtifactStore.replaceToolCalls ||
      !options.sessionArtifactStore.replaceOutputs
    ) {
      return "missing";
    }
    const lastAppliedSequence = latestAppliedUpdateSequenceBySession.get(sessionId);
    if (!lastAppliedSequence) {
      return "missing";
    }
    const updates = readSessionUpdateRecordsSince(sessionId, lastAppliedSequence);
    if (!updates.length) {
      return "ready";
    }

    const artifacts = options.sessionArtifactStore.get(sessionId);
    const state = updates.reduce(applySessionUpdateRecordToState, {
      ...createEmptySessionUpdateReducerState(),
      entries: existingTimeline,
      messages: options.sessionMessageStore.list(sessionId),
      toolCalls: artifacts.toolCalls,
      outputs: artifacts.outputs,
      diffs: artifacts.diffs,
      ...(options.sessionPlanStore.get(sessionId) ? { plan: options.sessionPlanStore.get(sessionId) } : {}),
    });

    options.sessionMessageStore.replace(sessionId, state.messages);
    options.sessionArtifactStore.replaceOutputs(sessionId, state.outputs);
    options.sessionArtifactStore.replaceToolCalls(sessionId, state.toolCalls);
    options.sessionTimelineStore?.replace?.(sessionId, state.entries);
    if (state.plan) {
      recordProviderHistoryPlan(sessionId, state.plan);
    }
    latestAppliedUpdateSequenceBySession.set(sessionId, updates.at(-1)?.sequence ?? lastAppliedSequence);
    return "ready";
  }

  function readSessionUpdateRecordsSince(sessionId: string, afterSequence: number) {
    const updates: SessionUpdateRecord[] = [];
    let cursor = afterSequence;
    while (true) {
      const page = options.sessionUpdateStore?.listSinceSequence?.(sessionId, cursor, 200) ?? [];
      if (!page.length) {
        break;
      }
      updates.push(...page);
      const lastSequence = page.at(-1)?.sequence;
      if (!lastSequence || page.length < 200) {
        break;
      }
      cursor = lastSequence;
    }
    return updates;
  }

  function materializeLegacySessionPlan(sessionId: string) {
    if (isVisibleAgentPlan(options.sessionPlanStore.get(sessionId))) {
      return;
    }
    const restored = readLegacySessionPlanFromUpdates(sessionId);
    if (!restored) {
      return;
    }
    options.sessionPlanStore.replace(sessionId, restored);
    providerHistoryPlans.set(sessionId, restored);
  }

  function purgeLegacyHistoricalSessionRecords(sessionId: string) {
    // Diffs still live in the artifact store. Only clear the legacy mirrors
    // that can now be reconstructed from canonical timeline + plan storage.
    options.sessionMessageStore.remove?.(sessionId);
    options.sessionArtifactStore.replaceOutputs?.(sessionId, []);
    options.sessionArtifactStore.replaceToolCalls(sessionId, []);
    options.sessionUpdateStore?.remove?.(sessionId);
  }

  function readLegacySessionPlanFromUpdates(sessionId: string) {
    let before: string | undefined;
    while (true) {
      const page = options.sessionUpdateStore?.listPage?.(sessionId, { limit: 200, before });
      const updates = page?.updates ?? [];
      for (let index = updates.length - 1; index >= 0; index -= 1) {
        const plan = readSessionPlanFromUpdateRecord(updates[index]!);
        if (plan) {
          return plan;
        }
      }
      if (!page?.hasMore || !page.nextCursor) {
        return undefined;
      }
      before = page.nextCursor;
    }
  }

  function resetRefresh(sessionId: string) {
    providerHistoryPlans.delete(sessionId);
    latestAppliedUpdateSequenceBySession.delete(sessionId);
    clearNormalizationLogSignatures(sessionId);
  }

  function repairPersistedToolCallHistory(sessionId: string) {
    const summary = resolveSessionSummary(sessionId, options);
    const providerId = summary?.agentId;
    if (!summary || !providerId) {
      return;
    }

    const artifacts = options.sessionArtifactStore.get(sessionId);
    const repairedArtifacts = repairSessionToolCalls(
      { sessionId, providerId, summary },
      artifacts.toolCalls,
    );
    if (repairedArtifacts.changedCount > 0) {
      options.sessionArtifactStore.replaceToolCalls(sessionId, repairedArtifacts.toolCalls);
      logDistinctNormalizationInfo("provider.history.tool_calls.normalized", {
        sessionId,
        count: repairedArtifacts.changedCount,
      });
    }

    if (!options.sessionTimelineStore?.list || !options.sessionTimelineStore.replace) {
      return;
    }
    const timeline = options.sessionTimelineStore.list(sessionId) ?? [];
    if (!timeline.length) {
      return;
    }
    const repairedTimeline = repairTimelineToolCalls(
      { sessionId, providerId, summary },
      timeline,
    );
    if (repairedTimeline.changedCount > 0) {
      options.sessionTimelineStore.replace(sessionId, repairedTimeline.timeline);
      logDistinctNormalizationInfo("provider.history.timeline.tool_calls.normalized", {
        sessionId,
        count: repairedTimeline.changedCount,
      });
    }

    const updates = readAllSessionUpdateRecords(sessionId);
    if (!updates.length || !options.sessionUpdateStore?.replaceSession) {
      return;
    }
    const repairedUpdates = repairSessionUpdateToolCalls(
      { sessionId, providerId, summary },
      updates,
    );
    if (repairedUpdates.changedCount === 0) {
      return;
    }
    options.sessionUpdateStore.replaceSession(sessionId, repairedUpdates.updates);
    logDistinctNormalizationInfo("provider.history.session_updates.tool_calls.normalized", {
      sessionId,
      count: repairedUpdates.changedCount,
    });
  }

  function clearNormalizationLogSignatures(sessionId: string) {
    for (const key of normalizationLogSignatures.keys()) {
      if (key.endsWith(`:${sessionId}`)) {
        normalizationLogSignatures.delete(key);
      }
    }
  }

  function logDistinctNormalizationInfo(
    event: string,
    fields: Record<string, unknown>,
  ) {
    const sessionId = typeof fields.sessionId === "string" ? fields.sessionId : "";
    const cacheKey = `${event}:${sessionId}`;
    const signature = formatDistinctNormalizationSignature(fields);
    if (normalizationLogSignatures.get(cacheKey) === signature) {
      return;
    }
    normalizationLogSignatures.set(cacheKey, signature);
    logProviderHistoryInfo(options, event, fields);
  }

  function formatDistinctNormalizationSignature(fields: Record<string, unknown>) {
    return Object.keys(fields)
      .sort()
      .map((key) => `${key}=${String(fields[key])}`)
      .join(" ");
  }

  return {
    hasHistoryContent,
    migrateLegacySessionHistory,
    readSessionPlan,
    recordSessionPlan: recordProviderHistoryPlan,
    refreshAuthoritativeSessionHistory,
    resetRefresh,
  };
}

function resolveSessionSummary(
  sessionId: string,
  options: Pick<ProviderHistoryServiceOptions, "sessionStore" | "sessions">,
) {
  return options.sessions.get(sessionId)?.summary ??
    options.sessionStore.list().find((item) => item.id === sessionId);
}

function shouldReplaceCanonicalTimeline(
  existingTimeline: SessionTimelineEntry[],
  repairedTimeline: SessionTimelineEntry[],
) {
  if (existingTimeline.length === 0) {
    return true;
  }
  const existingShape = summarizeTimelineShape(existingTimeline);
  const repairedShape = summarizeTimelineShape(repairedTimeline);
  return repairedShape.totalEntries > existingShape.totalEntries ||
    repairedShape.toolCallEntries > existingShape.toolCallEntries ||
    repairedShape.compactionEntries > existingShape.compactionEntries;
}

function summarizeTimelineShape(entries: SessionTimelineEntry[]) {
  return entries.reduce(
    (summary, entry) => {
      summary.totalEntries += 1;
      if (entry.kind === "tool_call") {
        summary.toolCallEntries += 1;
      }
      if (entry.kind === "context_compaction") {
        summary.compactionEntries += 1;
      }
      return summary;
    },
    {
      totalEntries: 0,
      toolCallEntries: 0,
      compactionEntries: 0,
    },
  );
}

function areSerializedValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function repairTimelineSnapshotEntry(entry: SessionTimelineEntry): SessionTimelineEntry {
  if (entry.kind === "assistant_message") {
    let changed = false;
    const chunks = entry.chunks.map((chunk) => {
      if (chunk.kind !== "content" && chunk.kind !== "thinking") {
        return chunk;
      }
      const repairedText = collapseRepeatedStreamingText(chunk.text);
      if (repairedText === chunk.text) {
        return chunk;
      }
      changed = true;
      return {
        ...chunk,
        text: repairedText,
      };
    });
    return changed ? { ...entry, chunks } : entry;
  }

  if (entry.kind === "tool_call" && entry.toolCall.kind === "think") {
    const repairedOutput = entry.toolCall.output
      ? collapseRepeatedStreamingText(entry.toolCall.output)
      : entry.toolCall.output;
    if (repairedOutput === entry.toolCall.output) {
      return entry;
    }
    return {
      ...entry,
      toolCall: {
        ...entry.toolCall,
        output: repairedOutput,
      },
    };
  }

  return entry;
}

function readSessionPlanFromUpdateRecord(update: SessionUpdateRecord): AgentPlan | undefined {
  try {
    const parsed = JSON.parse(update.payloadJson) as {
      type?: unknown;
      plan?: unknown;
      toolCall?: AgentToolCall;
    };
    if (parsed.type === "plan-update" && isVisibleAgentPlan(parsed.plan)) {
      return parsed.plan;
    }
    if (update.updateType !== "tool-call" || !parsed.toolCall) {
      return undefined;
    }
    const recovered = extractAdapterPlanFromToolCall(update.providerId, parsed.toolCall);
    return isVisibleAgentPlan(recovered ?? undefined) ? recovered ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

function isVisibleAgentPlan(value: unknown): value is AgentPlan {
  return isAgentPlan(value) && value.entries.length > 0;
}

function isAgentPlan(value: unknown): value is AgentPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const plan = value as Partial<AgentPlan>;
  return typeof plan.updatedAt === "string" &&
    Array.isArray(plan.entries) &&
    plan.entries.every((entry) =>
      Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { content?: unknown }).content === "string" &&
        ((entry as { priority?: unknown }).priority === "high" ||
          (entry as { priority?: unknown }).priority === "medium" ||
          (entry as { priority?: unknown }).priority === "low") &&
        ((entry as { status?: unknown }).status === "pending" ||
          (entry as { status?: unknown }).status === "in_progress" ||
          (entry as { status?: unknown }).status === "completed"),
    );
}

function logProviderHistoryInfo(
  options: ProviderHistoryServiceOptions,
  event: string,
  fields: Record<string, unknown>,
) {
  if (options.logger) {
    options.logger.debug(event, fields);
    return;
  }
  options.logInfo(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
