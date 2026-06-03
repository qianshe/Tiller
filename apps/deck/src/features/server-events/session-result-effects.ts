import type {
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionCleanupResult,
  SessionHistoryReimportResult,
} from "@tiller/shared";
import { sortAgentMessagesByTimeline } from "../logbook";

export type SessionResultToast = {
  tone: "success" | "warning" | "info";
  message: string;
};

export function deriveSessionReimportState(payload: SessionHistoryReimportResult) {
  return {
    messages: sortAgentMessagesByTimeline(payload.messages ?? []),
    messageHistoryState: {
      nextCursor: payload.nextCursor,
      hasMore: Boolean(payload.hasMore),
      loading: false,
    },
    outputs: (payload.outputs ?? []) as CommandChunk[],
    toolCalls: (payload.toolCalls ?? []) as AgentToolCall[],
    plan: payload.plan as AgentPlan | undefined,
    diffs: (payload.diffs ?? []) as FileDiffSummary[],
    activityHistoryState: {
      nextCursor: payload.activityNextCursor,
      hasMore: Boolean(payload.activityHasMore),
      loading: false,
    },
    toast: resolveSessionReimportToast(payload.message),
  };
}

export function resolveSessionReimportToast(message: string | undefined): SessionResultToast {
  if (typeof message === "string" && message.includes("失败")) {
    return { tone: "warning", message };
  }
  return { tone: "success", message: message ?? "历史已从 ACP 重新导入。" };
}

export function resolveSessionCleanupToast(result: SessionCleanupResult): SessionResultToast {
  if (result.remoteDeleted) {
    return { tone: "success", message: "会话已删除" };
  }
  if (result.remoteDeletionAttempted) {
    return { tone: "warning", message: result.message };
  }
  return { tone: "info", message: result.message };
}
