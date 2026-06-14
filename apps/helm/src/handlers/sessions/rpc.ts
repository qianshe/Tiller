import { normalizeProviderCleanupResult } from "@tiller/acp-runtime";
import {
  type AgentPromptContent,
  type PermissionDecision,
  type SessionConfigOptionValue,
  type SessionReasoningEffort,
} from "@tiller/shared";
import {
  isProjectRootBranchWorktree,
  resolveSessionCleanupOutcome,
} from "../../sessions/facade";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import {
  cancelSessionRuntime,
  configureSessionRuntime,
} from "../../runtime/session/router";
import type { HelmHandlerContext } from "../context";
import { createSessionDraft, discardSessionDraft } from "./draft-rpc";
import { createSession } from "./session-create-rpc";
import { promptSession } from "./prompt-rpc";
import {
  checkResume,
  getArtifacts,
  listMessages,
  listSessions,
  reimportHistory,
  resumeSession,
  subscribeSession,
  unsubscribeSession,
} from "./session-query-rpc";
import { listSessionUpdates } from "./session-updates-rpc";
import { cleanupActiveRuntime } from "./runtime-cleanup";

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
        params as { sessionId: string; limit?: number; before?: string; timelineBefore?: string },
        context,
      );
    case "session/list_updates":
      return listSessionUpdates(
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
