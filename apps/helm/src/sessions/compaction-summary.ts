import {
  resolveAdapterCompactionSummary,
  type AcpCompactionSummary,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import type { SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

type CompactionSummaryResolver = typeof resolveAdapterCompactionSummary;

export function hydrateRuntimeCompactionEventSummary(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  context: HelmHandlerContext,
  resolveSummary: CompactionSummaryResolver = resolveAdapterCompactionSummary,
) {
  if (event.phase !== "completed" || event.source !== "provider" || event.summaryText?.trim()) {
    return event;
  }
  const resolved = resolveSessionCompactionSummary(sessionId, event.timestamp, context, resolveSummary);
  if (!resolved?.summaryText) {
    return event;
  }
  return {
    ...event,
    summaryText: resolved.summaryText,
    messageId: resolved.summaryMessageId ?? event.messageId,
  };
}

function resolveSessionCompactionSummary(
  sessionId: string,
  completedAt: string,
  context: HelmHandlerContext,
  resolveSummary: CompactionSummaryResolver,
) {
  const liveRecord = context.sessions?.get?.(sessionId);
  const storedSummary = context.sessionStore?.get?.(sessionId) as SessionSummary | undefined;
  const sessionSummary = liveRecord?.summary ?? storedSummary;
  const runtimeDescriptor = context.sessionRuntimeStore?.get?.(sessionId);
  const providerId =
    liveRecord?.agent?.id ?? sessionSummary?.agentId ?? runtimeDescriptor?.providerId;
  const cwd = liveRecord?.worktree?.path ?? sessionSummary?.cwd;
  const runtimeSessionId =
    liveRecord?.runtime?.runtimeSessionId ??
    sessionSummary?.runtimeSessionId ??
    runtimeDescriptor?.runtimeSessionId;
  if (!cwd || !runtimeSessionId) {
    return undefined;
  }
  const resolved = resolveSummary(providerId, { cwd, runtimeSessionId, completedAt });
  return normalizeCompactionSummary(resolved);
}

function normalizeCompactionSummary(
  resolved: string | AcpCompactionSummary | undefined,
): AcpCompactionSummary | undefined {
  if (typeof resolved === "string") {
    const summaryText = resolved.trim();
    return summaryText ? { summaryText } : undefined;
  }
  if (!resolved) {
    return undefined;
  }
  const summaryText = resolved.summaryText.trim();
  return summaryText
    ? { summaryText, summaryMessageId: resolved.summaryMessageId?.trim() || undefined }
    : undefined;
}
