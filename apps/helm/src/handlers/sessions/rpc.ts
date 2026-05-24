import { mapSessionUpdateNotification, normalizeProviderCleanupResult } from "@tiller/acp-runtime";
import {
  type AgentPromptContent,
  type AgentToolCall,
  type PermissionDecision,
  type SessionConfigOptionValue,
  type SessionReasoningEffort,
  type SessionSummary,
} from "@tiller/shared";
import {
  isProjectRootBranchWorktree,
  resolveSessionCleanupOutcome,
} from "../../sessions/facade";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import {
  cancelSessionRuntime,
  configureSessionRuntime,
} from "../../runtime/session-runtime-router";
import type { HelmHandlerContext } from "../context";
import { createSessionDraft, discardSessionDraft } from "./draft-rpc";
import { createSession } from "./session-create-rpc";
import { promptSession } from "./prompt-rpc";
import { cleanupActiveRuntime } from "./runtime-cleanup";
import { pageSessionSummaries } from "./session-list-page";

export { resolveProjectSessionWorktree } from "./session-worktree";

export async function handleSessionRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "session/list":
      return listSessions(params as { limit?: number; before?: string }, context);
    case "session/subscribe":
      return subscribeSession(params as { sessionId: string }, context);
    case "session/unsubscribe":
      return unsubscribeSession(params as { sessionId: string }, context);
    case "session/list_messages":
      return listMessages(
        params as { sessionId: string; limit?: number; before?: string },
        context,
      );
    case "session/get_artifacts":
      return getArtifacts(
        params as { sessionId: string; limit?: number; before?: string },
        context,
      );
    case "session/reimport_history":
      return reimportHistory(
        params as { sessionId: string; limit?: number },
        context,
      );
    case "session/check_resume":
      return checkResume(params as { sessionId: string }, context);
    case "session/resume":
      return resumeSession(params as { sessionId: string }, context);
    case "session/draft":
      return createSessionDraft(
        params as {
          deckClientId: string;
          projectId: string;
          cwd: string;
          agentId: string;
          agentMode?: string;
          model?: string;
          reasoningEffort?: SessionReasoningEffort;
        },
        context,
      );
    case "session/discard_draft":
      return discardSessionDraft(
        params as {
          deckClientId: string;
          draftId?: string;
          scopeKey?: string;
          reason: "scope-change" | "tab-disconnect" | "ttl" | "shutdown" | "user";
        },
        context,
      );
    case "session/new":
      return createSession(
        params as {
          projectId: string;
          cwd: string;
          agentId: string;
          agentMode?: string;
          model?: string;
          reasoningEffort?: SessionReasoningEffort;
        },
        context,
      );
    case "session/prompt":
      return promptSession(
        params as {
          sessionId?: string;
          draftId?: string;
          text: string;
          content?: AgentPromptContent[];
          clientMessageId?: string;
        },
        context,
      );
    case "session/update_queued_prompt":
      return updateQueuedPrompt(
        params as {
          sessionId: string;
          queueItemId: string;
          text: string;
          content?: AgentPromptContent[];
        },
        context,
      );
    case "session/delete_queued_prompt":
      return deleteQueuedPrompt(
        params as { sessionId: string; queueItemId: string },
        context,
      );
    case "session/configure":
      return configureSessionOrDraft(
        params as {
          sessionId?: string;
          draftId?: string;
          agentMode?: string;
          model?: string;
          reasoningEffort?: SessionReasoningEffort;
          configId?: string;
          value?: SessionConfigOptionValue;
        },
        context,
      );
    case "session/set_config_option":
      return configureSessionOrDraft(
        params as {
          sessionId?: string;
          draftId?: string;
          agentMode?: string;
          model?: string;
          reasoningEffort?: SessionReasoningEffort;
          configId?: string;
          value?: SessionConfigOptionValue;
        },
        context,
      );
    case "permission/respond":
    case "permission/list_pending":
      // Moved to approvals/rpc.ts so the legacy methods read from the unified
      // approvalIndex. The router invokes handleApprovalRpcRequest before this
      // handler, so falling through here means the approval handler returned
      // undefined intentionally and we should not double-resolve.
      return undefined;
    case "session/rename":
      return renameSession(params as { sessionId: string; title: string }, context);
    case "session/cleanup":
      return cleanupSession(params as { sessionId: string }, context);
    default:
      return undefined;
  }
}

