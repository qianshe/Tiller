import { normalizeProviderCleanupResult } from "@tiller/acp-runtime";
import {
  ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
  ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
  type AgentPromptContent,
  type PermissionDecision,
  type ProjectSummary,
  type SessionReasoningEffort,
  type SessionSummary,
  type WorkspaceSummary,
} from "@tiller/shared";
import {
  applyUserPromptToSummary,
  isProjectRootBranchWorkspace,
  resolveSessionCleanupOutcome,
} from "../../sessions/facade";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import type { HelmHandlerContext } from "../context";
import { cleanupActiveRuntime } from "./runtime-cleanup";
import { pageSessionSummaries } from "./session-list-page";

export function resolveProjectSessionWorkspace(
  project: ProjectSummary,
  workspaces: WorkspaceSummary[],
  workspaceId: string,
) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return undefined;
  }
  if (isProjectRootBranchWorkspace(project, workspace)) {
    return { ...workspace, path: project.path };
  }
  return workspace;
}

export async function handleSessionRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "session/list":
      return listSessions(params as { limit?: number; before?: string }, context);
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
    case "session/prewarm":
      return prewarmSession(
        params as {
          projectId: string;
          workspaceId: string;
          agentId: string;
          agentMode?: string;
          model?: string;
          reasoningEffort?: SessionReasoningEffort;
        },
        context,
      );
    case "session/new":
      return createSession(
        params as {
          projectId: string;
          workspaceId: string;
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
          sessionId: string;
          text: string;
          content?: AgentPromptContent[];
          clientMessageId?: string;
        },
        context,
      );
    case "session/set_config_option":
      return setConfigOption(
        params as {
          sessionId: string;
          agentMode?: string;
          model?: string;
          reasoningEffort?: SessionReasoningEffort;
        },
        context,
      );
    case "permission/respond":
      return respondPermission(
        params as { permissionRequestId: string; decision: "allow" | "deny" },
        context,
      );
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
  const record = context.sessions.get(sessionId);
  if (!record) {
    broadcastErrorRaised(context, { sessionId, message: "Session not found" });
    return true;
  }
  record.runtime.cancel();
  context.sessions.delete(sessionId);
  return true;
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
  const diffs = await context.hydrateDiffsFromWorkspaceGit(params.sessionId, artifacts.diffs);
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

async function prewarmSession(
  params: {
    projectId: string;
    workspaceId: string;
    agentId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  },
  context: HelmHandlerContext,
) {
  const helms = context.loadAvailableHelms();
  const workspaces = context.loadAvailableWorkspaces();
  const agents = context.loadAvailableAgents();
  context.setHelms(helms);
  context.setWorkspaces(workspaces);
  context.setAgents(agents);
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);

  const project = context.resolveProjectById(params.projectId, projects);
  const workspace = project
    ? resolveProjectSessionWorkspace(project, workspaces, params.workspaceId)
    : undefined;
  const agent = context.resolveProviderById(params.agentId, agents);
  const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

  if (!project || !workspace || !agent || !helm) {
    throw new Error("Project, helm, workspace, or agent not found");
  }
  if (project.workspaceIds?.length && !project.workspaceIds.includes(workspace.id)) {
    throw new Error("Workspace does not belong to the selected project");
  }

  return context.prewarmRuntime({
    workspace,
    agent,
    sessionConfig: {
      agentMode: params.agentMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
    },
  });
}

