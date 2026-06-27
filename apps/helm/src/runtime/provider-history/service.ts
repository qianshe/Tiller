import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionUpdateRecord,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { SessionRecord } from "../session/services";
import type { SessionAttachmentStore, StoredSessionRuntimeDescriptor } from "../../sessions/facade";
import type { TillerLogger } from "../../logging/logger";
import type { ProviderHistorySnapshotContent } from "./source";

type SessionMessageStore = {
  list(sessionId: string): AgentMessage[];
  replace(sessionId: string, messages: AgentMessage[]): void;
  append(sessionId: string, message: AgentMessage): void;
};

type SessionArtifactStore = {
  get(sessionId: string): {
    toolCalls: AgentToolCall[];
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
  };
  replaceToolCalls(sessionId: string, toolCalls: AgentToolCall[]): void;
};

type SessionRuntimeStore = {
  get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined;
  upsert(descriptor: StoredSessionRuntimeDescriptor): void;
};

type SessionTimelineStore = {
  replace(sessionId: string, entries: unknown[]): unknown[];
};

type SessionUpdateStore = {
  replaceSession(sessionId: string, updates: SessionUpdateRecord[]): void;
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
    const restored = readSessionPlanFromUpdates(sessionId);
    if (restored) {
      providerHistoryPlans.set(sessionId, restored);
    }
    return restored;
  }

  function readSessionPlanFromUpdates(sessionId: string) {
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

  function recordProviderHistoryPlan(sessionId: string, plan: AgentPlan | undefined) {
    if (isVisibleAgentPlan(plan)) {
      providerHistoryPlans.set(sessionId, plan);
      return;
    }
    providerHistoryPlans.delete(sessionId);
  }

  async function refreshAuthoritativeSessionHistory(_sessionId: string) {
    // ACP session/load replay is the only authoritative external history
    // source. Passive list/artifact reads must not inspect provider files.
  }

  function resetRefresh(sessionId: string) {
    providerHistoryPlans.delete(sessionId);
  }

  return {
    hasHistoryContent,
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