export async function handleSessionRpcNotification(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<boolean> {
  if (method !== "session/cancel") {
    return false;
  }
  const { sessionId } = params as { sessionId: string };
  return cancelSessionRuntime(sessionId, context);
}

function listSessions(params: { limit?: number; before?: string }, context: HelmHandlerContext) {
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

function subscribeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  if (!context.socketId) {
    throw new Error("Session topic subscription requires an authenticated socket");
  }
  context.subscribeSessionTopic(context.socketId, params.sessionId);
  return {
    ok: true,
    message: `Subscribed to session ${params.sessionId}.`,
  };
}

function unsubscribeSession(params: { sessionId: string }, context: HelmHandlerContext) {
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
async function listMessages(
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

async function getArtifacts(
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

async function reimportHistory(
  params: { sessionId: string; limit?: number },
  context: HelmHandlerContext,
) {
  return context.reimportSessionHistory(params.sessionId, { limit: params.limit });
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

function checkResume(params: { sessionId: string }, context: HelmHandlerContext) {
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

async function resumeSession(params: { sessionId: string }, context: HelmHandlerContext) {
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

function broadcastPromptQueue(context: HelmHandlerContext, sessionId: string) {
  broadcastSessionUpdate(context, sessionId, {
    kind: "prompt_queue",
    queue: context.promptQueue.snapshot(sessionId),
  });
}

function updateQueuedPrompt(
  params: { sessionId: string; queueItemId: string; text: string; content?: AgentPromptContent[] },
  context: HelmHandlerContext,
) {
  const queueItem = context.promptQueue.updateQueuedPrompt(params.sessionId, params.queueItemId, {
    text: params.text,
    content: params.content,
  });
  broadcastPromptQueue(context, params.sessionId);
  return { ok: true, queueItem };
}

function deleteQueuedPrompt(
  params: { sessionId: string; queueItemId: string },
  context: HelmHandlerContext,
) {
  const queue = context.promptQueue.deleteQueuedPrompt(params.sessionId, params.queueItemId);
  broadcastPromptQueue(context, params.sessionId);
  return { ok: true, queue };
}

async function configureSessionOrDraft(
  params: {
    sessionId?: string;
    draftId?: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
    configId?: string;
    value?: SessionConfigOptionValue;
  },
  context: HelmHandlerContext,
) {
  if (params.draftId) {
    return context.configureRuntimeDraft({
      draftId: params.draftId,
      agentMode: params.agentMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
      configId: params.configId,
      value: params.value,
    });
  }
  if (!params.sessionId) {
    throw new Error("sessionId or draftId is required");
  }
  return configureSessionRuntime(
    {
      sessionId: params.sessionId,
      agentMode: params.agentMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
      configId: params.configId,
      value: params.value,
    },
    context,
  );
}

async function renameSession(
  params: { sessionId: string; title: string },
  context: HelmHandlerContext,
) {
  const summary =
    context.sessions.get(params.sessionId)?.summary ??
    context.sessionStore.list().find((item: any) => item.id === params.sessionId);
  if (!summary) {
    throw new Error("Session not found");
  }
  const next = { ...summary, title: params.title };
  context.updateSessionSummary(params.sessionId, () => next);
  broadcastSessionUpdate(context, params.sessionId, {
    kind: "session_updated",
    session: next,
  });
  return { ok: true };
}

async function cleanupSession(params: { sessionId: string }, context: HelmHandlerContext) {
  const record = context.sessions.get(params.sessionId);
  const summary =
    record?.summary ??
    context.sessionStore.list().find((item: any) => item.id === params.sessionId);
  if (!summary) {
    context.logError(
      `[tiller] session.cleanup.failed session=${params.sessionId} reason=Session not found`,
    );
    throw new Error("Session not found");
  }
  const provider =
    record?.agent ?? context.resolveProviderById(summary.agentId, context.getAgents());
  let remoteResult;
  if (record) {
    context.sessions.delete(summary.id);
    remoteResult = normalizeProviderCleanupResult(
      await cleanupActiveRuntime(record.runtime, provider?.id ?? summary.agentId),
    );
    context.logInfo(
      `[tiller] session.cleanup runtime session=${summary.id} provider=${provider?.id ?? summary.agentId} remoteDeleted=${remoteResult.remoteDeleted} remoteDeletionAttempted=${remoteResult.remoteDeletionAttempted}`,
    );
  } else {
    remoteResult = resolveSessionCleanupOutcome(summary, provider);
    context.logInfo(
      `[tiller] session.cleanup local-only session=${summary.id} provider=${provider?.id ?? summary.agentId} remoteDeleted=${remoteResult.remoteDeleted}`,
    );
  }
  if (!remoteResult.remoteDeleted) {
    context.logWarn(
      `[tiller] session.cleanup.warning session=${summary.id} provider=${remoteResult.providerId ?? provider?.id ?? summary.agentId} message=${remoteResult.message}`,
    );
  }
  context.clearPermissionRequestsForSession(summary.id);
  context.deleteLocalSessionData(summary.id);
  return {
    result: {
      sessionId: summary.id,
      localDeleted: true,
      remoteDeleted: remoteResult.remoteDeleted,
      remoteDeletionAttempted: remoteResult.remoteDeletionAttempted,
      providerId: remoteResult.providerId,
      message: remoteResult.message,
    },
  };
}

export { cleanupActiveRuntime } from "./runtime-cleanup";