async function createSession(
  params: {
    projectId: string;
    workspaceId: string;
    agentId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  },
  context: HelmHandlerContext,
) {
  const helms = context.loadAvailableHelms();
  const workspaces = context.loadAvailableWorkspaces();
  const agents = context.loadAvailableAgents();
  context.setHelms(helms);
  context.setWorkspaces(workspaces);
  context.setAgents(agents);
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);

  const project = context.resolveProjectById(params.projectId, projects);
  const workspace = project
    ? resolveProjectSessionWorkspace(project, workspaces, params.workspaceId)
    : undefined;
  const agent = context.resolveProviderById(params.agentId, agents);
  const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

  if (!project || !workspace || !agent || !helm) {
    throw new Error("Project, helm, workspace, or agent not found");
  }
  if (project.workspaceIds?.length && !project.workspaceIds.includes(workspace.id)) {
    throw new Error("Workspace does not belong to the selected project");
  }

  const sessionId = `session-${Date.now()}`;
  const createdAt = new Date().toISOString();
  context.logInfo(
    `[tiller] 阶段=新建会话请求 session=${sessionId} project=${project.id} helm=${helm.id} workspace=${workspace.id} workspaceName=${workspace.name} workspacePath=${workspace.path} agent=${agent.id}`,
  );
  const summaryBase: SessionSummary = {
    id: sessionId,
    projectId: project.id,
    projectName: project.name,
    helmId: helm.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
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
    const prewarmed = await context.takePrewarmedRuntime({ workspace, agent, sessionConfig });
    const runtime = prewarmed?.runtime ??
      (await context.createRuntime({
        sessionId,
        workspace,
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
            `[tiller] 阶段=${phaseMap[event.type]} provider=${event.providerId} key=${event.key} session=${event.sessionId ?? "<none>"} workspace=${event.workspaceId} cwd=${event.workspacePath}`,
          );
        },
      }));
    prewarmed?.attach(sessionId);
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
    context.sessions.set(sessionId, { summary: summaryWithRuntime, agent, workspace, runtime });
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
      `[tiller] 阶段=新建会话失败 project=${project.id} agent=${agent.id} workspace=${workspace.id} workspaceName=${workspace.name} workspacePath=${workspace.path} message=${message}`,
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
    sessionId: string;
    text: string;
    content?: AgentPromptContent[];
    clientMessageId?: string;
  },
  context: HelmHandlerContext,
) {
  let record = context.sessions.get(params.sessionId);
  if (!record) {
    context.logInfo(
      `[tiller] 阶段=发送前需要恢复 session=${params.sessionId} chars=${params.text.length}`,
    );
    const restore = await context.startSessionResume(params.sessionId);
    context.logInfo(
      `[tiller] 阶段=发送前恢复完成 session=${params.sessionId} ok=${restore.ok} method=${restore.resume.restoreMethod ?? "none"} message=${restore.message}`,
    );
    record = context.sessions.get(params.sessionId);
  }
  if (!record) {
    context.logError(
      `[tiller] 阶段=发送失败 session=${params.sessionId} reason=Session runtime not available`,
    );
    throw new Error("Session runtime is not available. Try reconnecting this Mission first.");
  }
  const imageAttachments = params.content?.filter((item) => item.type === "image") ?? [];
  if (imageAttachments.length && !record.runtime.sessionCapabilities?.imageInput) {
    const error = new Error(ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE);
    (error as Error & { code?: string }).code = ACP_IMAGE_INPUT_UNSUPPORTED_CODE;
    throw error;
  }

  context.logInfo(
    `[tiller] 阶段=发送Prompt session=${params.sessionId} chars=${params.text.length} images=${imageAttachments.length}`,
  );
  const timestamp = new Date().toISOString();
  const userMessageId = params.clientMessageId || `${params.sessionId}-user-${Date.now()}`;
  context.persistSessionMessage(params.sessionId, {
    id: userMessageId,
    role: "user",
    text: params.text,
    timestamp,
    ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
  });
  const updated = context.updateSessionSummary(params.sessionId, (current) =>
    applyUserPromptToSummary(current, params.text, timestamp),
  );
  if (updated) {
    broadcastSessionUpdate(context, params.sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }
  await record.runtime.prompt(params.text, params.content);
  return { stopReason: "end_turn" };
}

async function setConfigOption(
  params: {
    sessionId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  },
  context: HelmHandlerContext,
) {
  const current =
    context.sessions.get(params.sessionId)?.summary ??
    context.sessionStore.list().find((item: any) => item.id === params.sessionId);
  if (!current) {
    throw new Error("Session not found");
  }
  const activeRecord = context.sessions.get(params.sessionId);
  const runtimeResult = activeRecord
    ? await activeRecord.runtime.configure({
        agentMode: params.agentMode,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
      })
    : null;
  const nextAgentMode = runtimeResult?.state.agentMode ?? params.agentMode ?? current.agentMode;
  const nextModel = runtimeResult?.state.model ?? params.model;
  const nextReasoning = runtimeResult?.state.reasoningEffort ?? params.reasoningEffort;
  const nextModelOptions = runtimeResult?.modelState?.options ?? current.modelOptions;
  const updatedAt = new Date().toISOString();
  const next = context.hydrateSessionSummary({
    ...current,
    agentMode: nextAgentMode,
    model: nextModel,
    modelOptions: nextModelOptions,
    reasoningEffort: nextReasoning,
    updatedAt,
  });
  context.updateSessionSummary(params.sessionId, () => next);
  broadcastSessionUpdate(context, params.sessionId, { kind: "session_updated", session: next });
  return {
    sessionId: params.sessionId,
    ok: true,
    state: {
      agentMode: nextAgentMode,
      model: nextModel,
      reasoningEffort: nextReasoning,
    },
    options: [],
    message: runtimeResult?.runtimeApplied ? "Session config updated." : "Session config saved.",
  };
}

function respondPermission(
  params: { permissionRequestId: string; decision: PermissionDecision },
  context: HelmHandlerContext,
) {
  const permission = context.permissionIndex.get(params.permissionRequestId);
  if (!permission) {
    throw new Error("Permission request not found");
  }
  const record = context.sessions.get(permission.sessionId);
  if (!record) {
    throw new Error("Session not found for permission response");
  }
  if (!record.runtime.supportsPermissionResponses) {
    const error = new Error(
      "Real ACP permission passthrough is not wired yet. The request is still pending.",
    );
    (error as Error & { code?: string }).code = "ACP_PERMISSION_UNSUPPORTED";
    throw error;
  }
  context.permissionIndex.delete(params.permissionRequestId);
  broadcastSessionUpdate(context, permission.sessionId, {
    kind: "permission_resolved",
    permissionRequestId: params.permissionRequestId,
    decision: params.decision,
  });
  const updated = context.updateSessionSummary(permission.sessionId, (current) => ({
    ...current,
    status: "running",
    updatedAt: new Date().toISOString(),
  }));
  broadcastSessionUpdate(context, permission.sessionId, {
    kind: "status_change",
    status: "running",
    message: "Permission response sent",
  });
  if (updated) {
    broadcastSessionUpdate(context, permission.sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }
  record.runtime.respondPermission(params.permissionRequestId, params.decision);
  return {
    ok: true,
    permissionRequestId: params.permissionRequestId,
    decision: params.decision,
  };
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
