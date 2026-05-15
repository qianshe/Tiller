import { basename } from "node:path";
import { normalizeProviderCleanupResult } from "@tiller/acp-runtime";
import {
  type AgentPromptContent,
  type PermissionDecision,
  type ProjectSummary,
  type SessionConfigOptionValue,
  type SessionReasoningEffort,
  type SessionSummary,
  type WorktreeSummary,
} from "@tiller/shared";
import {
  isProjectRootBranchWorktree,
  resolveSessionCleanupOutcome,
} from "../../sessions/facade";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import {
  cancelSessionRuntime,
  configureSessionRuntime,
  sendPromptToSession,
} from "../../runtime/session-runtime-router";
import type { HelmHandlerContext } from "../context";
import { cleanupActiveRuntime } from "./runtime-cleanup";
import { pageSessionSummaries } from "./session-list-page";

export function resolveProjectSessionWorktree(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
  params: { cwd: string },
) {
  const requestedCwd = params.cwd.trim();
  const normalizedCwd = normalizeWorktreePath(requestedCwd);
  const worktree = worktrees.find(
    (item) => normalizeWorktreePath(item.path) === normalizedCwd,
  );
  return {
    name: worktree?.name ?? basename(normalizedCwd) ?? project.name,
    path: requestedCwd,
    summary: worktree?.summary,
  } satisfies WorktreeSummary;
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}


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

async function createSessionDraft(
  params: {
    deckClientId: string;
    projectId: string;
    cwd: string;
    agentId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  },
  context: HelmHandlerContext,
) {
  const helms = context.loadAvailableHelms();
  const worktrees = context.loadAvailableWorktrees();
  const agents = context.loadAvailableAgents();
  context.setHelms(helms);
  context.setWorktrees(worktrees);
  context.setAgents(agents);
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);

  const project = context.resolveProjectById(params.projectId, projects);
  const worktree = project
    ? resolveProjectSessionWorktree(project, worktrees, params)
    : undefined;
  const agent = context.resolveProviderById(params.agentId, agents);
  const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

  if (!project || !worktree || !agent || !helm) {
    throw new Error("Project, helm, worktree, or agent not found");
  }

  return context.createRuntimeDraft({
    deckClientId: params.deckClientId,
    project,
    helm,
    worktree,
    agent,
    sessionConfig: {
      agentMode: params.agentMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
    },
  });
}

async function discardSessionDraft(
  params: {
    deckClientId: string;
    draftId?: string;
    scopeKey?: string;
    reason: "scope-change" | "tab-disconnect" | "ttl" | "shutdown" | "user";
  },
  context: HelmHandlerContext,
) {
  return context.discardRuntimeDraft(params);
}

async function createSession(
  params: {
    projectId: string;
    cwd: string;
    agentId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  },
  context: HelmHandlerContext,
) {
  const helms = context.loadAvailableHelms();
  const worktrees = context.loadAvailableWorktrees();
  const agents = context.loadAvailableAgents();
  context.setHelms(helms);
  context.setWorktrees(worktrees);
  context.setAgents(agents);
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);

  const project = context.resolveProjectById(params.projectId, projects);
  const worktree = project
    ? resolveProjectSessionWorktree(project, worktrees, params)
    : undefined;
  const agent = context.resolveProviderById(params.agentId, agents);
  const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

  if (!project || !worktree || !agent || !helm) {
    throw new Error("Project, helm, worktree, or agent not found");
  }

  const sessionId = `session-${Date.now()}`;
  const createdAt = new Date().toISOString();
  context.logInfo(
    `[tiller] 阶段=新建会话请求 session=${sessionId} project=${project.id} helm=${helm.id} cwd=${worktree.path} agent=${agent.id}`,
  );
  const summaryBase: SessionSummary = {
    id: sessionId,
    projectId: project.id,
    projectName: project.name,
    helmId: helm.id,
    cwd: worktree.path,
    worktreeName: worktree.name,
    agentId: agent.id,
    agentName: agent.name,
    agentMode: params.agentMode,
    model: params.model,
    reasoningEffort: params.reasoningEffort,
    status: "starting",
    createdAt,
    updatedAt: createdAt,
    messageCount: 0,
  };
  const summary = { ...summaryBase, resume: context.buildResumeInfo(summaryBase, agent) };
  context.sessionStore.upsert(summary);
  context.persistRuntimeDescriptor(summary, agent);
  broadcastSessionUpdate(context, sessionId, { kind: "session_updated", session: summary });

  try {
    const sessionConfig = {
      agentMode: summary.agentMode,
      model: summary.model,
      reasoningEffort: summary.reasoningEffort,
    };
    const runtime = await context.createRuntime({
      sessionId,
      worktree,
      agent,
      sessionConfig,
      onEvent: (event) => context.handleRuntimeEvent(sessionId, event),
      onConnectionLifecycleEvent: (event) => {
        const phaseMap = {
          "connection-open": "ACP连接新建",
          "connection-reuse": "ACP连接复用",
          "connection-pending": "ACP连接等待",
          "connection-replace": "ACP连接替换",
          "connection-reconnect": "ACP连接重连",
        } as const;
        context.logInfo(
          `[tiller] 阶段=${phaseMap[event.type]} provider=${event.providerId} key=${event.key} session=${event.sessionId ?? "<none>"} cwd=${event.cwd}`,
        );
      },
    });
    const summaryWithRuntime = context.hydrateSessionSummary({
      ...summary,
      status: "idle",
      updatedAt: new Date().toISOString(),
      agentMode: runtime.sessionConfigState?.agentMode ?? summary.agentMode,
      model: runtime.sessionConfigState?.model ?? summary.model,
      modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
      reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
      runtimeSessionId: runtime.runtimeSessionId,
    });
    context.logInfo(
      `[tiller] 阶段=新建会话ACP就绪 session=${sessionId} runtime=${runtime.runtimeSessionId} capabilities=${JSON.stringify(runtime.sessionCapabilities ?? {})}`,
    );
    context.sessions.set(sessionId, { summary: summaryWithRuntime, agent, worktree, runtime });
    context.sessionStore.upsert(summaryWithRuntime);
    context.persistRuntimeDescriptor(summaryWithRuntime, agent, runtime.sessionCapabilities);
    broadcastSessionUpdate(context, sessionId, {
      kind: "session_updated",
      session: summaryWithRuntime,
    });
    return { session: summaryWithRuntime };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session runtime";
    broadcastErrorRaised(context, { sessionId, message });
    context.logError(
      `[tiller] 阶段=新建会话失败 project=${project.id} agent=${agent.id} cwd=${worktree.path} message=${message}`,
    );
    context.updateSessionSummary(sessionId, (current) => ({
      ...current,
      status: "error",
      updatedAt: new Date().toISOString(),
      lastMessagePreview: "Session startup failed",
    }));
    broadcastSessionUpdate(context, sessionId, {
      kind: "status_change",
      status: "error",
      message: "Session startup failed",
    });
    throw error;
  }
}

