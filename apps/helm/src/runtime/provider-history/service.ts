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
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import type { SessionRecord } from "../session/services";
import type { SessionAttachmentStore, StoredSessionRuntimeDescriptor } from "../../sessions/facade";
import type { TillerLogger } from "../../logging/logger";
import type { ProviderHistorySnapshotContent } from "./source";
import { reduceSessionUpdateRecords } from "../session-updates/records.js";
import { repairSessionToolCalls, repairTimelineToolCalls } from "./tool-call-repair.js";

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
    const updates = readAllSessionUpdateRecords(sessionId);
    if (!updates.length) {
      return existingTimeline.length ? "ready" : "empty";
    }
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
      logProviderHistoryInfo(options, "provider.history.tool_calls.normalized", {
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
    if (repairedTimeline.changedCount === 0) {
      return;
    }
    options.sessionTimelineStore.replace(sessionId, repairedTimeline.timeline);
    logProviderHistoryInfo(options, "provider.history.timeline.tool_calls.normalized", {
      sessionId,
      count: repairedTimeline.changedCount,
    });
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

function readSessionPlanFromUpdateRecord(update: SessionUpdateRecord): AgentPlan | undefined {
  if (update.updateType !== "plan-update") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(update.payloadJson) as { type?: unknown; plan?: unknown };
    return parsed.type === "plan-update" && isVisibleAgentPlan(parsed.plan)
      ? parsed.plan
      : undefined;
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
