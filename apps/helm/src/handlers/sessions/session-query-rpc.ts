import { mapSessionUpdateNotification } from "@tiller/acp-runtime";
import type { AgentToolCall, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import { pageSessionSummaries } from "./session-list-page";

export function listSessions(params: { limit?: number; before?: string }, context: HelmHandlerContext) {
  const normalizedSessions = context.sessionStore.list().map(context.migrateStoredSessionSummary);
  const page = pageSessionSummaries(normalizedSessions, {
    limit: params.limit,
    before: params.before,
  });
  context.logInfo(
    `[tiller] session.list count=${normalizedSessions.length} page=${page.sessions.length} hasMore=${page.hasMore}`,
  );
  return {
    sessions: page.sessions,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    before: params.before,
  };
}

export function subscribeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  if (!context.socketId) {
    throw new Error("Session topic subscription requires an authenticated socket");
  }
  context.subscribeSessionTopic(context.socketId, params.sessionId);
  return {
    ok: true,
    message: `Subscribed to session ${params.sessionId}.`,
  };
}

export function unsubscribeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  if (!context.socketId) {
    throw new Error("Session topic unsubscription requires an authenticated socket");
  }
  context.unsubscribeSessionTopic(context.socketId, params.sessionId);
  return {
    ok: true,
    message: `Unsubscribed from session ${params.sessionId}.`,
  };
}

// Deck consumes old session history through paged windows only. ACP restore replay may
// repair Helm's local cache, but it must not push a full historical transcript to Deck.
export async function listMessages(
  params: { sessionId: string; limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  const page = context.sessionMessageStore.listPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  return {
    sessionId: params.sessionId,
    messages: page.messages,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    before: params.before,
  };
}

export async function getArtifacts(
  params: { sessionId: string; limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  repairProviderToolCalls(params.sessionId, context);
  const artifacts = context.sessionArtifactStore.getPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  const diffs = await context.hydrateDiffsFromWorktreeGit(params.sessionId, artifacts.diffs);
  return {
    sessionId: params.sessionId,
    outputs: artifacts.outputs,
    diffs,
    toolCalls: artifacts.toolCalls,
    nextCursor: artifacts.nextCursor,
    hasMore: artifacts.hasMore,
  };
}

export async function reimportHistory(
  params: { sessionId: string; limit?: number },
  context: HelmHandlerContext,
) {
  return context.reimportSessionHistory(params.sessionId, { limit: params.limit });
}

export function checkResume(params: { sessionId: string }, context: HelmHandlerContext) {
  context.logInfo(`[tiller] 阶段=恢复检查 session=${params.sessionId}`);
  const summary = context.sessionStore.list().find((item: any) => item.id === params.sessionId);
  if (!summary) {
    throw new Error("Session not found");
  }
  const hydrated = context.hydrateSessionSummary(summary);
  return {
    sessionId: params.sessionId,
    resume:
      hydrated.resume ??
      context.buildResumeInfo(
        hydrated,
        context.resolveProviderById(hydrated.agentId, context.getAgents()),
      ),
  };
}

export async function resumeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  context.logInfo(`[tiller] 阶段=恢复请求开始 session=${params.sessionId}`);
  const result = await context.startSessionResume(params.sessionId);
  context.logInfo(
    `[tiller] 阶段=恢复请求完成 session=${params.sessionId} ok=${result.ok} method=${result.resume.restoreMethod ?? "none"} message=${result.message}`,
  );
  return {
    sessionId: params.sessionId,
    ok: result.ok,
    resume: result.resume,
    message: result.message,
  };
}

function repairProviderToolCalls(sessionId: string, context: HelmHandlerContext) {
  const summary = resolveSessionSummary(sessionId, context);
  const providerId = summary?.agentId;
  if (!providerId) {
    return;
  }

  const artifacts = context.sessionArtifactStore.get(sessionId);
  const repairedToolCalls = artifacts.toolCalls.map((toolCall: AgentToolCall) =>
    repairCompletedThinkingToolCall(summary, repairProviderToolCall(sessionId, providerId, toolCall)),
  );
  if (!hasToolCallChanges(artifacts.toolCalls, repairedToolCalls)) {
    return;
  }

  context.sessionArtifactStore.replaceToolCalls(sessionId, repairedToolCalls);
}

function resolveSessionSummary(sessionId: string, context: HelmHandlerContext): SessionSummary | undefined {
  return (
    context.sessions.get(sessionId)?.summary ??
    context.sessionStore.list().find((item: SessionSummary) => item.id === sessionId)
  );
}

function repairProviderToolCall(
  sessionId: string,
  providerId: string,
  toolCall: AgentToolCall,
) {
  const mapped = mapSessionUpdateNotification(
    {
      method: "session/update",
      params: {
        sessionId,
        update: {
          type: "tool_call_update",
          toolCall,
        },
      },
    },
    { providerId },
  );
  return mapped?.event.type === "tool-call" ? mapped.event.toolCall : toolCall;
}

function repairCompletedThinkingToolCall(
  summary: SessionSummary,
  toolCall: AgentToolCall,
) {
  if (
    toolCall.kind !== "think" ||
    (toolCall.status !== "running" && toolCall.status !== "pending") ||
    summary.status === "running" ||
    summary.status === "waiting_for_permission"
  ) {
    return toolCall;
  }
  return {
    ...toolCall,
    status: "completed" as const,
    updatedAt: summary.updatedAt,
  };
}

function hasToolCallChanges(left: AgentToolCall[], right: AgentToolCall[]) {
  if (left.length !== right.length) {
    return true;
  }
  return left.some((item, index) => {
    const next = right[index];
    return (
      !next ||
      item.kind !== next.kind ||
      item.title !== next.title ||
      item.status !== next.status ||
      item.input !== next.input ||
      item.updatedAt !== next.updatedAt
    );
  });
}