async function promptSession(
  params: {
    sessionId?: string;
    draftId?: string;
    text: string;
    content?: AgentPromptContent[];
    clientMessageId?: string;
  },
  context: HelmHandlerContext,
) {
  if (params.sessionId) {
    return sendPromptToSession(
      {
        sessionId: params.sessionId,
        text: params.text,
        content: params.content,
        clientMessageId: params.clientMessageId,
      },
      context,
    );
  }
  if (!params.draftId) {
    throw new Error("sessionId or draftId is required");
  }
  return promptRuntimeDraft(params as { draftId: string; text: string; content?: AgentPromptContent[]; clientMessageId?: string }, context);
}

async function promptRuntimeDraft(
  params: { draftId: string; text: string; content?: AgentPromptContent[]; clientMessageId?: string },
  context: HelmHandlerContext,
) {
  const draft = context.takeRuntimeDraft(params.draftId);
  if (!draft) {
    throw new Error("Runtime draft is not available. Create a new session and retry.");
  }

  const sessionId = `session-${Date.now()}`;
  draft.attach(sessionId);
  const createdAt = new Date().toISOString();
  const summaryBase: SessionSummary = {
    id: sessionId,
    projectId: draft.project.id,
    projectName: draft.project.name,
    helmId: draft.helm.id,
    cwd: draft.worktree.path,
    worktreeName: draft.worktree.name,
    agentId: draft.agent.id,
    agentName: draft.agent.name,
    agentMode: draft.runtime.sessionConfigState?.agentMode ?? draft.configState.agentMode,
    model: draft.runtime.sessionConfigState?.model ?? draft.configState.model,
    modelOptions: draft.runtime.sessionModelState?.options ?? draft.modelState?.options,
    configOptions: draft.runtime.sessionConfigOptions ?? draft.configOptions,
    availableCommands: draft.availableCommands,
    reasoningEffort:
      draft.runtime.sessionConfigState?.reasoningEffort ?? draft.configState.reasoningEffort,
    runtimeSessionId: draft.runtime.runtimeSessionId,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    messageCount: 0,
  };
  const summary = context.hydrateSessionSummary({
    ...summaryBase,
    resume: context.buildResumeInfo(summaryBase, draft.agent),
  });
  context.sessions.set(sessionId, {
    summary,
    agent: draft.agent,
    worktree: draft.worktree,
    runtime: draft.runtime,
  });
  context.sessionStore.upsert(summary);
  context.persistRuntimeDescriptor(summary, draft.agent, draft.runtime.sessionCapabilities);
  broadcastSessionUpdate(context, sessionId, { kind: "session_updated", session: summary });
  context.logInfo(
    `[tiller] draft.activate draft=${params.draftId} session=${sessionId} runtime=${draft.runtime.runtimeSessionId} provider=${draft.agent.id}`,
  );

  try {
    const result = await sendPromptToSession({ ...params, sessionId }, context);
    return { ...result, session: context.sessions.get(sessionId)?.summary ?? summary };
  } catch (error) {
    context.updateSessionSummary(sessionId, (current) => ({
      ...current,
      status: "error",
      updatedAt: new Date().toISOString(),
      lastMessagePreview: "Prompt failed",
    }));
    throw error;
  }
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
