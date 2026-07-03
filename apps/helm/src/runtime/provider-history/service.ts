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
    materializeLegacyCanonicalTimeline(sessionId);
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

  return {
    hasHistoryContent,
    migrateLegacySessionHistory,
    readSessionPlan,
    recordSessionPlan: recordProviderHistoryPlan,
    refreshAuthoritativeSessionHistory,
    resetRefresh,
  };
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
